import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { withSystem } from "../db/client";
import { cardDeployments, deployments, type DeployState, type EnvKind } from "../db/schema";
import type { RemoteDeployment, RemoteDeploymentStatus } from "./provider";
import type { RepoContext } from "./sync";

/** Estado normalizado a partir del estado de GitHub. "inactive" = reemplazado por uno más nuevo. */
export function normalizeDeployState(remote: string | null | undefined, previous?: DeployState): DeployState {
  switch (remote) {
    case "queued":
      return "pending";
    case "pending":
      return "building";
    case "in_progress":
      return "deploying";
    case "success":
      return "deployed";
    case "failure":
    case "error":
      return "failed";
    case "inactive":
      return previous === "deployed" ? "deployed" : "unknown";
    case undefined:
    case null:
      return "pending";
    default:
      return "unknown";
  }
}

/** Entorno: primero los indicadores explícitos de GitHub, después el nombre. */
export function envKindOf(d: Pick<RemoteDeployment, "environment" | "production" | "transient">): EnvKind {
  if (d.production === true) return "production";
  if (d.transient === true) return "preview";
  const name = d.environment.toLowerCase();
  if (/\b(production|prod)\b/.test(name)) return "production";
  if (/\b(staging|stage)\b/.test(name)) return "staging";
  if (/preview/.test(name)) return "preview";
  return "other";
}

const MAX_COMPARES = 25;

/**
 * Relaciona un despliegue con tarjetas sin coincidencias ambiguas:
 *  - preview/otro: el commit desplegado es exactamente la cabeza de un PR vinculado;
 *  - producción/staging: el commit de merge de un PR vinculado está incluido en el commit
 *    desplegado (comparación de GitHub). Sin evidencia, no se vincula.
 */
async function linkDeployment(ctx: RepoContext, dep: { id: string; sha: string; envKind: EnvKind }) {
  const candidates = await withSystem((tx) =>
    tx.execute<{ card_id: string; head_sha: string | null; merge_sha: string | null }>(sql`
      select distinct d.card_id, d.head_sha, d.merge_sha
      from app.card_dev_refs d join app.cards c on c.id = d.card_id
      where c.board_id = ${ctx.repo.boardId} and d.kind = 'pr'
        and not exists (select 1 from app.card_deployments cd where cd.card_id = d.card_id and cd.deployment_id = ${dep.id})
        and ${dep.envKind === "production" || dep.envKind === "staging" ? sql`d.merged and d.merge_sha is not null` : sql`d.head_sha = ${dep.sha}`}`),
  );
  const linked: string[] = [];
  let compares = 0;
  for (const c of candidates) {
    let ok = false;
    if (dep.envKind === "production" || dep.envKind === "staging") {
      if (c.merge_sha === dep.sha) ok = true;
      else if (compares < MAX_COMPARES) {
        compares++;
        ok = await ctx.client.commitIncluded(ctx.repo.repoFullName, c.merge_sha!, dep.sha).catch(() => false);
      }
    } else ok = c.head_sha === dep.sha;
    if (ok) linked.push(c.card_id);
  }
  if (linked.length) {
    await withSystem((tx) =>
      tx
        .insert(cardDeployments)
        .values(linked.map((cardId) => ({ orgId: ctx.repo.orgId, cardId, deploymentId: dep.id })))
        .onConflictDoNothing(),
    );
  }
  return linked.length;
}

/** Guarda (o actualiza) un despliegue con su último estado. Ignora estados más viejos que lo guardado. */
export async function upsertDeployment(ctx: RepoContext, remote: RemoteDeployment, status: RemoteDeploymentStatus) {
  const envKind = envKindOf(remote);
  const statusAt = status ? new Date(status.createdAt) : new Date(remote.createdAt);
  const row = await withSystem(async (tx) => {
    const [prev] = await tx
      .select()
      .from(deployments)
      .where(and(eq(deployments.boardRepoId, ctx.repo.id), eq(deployments.externalId, remote.id)))
      .for("update");
    if (prev?.remoteUpdatedAt && prev.remoteUpdatedAt > statusAt) return prev; // evento viejo
    const state = normalizeDeployState(status?.state, prev?.state);
    const finished = state === "deployed" || state === "failed" || state === "canceled";
    const values = {
      sha: remote.sha.toLowerCase().slice(0, 64),
      ref: remote.ref?.slice(0, 200) ?? null,
      environment: remote.environment.slice(0, 100),
      envKind,
      state,
      url: status?.url && status.url.startsWith("https://") ? status.url.slice(0, 500) : (prev?.url ?? null),
      startedAt: prev?.startedAt ?? new Date(remote.createdAt),
      finishedAt: finished ? (prev?.finishedAt && prev.state === state ? prev.finishedAt : statusAt) : null,
      remoteUpdatedAt: statusAt,
    };
    if (prev) {
      await tx.update(deployments).set(values).where(eq(deployments.id, prev.id));
      return { ...prev, ...values };
    }
    const id = uuidv7();
    await tx.insert(deployments).values({ id, orgId: ctx.repo.orgId, boardRepoId: ctx.repo.id, externalId: remote.id, ...values });
    return { id, ...values };
  });
  if (!/^[0-9a-f]{7,64}$/.test(row.sha)) return row;
  await linkDeployment(ctx, { id: row.id, sha: row.sha, envKind: row.envKind });
  return row;
}

/** Conciliación: trae los despliegues recientes y su último estado (pocas llamadas a la API). */
export async function syncDeployments(ctx: RepoContext, limit = 10) {
  const list = await ctx.client.listDeployments(ctx.repo.repoFullName, limit);
  let done = 0;
  for (const d of list.slice(0, limit)) {
    try {
      const status = await ctx.client.latestDeploymentStatus(ctx.repo.repoFullName, d.id);
      await upsertDeployment(ctx, d, status);
      done++;
    } catch (err) {
      logger.warn("deployment_sync_failed", { boardRepoId: ctx.repo.id, deploymentId: d.id, err });
    }
  }
  return done;
}
