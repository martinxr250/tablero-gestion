import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { decrypt, sha256 } from "../core/crypto";
import { AppError } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { withSystem, type Tx } from "../db/client";
import {
  boardRepos,
  cardAssignees,
  cardDevRefs,
  cardIssueLinks,
  cardLabels,
  cards,
  labels,
  lists,
  vcsConnections,
  vcsUserLinks,
  type BoardRepoSettings,
  type Priority,
} from "../db/schema";
import { COLORS, notify } from "../modules/shared";
import { sanitizeRichText } from "../modules/richtext";
import { GitHubClient } from "./github";
import { docToMarkdown, markdownToDoc } from "./markdown";
import { referencedIssues, type RemoteIssue, type RemotePull, type VcsClient } from "./provider";

/*
 * Motor de sincronización tarjeta ↔ issue.
 *
 * Fuente de verdad por campo:
 *   - título, descripción, etiquetas, responsable, abierto/cerrado: bidireccional con detección de conflictos
 *   - prioridad: se traduce a la etiqueta "prioridad: <nivel>"
 *   - columna, checklists, adjuntos y vencimiento: solo en Tableros
 *   - PRs, checks y revisiones: solo en el proveedor (lectura)
 *
 * Cada vínculo guarda dos huellas ("local:remota") del último estado sincronizado. Así se distingue
 * un cambio local, un cambio remoto, el eco de una escritura propia y un conflicto (ambos cambiaron).
 */

const PRIORITY_LABEL: Record<Exclude<Priority, "none">, string> = {
  low: "prioridad: baja",
  medium: "prioridad: media",
  high: "prioridad: alta",
  urgent: "prioridad: urgente",
};
const LABEL_TO_PRIORITY = new Map<string, Priority>([
  ...Object.entries(PRIORITY_LABEL).map(([k, v]) => [v, k as Priority] as const),
  ["priority: low", "low"],
  ["priority: medium", "medium"],
  ["priority: high", "high"],
  ["priority: urgent", "urgent"],
  ["priority: critical", "urgent"],
]);

type Fields = { title: string; body: string; state: "open" | "closed"; labels: string[]; assignees: string[] };

const fingerprint = (f: Fields) =>
  sha256(JSON.stringify({ ...f, body: f.body.trim(), labels: [...f.labels].sort(), assignees: [...f.assignees].sort() })).slice(0, 32);

export function clientFor(conn: { provider: string; tokenEnc: string }): VcsClient {
  if (conn.provider === "github") return new GitHubClient(decrypt(conn.tokenEnc));
  throw new AppError(501, "not_implemented", "Este proveedor todavía no está disponible");
}

type RepoContext = {
  repo: typeof boardRepos.$inferSelect;
  conn: typeof vcsConnections.$inferSelect;
  client: VcsClient;
};

export async function loadRepo(tx: Tx, boardRepoId: string): Promise<RepoContext> {
  const [row] = await tx
    .select({ repo: boardRepos, conn: vcsConnections })
    .from(boardRepos)
    .innerJoin(vcsConnections, eq(vcsConnections.id, boardRepos.connectionId))
    .where(eq(boardRepos.id, boardRepoId));
  if (!row) throw new AppError(404, "not_found", "Repositorio no vinculado");
  return { ...row, client: clientFor(row.conn) };
}

function remoteFields(issue: RemoteIssue): Fields {
  return { title: issue.title, body: issue.body, state: issue.state, labels: issue.labels, assignees: issue.assignees };
}

async function localFields(tx: Tx, repo: RepoContext["repo"], cardId: string): Promise<Fields | null> {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId));
  if (!card) return null;
  const labelRows = await tx
    .select({ name: labels.name })
    .from(cardLabels)
    .innerJoin(labels, eq(labels.id, cardLabels.labelId))
    .where(eq(cardLabels.cardId, cardId));
  const names = labelRows.map((l) => l.name);
  if (card.priority !== "none") names.push(PRIORITY_LABEL[card.priority]);
  let assignees: string[] = [];
  if (card.ownerId) {
    const [link] = await tx
      .select({ login: vcsUserLinks.login })
      .from(vcsUserLinks)
      .where(and(eq(vcsUserLinks.orgId, card.orgId), eq(vcsUserLinks.userId, card.ownerId), eq(vcsUserLinks.provider, repo.provider)));
    if (link) assignees = [link.login];
  }
  const closed = card.completedAt !== null || (repo.settings.doneListId !== undefined && card.listId === repo.settings.doneListId);
  return { title: card.title, body: docToMarkdown(card.description), state: closed ? "closed" : "open", labels: names, assignees };
}

