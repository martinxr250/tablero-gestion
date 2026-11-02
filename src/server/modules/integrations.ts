import "server-only";
import { createHmac } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { decrypt, encrypt, randomToken, safeEqual } from "../core/crypto";
import { env } from "../core/env";
import { AppError, badRequest, conflict, forbidden, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { withSystem, withUser } from "../db/client";
import {
  boardRepos,
  cardDevRefs,
  cardIssueLinks,
  lists,
  organizationMembers,
  users,
  vcsConnections,
  vcsUserLinks,
  webhookDeliveries,
  type BoardRepoSettings,
} from "../db/schema";
import { GITHUB_API, GitHubClient } from "../integrations/github";
import type { RemoteIssue, RemotePull } from "../integrations/provider";
import { syncDeployments, upsertDeployment } from "../integrations/deployments";
import { clientFor, createIssueForCard, linkExistingIssue, loadRepo, notifyCardPeople, reconcileIssue, resolveConflict, syncPull, syncRepo } from "../integrations/sync";
import { boardAccess, cardAccess, orgAccess, orgRoleAtLeast } from "./access";

const providerSchema = z.enum(["github"]);

/** Los webhooks solo se registran si la app tiene una URL pública con HTTPS (en local se sincroniza por sondeo). */
const webhookBase = () => (env().APP_URL.startsWith("https://") ? env().APP_URL.replace(/\/$/, "") : null);

async function boardRepoFor(boardId: string) {
  const [row] = await withSystem((tx) => tx.select().from(boardRepos).where(eq(boardRepos.boardId, boardId)));
  return row ?? null;
}

const settingsSchema = z.object({
  inboxListId: z.uuid().optional(),
  doneListId: z.uuid().optional(),
  reviewListId: z.uuid().nullable().optional(),
  importNew: z.boolean().optional(),
  autoPush: z.boolean().optional(),
});

export const integrationRoutes = [
  // ───────────── Conexiones ─────────────
  route({
    method: "GET",
    path: "/orgs/:orgId/vcs/connections",
    summary: "Conexiones con proveedores de código de la organización",
    tag: "Integraciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "member");
        const rows = await tx
          .select({ id: vcsConnections.id, provider: vcsConnections.provider, accountLogin: vcsConnections.accountLogin, createdAt: vcsConnections.createdAt })
          .from(vcsConnections)
          .where(eq(vcsConnections.orgId, params.orgId))
          .orderBy(asc(vcsConnections.createdAt));
        return { connections: rows };
      }),
  }),

  route({
    method: "POST",
    path: "/orgs/:orgId/vcs/connections",
    summary: "Conectar una cuenta de GitHub con un token (se guarda cifrado)",
    tag: "Integraciones",
    status: 201,
    rateLimit: [{ name: "vcs-connect", by: "user", limit: 10, windowSec: 3600 }],
    body: z.object({ provider: providerSchema, token: z.string().trim().min(20).max(300) }),
    handler: async ({ me, params, body, audit: actx }) => {
      await withUser(me.id, (tx) => orgAccess(tx, me.id, params.orgId, "admin"));
      const viewer = await new GitHubClient(body.token).viewer();
      const id = uuidv7();
      await withUser(me.id, async (tx) => {
        await tx.insert(vcsConnections).values({
          id,
          orgId: params.orgId,
          provider: body.provider,
          apiBaseUrl: GITHUB_API,
          tokenEnc: encrypt(body.token),
          accountLogin: viewer.login,
          createdBy: me.id,
        });
        await audit(tx, actx, "vcs.connected", { orgId: params.orgId, targetType: "vcs_connection", targetId: id, data: { provider: body.provider, account: viewer.login } });
      });
      return { id, accountLogin: viewer.login };
    },
  }),

  route({
    method: "DELETE",
    path: "/vcs/connections/:connectionId",
    summary: "Desconectar (las tarjetas quedan como tarjetas locales)",
    tag: "Integraciones",
    handler: async ({ me, params, audit: actx }) => {
      const conn = await withUser(me.id, async (tx) => {
        const [c] = await tx.select().from(vcsConnections).where(eq(vcsConnections.id, params.connectionId));
        if (!c) throw notFound("Conexión");
        await orgAccess(tx, me.id, c.orgId, "admin");
        return c;
      });
      const repos = await withSystem((tx) => tx.select().from(boardRepos).where(eq(boardRepos.connectionId, conn.id)));
      const client = clientFor(conn);
      for (const r of repos) {
        if (r.webhookId) await client.deleteWebhook(r.repoFullName, r.webhookId).catch((err) => logger.warn("webhook_delete_failed", { err }));
      }
      await withUser(me.id, async (tx) => {
        await audit(tx, actx, "vcs.disconnected", { orgId: conn.orgId, targetType: "vcs_connection", targetId: conn.id });
        await tx.delete(vcsConnections).where(eq(vcsConnections.id, conn.id));
      });
      return undefined;
    },
  }),

  route({
    method: "GET",
    path: "/vcs/connections/:connectionId/repos",
    summary: "Repositorios disponibles para la cuenta conectada",
    tag: "Integraciones",
    query: z.object({ page: z.coerce.number().int().min(1).max(50).default(1) }),
    handler: async ({ me, params, query }) => {
      const conn = await withUser(me.id, async (tx) => {
        const [c] = await tx.select().from(vcsConnections).where(eq(vcsConnections.id, params.connectionId));
        if (!c) throw notFound("Conexión");
        await orgAccess(tx, me.id, c.orgId, "member");
        return c;
      });
      return clientFor(conn).listRepos(query.page);
    },
  }),

  // ───────────── Repositorio del tablero ─────────────
  route({
    method: "GET",
    path: "/boards/:boardId/repo",
    summary: "Repositorio vinculado al tablero y estado de la sincronización",
    tag: "Integraciones",
    handler: async ({ me, params }) => {
      await withUser(me.id, (tx) => boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true }));
      const repo = await boardRepoFor(params.boardId);
      if (!repo) return { repo: null };
      const [stats] = await withSystem((tx) =>
        tx
          .select({
            linked: sql<number>`count(*)::int`,
            pending: sql<number>`count(*) filter (where ${cardIssueLinks.pendingPush})::int`,
            conflicts: sql<number>`count(*) filter (where ${cardIssueLinks.conflict} is not null)::int`,
          })
          .from(cardIssueLinks)
          .where(eq(cardIssueLinks.boardRepoId, repo.id)),
      );
      return {
        repo: {
          id: repo.id,
          provider: repo.provider,
          connectionId: repo.connectionId,
          fullName: repo.repoFullName,
          htmlUrl: repo.htmlUrl,
          settings: repo.settings,
          webhook: repo.webhookId !== null,
          lastSyncedAt: repo.lastSyncedAt,
          lastSyncError: repo.lastSyncError,
          ...stats,
        },
      };
    },
  }),

  route({
    method: "PUT",
    path: "/boards/:boardId/repo",
    summary: "Vincular un repositorio al tablero e importar sus issues abiertos",
    tag: "Integraciones",
    rateLimit: [{ name: "vcs-link", by: "user", limit: 10, windowSec: 3600 }],
    body: z.object({ connectionId: z.uuid(), repoFullName: z.string().trim().min(3).max(200) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { board, conn, boardLists } = await withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        const [conn] = await tx.select().from(vcsConnections).where(eq(vcsConnections.id, body.connectionId));
        if (!conn || conn.orgId !== board.orgId) throw notFound("Conexión");
        const boardLists = await tx
          .select()
          .from(lists)
          .where(and(eq(lists.boardId, board.id), sql`${lists.archivedAt} is null`))
          .orderBy(asc(lists.position));
        return { board, conn, boardLists };
      });
      if (await boardRepoFor(board.id)) throw new AppError(409, "conflict", "El tablero ya tiene un repositorio vinculado");
      const client = clientFor(conn);
      const remote = await client.getRepo(body.repoFullName);
      if (!remote.canPush) throw forbidden("El token no tiene permiso de escritura en ese repositorio");

      const done = boardLists.find((l) => /hecho|done|terminad/i.test(l.name)) ?? boardLists[boardLists.length - 1];
      const review = boardLists.find((l) => /revisi|review|qa/i.test(l.name));
      const settings: BoardRepoSettings = {
        inboxListId: boardLists[0]?.id,
        doneListId: done?.id,
        reviewListId: review?.id,
        importNew: true,
        autoPush: true,
      };
      const id = uuidv7();
      const secret = randomToken(32);
      let webhookId: number | null = null;
      const base = webhookBase();
      if (base) {
        webhookId = await client
          .createWebhook(remote.fullName, `${base}/api/v1/webhooks/${conn.provider}/${id}`, secret)
          .catch((err) => {
            logger.warn("webhook_create_failed", { err });
            return null;
          });
      }
      await withUser(me.id, async (tx) => {
        await tx.insert(boardRepos).values({
          id,
          orgId: board.orgId,
          boardId: board.id,
          connectionId: conn.id,
          provider: conn.provider,
          repoFullName: remote.fullName,
          repoId: remote.id,
          htmlUrl: remote.htmlUrl,
          webhookId,
          webhookSecretEnc: encrypt(secret),
          settings,
          createdBy: me.id,
        });
        await audit(tx, actx, "vcs.repo_linked", { orgId: board.orgId, targetType: "board", targetId: board.id, data: { repo: remote.fullName } });
      });
      await syncRepo(id, { full: true });
      return { id, webhook: webhookId !== null };
    },
  }),

  route({
    method: "PATCH",
    path: "/boards/:boardId/repo/settings",
    summary: "Configurar listas de entrada, terminado y revisión, importación y envío automático",
    tag: "Integraciones",
    body: settingsSchema,
    handler: async ({ me, params, body, audit: actx }) => {
      const { board } = await withUser(me.id, (tx) => boardAccess(tx, actx, params.boardId, "manage"));
      const repo = await boardRepoFor(board.id);
      if (!repo) throw notFound("Repositorio");
      const listIds = [body.inboxListId, body.doneListId, body.reviewListId].filter(Boolean) as string[];
      if (listIds.length) {
        const found = await withUser(me.id, (tx) => tx.select({ id: lists.id }).from(lists).where(and(eq(lists.boardId, board.id), inArray(lists.id, listIds))));
        if (found.length !== new Set(listIds).size) throw badRequest("Lista inválida para este tablero");
      }
      const next: BoardRepoSettings = { ...repo.settings, ...body, reviewListId: body.reviewListId === null ? undefined : (body.reviewListId ?? repo.settings.reviewListId) };
      await withUser(me.id, (tx) => tx.update(boardRepos).set({ settings: next }).where(eq(boardRepos.id, repo.id)));
      return { settings: next };
    },
  }),

  route({
    method: "DELETE",
    path: "/boards/:boardId/repo",
    summary: "Desvincular el repositorio (las tarjetas quedan como locales)",
    tag: "Integraciones",
    handler: async ({ me, params, audit: actx }) => {
      const { board } = await withUser(me.id, (tx) => boardAccess(tx, actx, params.boardId, "manage"));
      const repo = await boardRepoFor(board.id);
      if (!repo) throw notFound("Repositorio");
      if (repo.webhookId) {
        const ctx = await withSystem((tx) => loadRepo(tx, repo.id));
        await ctx.client.deleteWebhook(repo.repoFullName, repo.webhookId).catch((err) => logger.warn("webhook_delete_failed", { err }));
      }
      await withUser(me.id, async (tx) => {
        await tx.delete(cardDevRefs).where(sql`${cardDevRefs.cardId} in (select card_id from app.card_issue_links where board_repo_id = ${repo.id})`);
        await tx.delete(boardRepos).where(eq(boardRepos.id, repo.id));
        await audit(tx, actx, "vcs.repo_unlinked", { orgId: board.orgId, targetType: "board", targetId: board.id, data: { repo: repo.repoFullName } });
      });
      return undefined;
    },
  }),

  route({
    method: "POST",
    path: "/boards/:boardId/repo/sync",
    summary: "Sincronizar ahora (reintenta pendientes y trae cambios del repositorio)",
    tag: "Integraciones",
    rateLimit: [{ name: "vcs-sync", by: "user", limit: 12, windowSec: 60 }],
    body: z.object({ full: z.boolean().optional() }),
    handler: async ({ me, params, body }) => {
      await withUser(me.id, (tx) => boardAccess(tx, { actorId: me.id }, params.boardId, "comment", { allowArchived: true }));
      const repo = await boardRepoFor(params.boardId);
      if (!repo) throw notFound("Repositorio");
      await syncRepo(repo.id, { full: body.full });
      return { ok: true };
    },
  }),

  // ───────────── Despliegues ─────────────
  route({
    method: "POST",
    path: "/boards/:boardId/repo/deployments/sync",
    summary: "Conciliar despliegues: trae los recientes de GitHub y actualiza los eventos del webhook",
    tag: "Integraciones",
    rateLimit: [{ name: "vcs-deploy-sync", by: "user", limit: 6, windowSec: 60 }],
    handler: async ({ me, params, audit: actx }) => {
      const { board } = await withUser(me.id, (tx) => boardAccess(tx, actx, params.boardId, "edit"));
      const repo = await boardRepoFor(board.id);
      if (!repo) throw notFound("Repositorio");
      const ctx = await withSystem((tx) => loadRepo(tx, repo.id));
      // Webhooks creados antes de esta versión no recibían eventos de despliegue.
      if (repo.webhookId) await ctx.client.updateWebhookEvents(repo.repoFullName, repo.webhookId).catch((err) => logger.warn("webhook_update_failed", { err }));
      const synced = await syncDeployments(ctx, 20);
      await withUser(me.id, (tx) => audit(tx, actx, "vcs.deployments_synced", { orgId: board.orgId, targetType: "board", targetId: board.id, data: { synced } }));
      return { synced };
    },
  }),

  route({
    method: "GET",
    path: "/boards/:boardId/deployments",
    summary: "Historial de despliegues del repositorio del tablero con sus tarjetas",
    tag: "Integraciones",
    query: z.object({ before: z.iso.datetime({ offset: true }).optional() }),
    handler: async ({ me, params, query }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const rows = await tx.execute<{
          id: string; sha: string; ref: string | null; environment: string; env_kind: string; state: string; url: string | null;
          started_at: Date | null; finished_at: Date | null; external_id: string; repo: string; cards: { id: string; title: string }[] | null;
        }>(sql`
          select d.id, d.sha, d.ref, d.environment, d.env_kind, d.state, d.url, d.started_at, d.finished_at, d.external_id::text, r.repo_full_name as repo,
            (select json_agg(json_build_object('id', c.id, 'title', c.title) order by c.title)
               from app.card_deployments cd join app.cards c on c.id = cd.card_id
               where cd.deployment_id = d.id and c.board_id = ${board.id}) as cards
          from app.deployments d join app.board_repos r on r.id = d.board_repo_id
          where r.board_id = ${board.id} ${query.before ? sql`and d.created_at < ${query.before}` : sql``}
          order by d.created_at desc limit 30`);
        return {
          deployments: rows.map((d) => ({
            id: d.id, sha: d.sha, ref: d.ref, environment: d.environment, envKind: d.env_kind, state: d.state, url: d.url,
            startedAt: d.started_at, finishedAt: d.finished_at, externalId: d.external_id, repo: d.repo, cards: d.cards ?? [],
          })),
        };
      }),
  }),

  // ───────────── Tarjeta ↔ issue ─────────────
  route({
    method: "GET",
    path: "/cards/:cardId/dev",
    summary: "Issue vinculado, PRs, checks y revisiones de una tarjeta",
    tag: "Integraciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { board } = await cardAccess(tx, { actorId: me.id }, params.cardId, "view");
        const [repo] = await tx
          .select({ id: boardRepos.id, provider: boardRepos.provider, fullName: boardRepos.repoFullName })
          .from(boardRepos)
          .where(eq(boardRepos.boardId, board.id));
        const [link] = await tx.select().from(cardIssueLinks).where(eq(cardIssueLinks.cardId, params.cardId));
        const refs = await tx.select().from(cardDevRefs).where(eq(cardDevRefs.cardId, params.cardId)).orderBy(sql`${cardDevRefs.remoteUpdatedAt} desc nulls last`);
        // Último despliegue de la tarjeta por tipo de entorno (evidencia verificada al vincular).
        const deploys = await tx.execute<{ env_kind: string; environment: string; state: string; url: string | null; sha: string; finished_at: Date | null; started_at: Date | null }>(sql`
          select distinct on (d.env_kind) d.env_kind, d.environment, d.state, d.url, d.sha, d.finished_at, d.started_at
          from app.card_deployments cd join app.deployments d on d.id = cd.deployment_id
          where cd.card_id = ${params.cardId}
          order by d.env_kind, d.created_at desc`);
        const [lastProd] = await tx.execute<{ finished_at: Date }>(sql`
          select max(d.finished_at) as finished_at from app.card_deployments cd join app.deployments d on d.id = cd.deployment_id
          where cd.card_id = ${params.cardId} and d.env_kind = 'production' and d.state = 'deployed'`);
        return {
          repo: repo ?? null,
          deployments: deploys.map((d) => ({ envKind: d.env_kind, environment: d.environment, state: d.state, url: d.url, sha: d.sha.slice(0, 7), finishedAt: d.finished_at, startedAt: d.started_at })),
          lastProductionDeployAt: lastProd?.finished_at ?? null,
          issue: link
            ? {
                number: link.issueNumber,
                url: link.htmlUrl,
                state: link.remoteState,
                syncedAt: link.syncedAt,
                pending: link.pendingPush,
                error: link.lastError,
                conflict: link.conflict,
              }
            : null,
          pulls: refs
            .filter((r) => r.kind === "pr")
            .map((r) => ({
              number: Number(r.externalId),
              title: r.title,
              state: r.state,
              url: r.url,
              author: r.author,
              branch: r.branch,
              draft: r.draft,
              checks: r.checksStatus,
              review: r.reviewStatus,
              merged: r.merged,
              manual: r.linkedManually,
              updatedAt: r.remoteUpdatedAt,
            })),
        };
      }),
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/issue",
    summary: "Crear un issue en el repositorio del tablero a partir de la tarjeta",
    tag: "Integraciones",
    status: 201,
    rateLimit: [{ name: "vcs-issue", by: "user", limit: 60, windowSec: 3600 }],
    handler: async ({ me, params, audit: actx }) => {
      const { board, card } = await withUser(me.id, (tx) => cardAccess(tx, actx, params.cardId, "edit"));
      const repo = await boardRepoFor(board.id);
      if (!repo) throw badRequest("El tablero no tiene un repositorio vinculado");
      const issue = await createIssueForCard(card.id, repo.id);
      await withUser(me.id, (tx) =>
        tx.execute(sql`
          insert into app.activity_logs (org_id, board_id, card_id, actor_id, action, data)
          values (${board.orgId}, ${board.id}, ${card.id}, ${me.id}, 'vcs.issue_created',
            ${JSON.stringify({ title: card.title, number: issue.number, provider: repo.provider })}::jsonb)`),
      );
      return { number: issue.number, url: issue.htmlUrl };
    },
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/issue/link",
    summary: "Vincular la tarjeta con un issue que ya existe en el repositorio del tablero",
    tag: "Integraciones",
    rateLimit: [{ name: "vcs-issue", by: "user", limit: 60, windowSec: 3600 }],
    body: z.object({ number: z.number().int().positive().max(9_999_999) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { board, card } = await withUser(me.id, (tx) => cardAccess(tx, actx, params.cardId, "edit"));
      const repo = await boardRepoFor(board.id);
      if (!repo) throw badRequest("El tablero no tiene un repositorio vinculado");
      const taken = await withSystem((tx) =>
        tx
          .select({ cardId: cardIssueLinks.cardId, boardRepoId: cardIssueLinks.boardRepoId, issueNumber: cardIssueLinks.issueNumber })
          .from(cardIssueLinks)
          .where(sql`${cardIssueLinks.cardId} = ${card.id} or (${cardIssueLinks.boardRepoId} = ${repo.id} and ${cardIssueLinks.issueNumber} = ${body.number})`),
      );
      if (taken.some((t) => t.cardId === card.id)) throw conflict("La tarjeta ya está vinculada a un issue");
      if (taken.length) throw conflict(`El issue #${body.number} ya está vinculado a otra tarjeta`);
      const ctx = await withSystem((tx) => loadRepo(tx, repo.id));
      const issue = await ctx.client.getIssue(repo.repoFullName, body.number).catch(() => null);
      if (!issue) throw notFound("Issue");
      await linkExistingIssue(ctx, card.id, issue);
      await withUser(me.id, (tx) =>
        tx.execute(sql`
          insert into app.activity_logs (org_id, board_id, card_id, actor_id, action, data)
          values (${board.orgId}, ${board.id}, ${card.id}, ${me.id}, 'vcs.issue_linked',
            ${JSON.stringify({ title: card.title, number: issue.number, provider: repo.provider })}::jsonb)`),
      );
      return { number: issue.number, url: issue.htmlUrl };
    },
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/dev/pulls",
    summary: "Vincular a mano un pull request del repositorio del tablero",
    tag: "Integraciones",
    status: 201,
    rateLimit: [{ name: "vcs-pull", by: "user", limit: 60, windowSec: 3600 }],
    body: z.object({ number: z.number().int().positive().max(9_999_999) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { board, card } = await withUser(me.id, (tx) => cardAccess(tx, actx, params.cardId, "edit"));
      const repo = await boardRepoFor(board.id);
      if (!repo) throw badRequest("El tablero no tiene un repositorio vinculado");
      const ctx = await withSystem((tx) => loadRepo(tx, repo.id));
      const pull = await ctx.client.getPull(repo.repoFullName, body.number).catch(() => null);
      if (!pull) throw notFound("Pull request");
      await withSystem((tx) =>
        tx
          .insert(cardDevRefs)
          .values({
            id: uuidv7(),
            orgId: board.orgId,
            cardId: card.id,
            kind: "pr",
            externalId: String(pull.number),
            title: pull.title.slice(0, 300),
            state: pull.merged ? "merged" : pull.state,
            url: pull.htmlUrl,
            linkedManually: true,
          })
          .onConflictDoUpdate({ target: [cardDevRefs.cardId, cardDevRefs.kind, cardDevRefs.externalId], set: { linkedManually: true } }),
      );
      await syncPull(ctx, pull, { details: true });
      await withUser(me.id, (tx) =>
        tx.execute(sql`
          insert into app.activity_logs (org_id, board_id, card_id, actor_id, action, data)
          values (${board.orgId}, ${board.id}, ${card.id}, ${me.id}, 'vcs.pull_linked',
            ${JSON.stringify({ title: card.title, number: pull.number })}::jsonb)`),
      );
      return { number: pull.number };
    },
  }),

  route({
    method: "DELETE",
    path: "/cards/:cardId/dev/pulls/:number",
    summary: "Desvincular un pull request de la tarjeta (en GitHub no cambia nada)",
    tag: "Integraciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await cardAccess(tx, { actorId: me.id }, params.cardId, "edit");
        const res = await tx
          .delete(cardDevRefs)
          .where(and(eq(cardDevRefs.cardId, params.cardId), eq(cardDevRefs.kind, "pr"), eq(cardDevRefs.externalId, String(Number(params.number)))))
          .returning({ id: cardDevRefs.id });
        if (res.length === 0) throw notFound("Pull request");
        return undefined;
      }),
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/issue/resolve",
    summary: "Resolver un conflicto de sincronización",
    tag: "Integraciones",
    body: z.object({ keep: z.enum(["local", "remote"]) }),
    handler: async ({ me, params, body }) => {
      await withUser(me.id, (tx) => cardAccess(tx, { actorId: me.id }, params.cardId, "edit"));
      await resolveConflict(params.cardId, body.keep);
      return { ok: true };
    },
  }),

  route({
    method: "DELETE",
    path: "/cards/:cardId/issue",
    summary: "Desvincular la tarjeta de su issue (el issue no se borra)",
    tag: "Integraciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await cardAccess(tx, { actorId: me.id }, params.cardId, "edit");
        // Los PR vinculados a mano se conservan: no dependen del issue.
        await tx.delete(cardDevRefs).where(and(eq(cardDevRefs.cardId, params.cardId), eq(cardDevRefs.linkedManually, false)));
        await tx.delete(cardIssueLinks).where(eq(cardIssueLinks.cardId, params.cardId));
        return undefined;
      }),
  }),

  // ───────────── Cuentas de los miembros ─────────────
  route({
    method: "GET",
    path: "/orgs/:orgId/vcs/users",
    summary: "Cuentas del proveedor asociadas a cada miembro",
    tag: "Integraciones",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId, "member");
        const rows = await tx
          .select({ userId: organizationMembers.userId, name: users.name, provider: vcsUserLinks.provider, login: vcsUserLinks.login })
          .from(organizationMembers)
          .innerJoin(users, eq(users.id, organizationMembers.userId))
          .leftJoin(vcsUserLinks, and(eq(vcsUserLinks.orgId, organizationMembers.orgId), eq(vcsUserLinks.userId, organizationMembers.userId)))
          .where(eq(organizationMembers.orgId, params.orgId))
          .orderBy(users.name);
        return { members: rows };
      }),
  }),

  route({
    method: "PUT",
    path: "/orgs/:orgId/vcs/users/:userId",
    summary: "Asociar (o quitar) la cuenta del proveedor de un miembro",
    tag: "Integraciones",
    body: z.object({ provider: providerSchema, login: z.string().trim().regex(/^[A-Za-z0-9-]{1,39}$/, "Usuario de GitHub inválido").nullable() }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const role = await orgAccess(tx, me.id, params.orgId, "member");
        if (params.userId !== me.id && !orgRoleAtLeast(role, "admin")) throw forbidden();
        await tx
          .delete(vcsUserLinks)
          .where(and(eq(vcsUserLinks.orgId, params.orgId), eq(vcsUserLinks.userId, params.userId), eq(vcsUserLinks.provider, body.provider)));
        if (body.login) await tx.insert(vcsUserLinks).values({ orgId: params.orgId, userId: params.userId, provider: body.provider, login: body.login });
        return { ok: true };
      }),
  }),

  // ───────────── Webhooks ─────────────
  route({
    method: "POST",
    path: "/webhooks/github/:boardRepoId",
    summary: "Receptor de webhooks de GitHub (firma HMAC SHA-256 y deduplicación)",
    tag: "Integraciones",
    auth: "webhook",
    rawBody: true,
    rateLimit: [{ name: "webhook", by: "ip", limit: 600, windowSec: 60 }],
    handler: async ({ req, params, rawBody }) => {
      const repo = await withSystem(async (tx) => (await tx.select().from(boardRepos).where(eq(boardRepos.id, params.boardRepoId)))[0]);
      // Respuesta idéntica si no existe o la firma no coincide: no se revela qué repos están vinculados.
      const signature = req.headers.get("x-hub-signature-256") ?? "";
      if (!repo?.webhookSecretEnc || !rawBody) throw new AppError(401, "invalid_signature", "Firma inválida");
      const expected = `sha256=${createHmac("sha256", decrypt(repo.webhookSecretEnc)).update(rawBody).digest("hex")}`;
      if (!safeEqual(signature, expected)) throw new AppError(401, "invalid_signature", "Firma inválida");

      const delivery = req.headers.get("x-github-delivery") ?? "";
      const event = req.headers.get("x-github-event") ?? "";
      if (!delivery) throw badRequest("Falta el identificador de entrega");
      const inserted = await withSystem((tx) =>
        tx.insert(webhookDeliveries).values({ deliveryId: delivery.slice(0, 100), boardRepoId: repo.id, event: event.slice(0, 50) }).onConflictDoNothing().returning(),
      );
      if (inserted.length === 0) return { ok: true, duplicate: true };

      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      const ctx = await withSystem((tx) => loadRepo(tx, repo.id));
      if (event === "issues" && payload.issue) {
        const i = payload.issue as Record<string, unknown>;
        if (!i.pull_request) {
          const issue = await ctx.client.getIssue(repo.repoFullName, Number(i.number));
          await reconcileIssue(ctx, issue as RemoteIssue, { importIfNew: repo.settings.importNew !== false });
        }
      } else if ((event === "pull_request" || event === "pull_request_review") && payload.pull_request) {
        const p = payload.pull_request as {
          id: number; number: number; title: string; body: string | null; state: "open" | "closed"; merged_at: string | null;
          draft?: boolean; html_url: string; user: { login: string } | null; head: { ref: string; sha: string }; updated_at: string;
          merge_commit_sha?: string | null;
        };
        const pull: RemotePull = {
          id: p.id, number: p.number, title: p.title, body: p.body ?? "", state: p.state, merged: !!p.merged_at, draft: !!p.draft,
          htmlUrl: p.html_url, author: p.user?.login ?? null, branch: p.head.ref, headSha: p.head.sha,
          mergeSha: p.merged_at ? (p.merge_commit_sha ?? null) : null, updatedAt: p.updated_at,
        };
        await syncPull(ctx, pull, { details: true });
        // Revisión solicitada: avisa solo a la persona pedida, si su cuenta de GitHub está asociada.
        const reviewer = (payload.requested_reviewer as { login?: string } | undefined)?.login;
        if (event === "pull_request" && payload.action === "review_requested" && reviewer) {
          await withSystem(async (tx) => {
            const [who] = await tx
              .select({ userId: vcsUserLinks.userId })
              .from(vcsUserLinks)
              .where(and(eq(vcsUserLinks.orgId, repo.orgId), eq(vcsUserLinks.provider, "github"), eq(vcsUserLinks.login, reviewer)));
            if (!who) return;
            const cards = await tx.execute<{ card_id: string }>(sql`
              select d.card_id from app.card_dev_refs d join app.cards c on c.id = d.card_id
              where c.board_id = ${repo.boardId} and d.kind = 'pr' and d.external_id = ${String(pull.number)}`);
            for (const c of cards) {
              await notifyCardPeople(tx, c.card_id, {
                type: "pr.review_requested",
                data: { number: pull.number, prTitle: pull.title.slice(0, 200), url: pull.htmlUrl },
                dedupeKey: `review:${pull.number}:${reviewer}:${pull.updatedAt}`,
                only: [who.userId],
              });
            }
          });
        }
      } else if ((event === "deployment" || event === "deployment_status") && payload.deployment) {
        // Datos del propio evento (firmado): sin llamadas extra a la API.
        const d = payload.deployment as { id: number; sha: string; ref: string | null; environment: string; production_environment?: boolean; transient_environment?: boolean; created_at: string };
        const st = payload.deployment_status as { state: string; environment_url?: string | null; target_url?: string | null; created_at: string } | undefined;
        await upsertDeployment(
          ctx,
          { id: d.id, sha: d.sha, ref: d.ref, environment: d.environment, production: d.production_environment ?? null, transient: d.transient_environment ?? null, createdAt: d.created_at },
          st ? { state: st.state, url: st.environment_url || st.target_url || null, createdAt: st.created_at } : null,
        );
      } else if (event === "check_suite" || event === "check_run") {
        // Los checks cambian el estado de PRs ya conocidos: se refrescan los de ese commit.
        const sha =
          (payload.check_suite as { head_sha?: string } | undefined)?.head_sha ?? (payload.check_run as { head_sha?: string } | undefined)?.head_sha;
        const { pulls } = await ctx.client.listPulls(repo.repoFullName, 1);
        for (const pull of pulls.filter((x) => x.headSha === sha)) await syncPull(ctx, pull, { details: true });
      }
      return { ok: true };
    },
  }),
];
