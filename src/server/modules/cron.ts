import "server-only";
import { sql } from "drizzle-orm";
import { route } from "../api/router";
import { logger } from "../core/logger";
import { withSystem } from "../db/client";
import { storage } from "../storage/storage";
import { syncRepo } from "../integrations/sync";
import { notify } from "./shared";
import { sprintRisk } from "./signals";

/**
 * Tareas diarias (Vercel Cron, autenticadas con CRON_SECRET):
 * avisos de vencimiento y políticas de retención.
 */
export async function runDailyJobs() {
  const report: Record<string, number> = {};
  await withSystem(async (tx) => {
    const due = await tx.execute(sql`
      insert into app.notifications (id, org_id, user_id, type, card_id, board_id, data)
      select gen_random_uuid(), c.org_id, u.user_id, 'card.due_soon', c.id, c.board_id,
             jsonb_build_object('cardTitle', c.title, 'boardName', b.name, 'dueAt', c.due_at)
      from app.cards c
      join app.boards b on b.id = c.board_id and b.archived_at is null
      cross join lateral (
        select c.owner_id as user_id where c.owner_id is not null
        union select a.user_id from app.card_assignees a where a.card_id = c.id
      ) u
      where c.archived_at is null and c.completed_at is null
        and c.due_at between now() and now() + interval '24 hours'
        and not exists (
          select 1 from app.notifications n
          where n.card_id = c.id and n.user_id = u.user_id and n.type = 'card.due_soon'
            and n.created_at > now() - interval '2 days'
        )`);
    report.dueSoonNotifications = due.count;

    const purges: [string, ReturnType<typeof sql>][] = [
      ["expiredSessions", sql`delete from app.sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '30 days'`],
      ["authTokens", sql`delete from app.auth_tokens where expires_at < now() - interval '7 days'`],
      ["rateLimits", sql`delete from app.rate_limits where window_start < now() - interval '1 day'`],
      ["invitations", sql`delete from app.invitations where expires_at < now() - interval '30 days' and accepted_at is null`],
      ["readNotifications", sql`delete from app.notifications where read_at < now() - interval '90 days'`],
      ["archivedCards", sql`delete from app.cards where archived_at < now() - interval '90 days'`],
      ["archivedLists", sql`delete from app.lists where archived_at < now() - interval '90 days'`],
      ["deletedOrgs", sql`delete from app.organizations where deleted_at < now() - interval '30 days'`],
      ["activity", sql`delete from app.activity_logs where created_at < now() - interval '365 days'`],
    ];
    for (const [name, query] of purges) report[name] = (await tx.execute(query)).count;

    await tx.execute(sql`select set_config('app.audit_purge', 'on', true)`);
    report.auditLogs = (await tx.execute(sql`delete from app.audit_logs where created_at < now() - interval '365 days'`)).count;
  });

  // Etapas en curso con riesgo medio o alto: avisa a quienes administran el tablero (una vez por nivel).
  report.sprintRiskNotifications = await withSystem(async (tx) => {
    const boards = await tx.execute<{ board_id: string; org_id: string; name: string }>(sql`
      select distinct s.board_id, b.org_id, b.name from app.sprints s join app.boards b on b.id = s.board_id
      where s.status = 'active' and b.archived_at is null`);
    let sent = 0;
    for (const b of boards) {
      const risky = (await sprintRisk(tx, b.board_id)).filter((s) => s.status === "active" && (s.level === "high" || s.level === "medium"));
      if (risky.length === 0) continue;
      const admins = (await tx.execute<{ user_id: string }>(sql`select user_id from app.board_roles(${b.board_id}) where role = 'admin'`)).map((r) => r.user_id);
      for (const s of risky) {
        await notify(tx, {
          orgId: b.org_id,
          userIds: admins,
          actorId: null,
          type: "sprint.risk",
          boardId: b.board_id,
          data: { sprintName: s.name, level: s.level, boardName: b.name, reasons: s.reasons },
          dedupeKey: `risk:${s.id}:${s.level}`,
        });
        sent++;
      }
    }
    return sent;
  });

  // Sincronización diaria de respaldo para repos sin webhook (por ejemplo, en desarrollo local).
  const repos = await withSystem((tx) => tx.execute<{ id: string }>(sql`select id from app.board_repos`));
  let synced = 0;
  for (const r of repos) {
    try {
      await syncRepo(r.id);
      synced++;
    } catch (err) {
      logger.warn("daily_repo_sync_failed", { boardRepoId: r.id, err });
    }
  }
  report.reposSynced = synced;

  // Borrado físico de objetos de almacenamiento huérfanos.
  const keys = await withSystem((tx) => tx.execute<{ key: string }>(sql`select key from app.storage_gc order by created_at limit 500`));
  if (keys.length) {
    try {
      await storage().remove(keys.map((k) => k.key));
      await withSystem((tx) => tx.execute(sql`delete from app.storage_gc where key = any(${keys.map((k) => k.key)})`));
      report.storageObjects = keys.length;
    } catch (err) {
      logger.error("storage_gc_failed", { err });
    }
  }
  logger.info("daily_jobs", report);
  return report;
}

export const cronRoutes = [
  route({
    method: "GET",
    path: "/cron/daily",
    summary: "Tareas diarias: vencimientos y retención (solo Vercel Cron)",
    tag: "Sistema",
    auth: "cron",
    handler: async () => ({ ok: true, report: await runDailyJobs() }),
  }),
];