const splitHash = (h: string | null) => {
  const [local = "", remote = ""] = (h ?? ":").split(":");
  return { local, remote };
};

async function appendPosition(tx: Tx, listId: string) {
  const [r] = await tx.select({ p: sql<string | null>`max(${cards.position})` }).from(cards).where(eq(cards.listId, listId));
  return generateKeyBetween(r?.p ?? null, null);
}

async function defaultInbox(tx: Tx, repo: RepoContext["repo"]) {
  if (repo.settings.inboxListId) {
    const [l] = await tx.select().from(lists).where(and(eq(lists.id, repo.settings.inboxListId), eq(lists.boardId, repo.boardId)));
    if (l && !l.archivedAt) return l.id;
  }
  const [first] = await tx
    .select()
    .from(lists)
    .where(and(eq(lists.boardId, repo.boardId), sql`${lists.archivedAt} is null`))
    .orderBy(asc(lists.position))
    .limit(1);
  if (!first) throw new AppError(409, "conflict", "El tablero no tiene listas activas");
  return first.id;
}

/** Aplica el estado remoto del issue a la tarjeta (sin disparar un push de vuelta). */
async function applyRemote(tx: Tx, ctx: RepoContext, cardId: string, issue: RemoteIssue, prevState: "open" | "closed") {
  const { repo } = ctx;
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId));
  if (!card) return;
  let rich: { json: unknown; text: string };
  try {
    rich = sanitizeRichText(markdownToDoc(issue.body));
  } catch {
    // Descripción fuera de los límites del editor: se guarda como texto plano recortado.
    rich = sanitizeRichText(markdownToDoc(issue.body.slice(0, 8000).replace(/[#*_`>[\]]/g, "")));
  }
  const { json, text } = rich;

  let priority: Priority = "none";
  const plainLabels: string[] = [];
  for (const name of issue.labels) {
    const p = LABEL_TO_PRIORITY.get(name.toLowerCase());
    if (p) priority = p;
    else plainLabels.push(name.slice(0, 40));
  }

  // Etiquetas: se crean en el tablero las que falten.
  const existing = await tx.select().from(labels).where(eq(labels.boardId, repo.boardId));
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]));
  const labelIds: string[] = [];
  for (const name of plainLabels) {
    let id = byName.get(name.toLowerCase());
    if (!id) {
      id = uuidv7();
      const color = COLORS[parseInt(sha256(name).slice(0, 4), 16) % COLORS.length]!;
      await tx.insert(labels).values({ id, orgId: repo.orgId, boardId: repo.boardId, name, color });
      byName.set(name.toLowerCase(), id);
    }
    labelIds.push(id);
  }
  await tx.delete(cardLabels).where(eq(cardLabels.cardId, cardId));
  if (labelIds.length) {
    await tx.insert(cardLabels).values([...new Set(labelIds)].map((labelId) => ({ orgId: repo.orgId, boardId: repo.boardId, cardId, labelId })));
  }

  // Responsable: solo si el login está vinculado a un miembro de la organización.
  let ownerId = card.ownerId;
  if (issue.assignees.length) {
    const [mapped] = await tx
      .select({ userId: vcsUserLinks.userId })
      .from(vcsUserLinks)
      .where(and(eq(vcsUserLinks.orgId, repo.orgId), eq(vcsUserLinks.provider, repo.provider), inArray(vcsUserLinks.login, issue.assignees)));
    if (mapped) ownerId = mapped.userId;
  }

  const patch: Partial<typeof cards.$inferInsert> = {
    title: issue.title.slice(0, 200) || card.title,
    description: json,
    descriptionText: text,
    priority,
    ownerId,
  };
  // Cerrar un issue no completa la tarjeta: se lleva a revisión si hay lista configurada.
  if (issue.state === "closed" && prevState === "open" && repo.settings.reviewListId && card.listId !== repo.settings.reviewListId) {
    const [review] = await tx.select().from(lists).where(and(eq(lists.id, repo.settings.reviewListId), eq(lists.boardId, repo.boardId)));
    if (review && !review.archivedAt) {
      patch.listId = review.id;
      patch.position = await appendPosition(tx, review.id);
    }
  }
  if (issue.state === "open" && prevState === "closed") {
    patch.completedAt = null;
    if (repo.settings.doneListId && card.listId === repo.settings.doneListId) {
      const inbox = await defaultInbox(tx, repo);
      patch.listId = inbox;
      patch.position = await appendPosition(tx, inbox);
    }
  }
  await tx.update(cards).set(patch).where(eq(cards.id, cardId));
  await tx.execute(sql`
    insert into app.activity_logs (org_id, board_id, card_id, actor_id, action, data)
    values (${repo.orgId}, ${repo.boardId}, ${cardId}, null, 'vcs.issue_synced',
      ${JSON.stringify({ title: patch.title, number: issue.number, provider: repo.provider, state: issue.state })}::jsonb)`);
}

async function storeSynced(tx: Tx, ctx: RepoContext, cardId: string, issue: RemoteIssue) {
  const local = await localFields(tx, ctx.repo, cardId);
  await tx
    .update(cardIssueLinks)
    .set({
      syncedHash: `${local ? fingerprint(local) : ""}:${fingerprint(remoteFields(issue))}`,
      syncedAt: new Date(),
      remoteState: issue.state,
      remoteUpdatedAt: new Date(issue.updatedAt),
      htmlUrl: issue.htmlUrl,
      pendingPush: false,
      lastError: null,
      conflict: null,
    })
    .where(eq(cardIssueLinks.cardId, cardId));
}

/** Concilia un issue remoto con su tarjeta vinculada (o la crea si corresponde). */
export async function reconcileIssue(ctx: RepoContext, issue: RemoteIssue, opts: { importIfNew: boolean }) {
  await withSystem(async (tx) => {
    const [link] = await tx
      .select()
      .from(cardIssueLinks)
      .where(and(eq(cardIssueLinks.boardRepoId, ctx.repo.id), eq(cardIssueLinks.issueNumber, issue.number)))
      .for("update");

    if (!link) {
      if (!opts.importIfNew || issue.state === "closed") return;
      const listId = await defaultInbox(tx, ctx.repo);
      const cardId = uuidv7();
      await tx.insert(cards).values({
        id: cardId,
        orgId: ctx.repo.orgId,
        boardId: ctx.repo.boardId,
        listId,
        title: issue.title.slice(0, 200) || `Issue #${issue.number}`,
        priority: "none",
        position: await appendPosition(tx, listId),
        createdBy: null,
      });
      await tx.insert(cardIssueLinks).values({
        cardId,
        orgId: ctx.repo.orgId,
        boardRepoId: ctx.repo.id,
        issueNumber: issue.number,
        issueId: issue.id,
        htmlUrl: issue.htmlUrl,
        remoteState: issue.state,
      });
      await applyRemote(tx, ctx, cardId, issue, issue.state);
      await storeSynced(tx, ctx, cardId, issue);
      return;
    }

    const remoteHash = fingerprint(remoteFields(issue));
    const synced = splitHash(link.syncedHash);
    if (remoteHash === synced.remote) return; // sin cambios remotos (o eco de una escritura propia)

    const local = await localFields(tx, ctx.repo, link.cardId);
    const localChanged = local !== null && fingerprint(local) !== synced.local;
    if (localChanged) {
      // Ambos lados cambiaron: no se pisa nada, se deja el conflicto para que lo resuelva una persona.
      await tx
        .update(cardIssueLinks)
        .set({ conflict: { remote: remoteFields(issue), detectedAt: new Date().toISOString() }, pendingPush: false })
        .where(eq(cardIssueLinks.cardId, link.cardId));
      return;
    }
    await applyRemote(tx, ctx, link.cardId, issue, link.remoteState);
    await storeSynced(tx, ctx, link.cardId, issue);
  });
}

/**
 * Vincula una tarjeta con un issue que ya existe. Si el contenido coincide quedan sincronizados;
 * si difiere, no se pisa ninguno de los dos lados: queda un conflicto para que lo resuelva una persona.
 */
export async function linkExistingIssue(ctx: RepoContext, cardId: string, issue: RemoteIssue) {
  await withSystem(async (tx) => {
    await tx.insert(cardIssueLinks).values({
      cardId,
      orgId: ctx.repo.orgId,
      boardRepoId: ctx.repo.id,
      issueNumber: issue.number,
      issueId: issue.id,
      htmlUrl: issue.htmlUrl,
      remoteState: issue.state,
      remoteUpdatedAt: new Date(issue.updatedAt),
    });
    const local = await localFields(tx, ctx.repo, cardId);
    const remote = remoteFields(issue);
    if (local && fingerprint(local) === fingerprint(remote)) return storeSynced(tx, ctx, cardId, issue);
    await tx
      .update(cardIssueLinks)
      .set({
        syncedHash: `${local ? fingerprint(local) : ""}:${fingerprint(remote)}`,
        syncedAt: new Date(),
        conflict: { remote, detectedAt: new Date().toISOString() },
      })
      .where(eq(cardIssueLinks.cardId, cardId));
  });
}

/** Envía al proveedor los cambios locales de una tarjeta vinculada. */
export async function pushCard(cardId: string, opts: { force?: boolean } = {}) {
  const prepared = await withSystem(async (tx) => {
    const [link] = await tx.select().from(cardIssueLinks).where(eq(cardIssueLinks.cardId, cardId));
    if (!link) return null;
    const ctx = await loadRepo(tx, link.boardRepoId);
    if (ctx.repo.settings.autoPush === false && !opts.force) return null;
    if (link.conflict && !opts.force) return null;
    const local = await localFields(tx, ctx.repo, cardId);
    if (!local) return null;
    if (!opts.force && fingerprint(local) === splitHash(link.syncedHash).local) {
      if (link.pendingPush) await tx.update(cardIssueLinks).set({ pendingPush: false }).where(eq(cardIssueLinks.cardId, cardId));
      return null;
    }
    await tx.update(cardIssueLinks).set({ pendingPush: true }).where(eq(cardIssueLinks.cardId, cardId));
    return { ctx, link, local };
  });
  if (!prepared) return;
  const { ctx, link, local } = prepared;
  try {
    const issue = await ctx.client.updateIssue(ctx.repo.repoFullName, link.issueNumber, {
      title: local.title,
      body: local.body,
      state: local.state,
      labels: local.labels,
      ...(local.assignees.length ? { assignees: local.assignees } : {}),
    });
    await withSystem((tx) => storeSynced(tx, ctx, cardId, issue));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    await withSystem((tx) => tx.update(cardIssueLinks).set({ pendingPush: true, lastError: message }).where(eq(cardIssueLinks.cardId, cardId)));
    logger.warn("vcs_push_failed", { cardId, err });
  }
}

/**
 * Se llama después de cada cambio en una tarjeta. Nunca hace fallar la acción del usuario:
 * si el proveedor no responde, el vínculo queda pendiente y se reintenta en la próxima sincronización.
 */
export async function schedulePush(cardId: string) {
  const run = () => pushCard(cardId).catch((err) => logger.error("vcs_push_error", { cardId, err }));
  if (process.env.NODE_ENV === "test") return run();
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    void run();
  }
}

/** Crea un issue a partir de una tarjeta existente y los vincula. */
export async function createIssueForCard(cardId: string, boardRepoId: string) {
  const { ctx, local } = await withSystem(async (tx) => {
    const ctx = await loadRepo(tx, boardRepoId);
    const [existing] = await tx.select().from(cardIssueLinks).where(eq(cardIssueLinks.cardId, cardId));
    if (existing) throw new AppError(409, "conflict", "La tarjeta ya está vinculada a un issue");
    const local = await localFields(tx, ctx.repo, cardId);
    if (!local) throw new AppError(404, "not_found", "Tarjeta no encontrada");
    return { ctx, local };
  });
  const issue = await ctx.client.createIssue(ctx.repo.repoFullName, {
    title: local.title,
    body: local.body,
    labels: local.labels,
    ...(local.assignees.length ? { assignees: local.assignees } : {}),
  });
  const final = local.state === "closed" ? await ctx.client.updateIssue(ctx.repo.repoFullName, issue.number, { state: "closed" }) : issue;
  await withSystem(async (tx) => {
    await tx.insert(cardIssueLinks).values({
      cardId,
      orgId: ctx.repo.orgId,
      boardRepoId: ctx.repo.id,
      issueNumber: final.number,
      issueId: final.id,
      htmlUrl: final.htmlUrl,
      remoteState: final.state,
    });
    await storeSynced(tx, ctx, cardId, final);
  });
  return final;
}

/** Resuelve un conflicto quedándose con la versión local o la remota. */
export async function resolveConflict(cardId: string, keep: "local" | "remote") {
  if (keep === "local") {
    await withSystem((tx) => tx.update(cardIssueLinks).set({ conflict: null }).where(eq(cardIssueLinks.cardId, cardId)));
    await pushCard(cardId, { force: true });
    return;
  }
  const { ctx, link } = await withSystem(async (tx) => {
    const [link] = await tx.select().from(cardIssueLinks).where(eq(cardIssueLinks.cardId, cardId));
    if (!link) throw new AppError(404, "not_found", "La tarjeta no está vinculada");
    return { ctx: await loadRepo(tx, link.boardRepoId), link };
  });
  const issue = await ctx.client.getIssue(ctx.repo.repoFullName, link.issueNumber);
  await withSystem(async (tx) => {
    await applyRemote(tx, ctx, cardId, issue, link.remoteState);
    await storeSynced(tx, ctx, cardId, issue);
  });
}

/** Actualiza las referencias de desarrollo (PR, checks, revisión) de las tarjetas que menciona un PR. */
/**
 * Actualiza el estado de un PR en las tarjetas vinculadas: por referencia explícita a un
 * issue vinculado ("#12" o rama "12-algo") o por vínculo manual. Nunca por coincidencias de título.
 * Descarta eventos más viejos que lo guardado (llegadas fuera de orden).
 */
export async function syncPull(ctx: RepoContext, pull: RemotePull, opts: { details: boolean }): Promise<boolean> {
  const numbers = referencedIssues(pull);
  const linked = await withSystem(async (tx) => {
    const byIssue = numbers.length
      ? await tx
          .select({ cardId: cardIssueLinks.cardId })
          .from(cardIssueLinks)
          .where(and(eq(cardIssueLinks.boardRepoId, ctx.repo.id), inArray(cardIssueLinks.issueNumber, numbers)))
      : [];
    const manual = await tx.execute<{ card_id: string }>(sql`
      select d.card_id from app.card_dev_refs d join app.cards c on c.id = d.card_id
      where c.board_id = ${ctx.repo.boardId} and d.kind = 'pr' and d.external_id = ${String(pull.number)} and d.linked_manually`);
    return [...new Set([...byIssue.map((r) => r.cardId), ...manual.map((r) => r.card_id)])];
  });
  if (linked.length === 0) return false;
  let checks: string | null = null;
  let review: string | null = null;
  if (opts.details) {
    [checks, review] = await Promise.all([
      ctx.client.checksStatus(ctx.repo.repoFullName, pull.headSha).catch(() => null),
      ctx.client.reviewStatus(ctx.repo.repoFullName, pull.number).catch(() => null),
    ]);
  }
  await withSystem(async (tx) => {
    for (const cardId of linked) {
      const [prev] = await tx
        .select()
        .from(cardDevRefs)
        .where(and(eq(cardDevRefs.cardId, cardId), eq(cardDevRefs.kind, "pr"), eq(cardDevRefs.externalId, String(pull.number))));
      if (prev?.remoteUpdatedAt && prev.remoteUpdatedAt > new Date(pull.updatedAt)) continue; // evento viejo
      const values = {
        title: pull.title.slice(0, 300),
        state: pull.merged ? "merged" : pull.state,
        url: pull.htmlUrl,
        author: pull.author,
        branch: pull.branch.slice(0, 200),
        merged: pull.merged,
        draft: pull.draft,
        remoteUpdatedAt: new Date(pull.updatedAt),
        ...(opts.details ? { checksStatus: checks, reviewStatus: review } : {}),
      };
      await tx
        .insert(cardDevRefs)
        .values({ id: uuidv7(), orgId: ctx.repo.orgId, cardId, kind: "pr", externalId: String(pull.number), ...values })
        .onConflictDoUpdate({ target: [cardDevRefs.cardId, cardDevRefs.kind, cardDevRefs.externalId], set: values });
      if (opts.details && checks === "failure" && prev?.checksStatus !== "failure") {
        await notifyCardPeople(tx, cardId, {
          type: "ci.failed",
          data: { number: pull.number, prTitle: pull.title.slice(0, 200), url: pull.htmlUrl },
          dedupeKey: `ci:${cardId}:${pull.number}:${pull.headSha}`,
        });
      }
    }
  });
  return opts.details;
}

/** Avisa al responsable y colaboradores de una tarjeta (eventos de GitHub, sin actor local). */
export async function notifyCardPeople(
  tx: Tx,
  cardId: string,
  input: { type: "ci.failed" | "pr.review_requested"; data: Record<string, unknown>; dedupeKey: string; only?: string[] },
) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId));
  if (!card) return;
  const people = new Set((await tx.select({ userId: cardAssignees.userId }).from(cardAssignees).where(eq(cardAssignees.cardId, cardId))).map((a) => a.userId));
  if (card.ownerId) people.add(card.ownerId);
  const recipients = input.only ? input.only : [...people];
  await notify(tx, {
    orgId: card.orgId,
    userIds: recipients,
    actorId: null,
    type: input.type,
    boardId: card.boardId,
    cardId,
    data: { ...input.data, cardTitle: card.title },
    dedupeKey: input.dedupeKey,
  });
}

/** Sincronización completa por sondeo: reintenta pendientes, trae issues y PRs actualizados. */
export async function syncRepo(boardRepoId: string, opts: { full?: boolean } = {}) {
  const started = new Date();
  const ctx = await withSystem((tx) => loadRepo(tx, boardRepoId));
  try {
    const pending = await withSystem((tx) =>
      tx
        .select({ cardId: cardIssueLinks.cardId })
        .from(cardIssueLinks)
        .where(and(eq(cardIssueLinks.boardRepoId, boardRepoId), eq(cardIssueLinks.pendingPush, true))),
    );
    for (const p of pending) await pushCard(p.cardId);

    const since = opts.full || !ctx.repo.lastSyncedAt ? undefined : new Date(ctx.repo.lastSyncedAt.getTime() - 60_000).toISOString();
    const importNew = ctx.repo.settings.importNew !== false;
    for (let page = 1; page <= 20; page++) {
      const { issues, hasMore } = await ctx.client.listIssues(ctx.repo.repoFullName, { since, page });
      for (const issue of issues) await reconcileIssue(ctx, issue, { importIfNew: importNew || !!opts.full });
      if (!hasMore) break;
    }

    let detailCalls = 0;
    outer: for (let page = 1; page <= 3; page++) {
      const { pulls, hasMore } = await ctx.client.listPulls(ctx.repo.repoFullName, page);
      for (const pull of pulls) {
        if (since && new Date(pull.updatedAt) < new Date(since)) break outer;
        // Revisión y checks (2 llamadas) solo para PR vinculados, con tope por sincronización.
        if ((await syncPull(ctx, pull, { details: detailCalls < 15 })) && detailCalls < 15) detailCalls++;
      }
      if (!hasMore) break;
    }
    await withSystem((tx) => tx.update(boardRepos).set({ lastSyncedAt: started, lastSyncError: null }).where(eq(boardRepos.id, boardRepoId)));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    await withSystem((tx) => tx.update(boardRepos).set({ lastSyncError: message }).where(eq(boardRepos.id, boardRepoId)));
    throw err;
  }
}

export type { RepoContext, BoardRepoSettings };
