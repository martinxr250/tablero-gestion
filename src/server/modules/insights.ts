import "server-only";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { withUser } from "../db/client";
import { boards, notifications, users } from "../db/schema";

const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

export const insightRoutes = [
  // ───────────── Notificaciones ─────────────
  route({
    method: "GET",
    path: "/notifications",
    summary: "Notificaciones del usuario",
    tag: "Notificaciones",
    query: z.object({ before: z.iso.datetime({ offset: true }).optional(), unread: z.enum(["1"]).optional() }),
    handler: async ({ me, query }) =>
      withUser(me.id, async (tx) => {
        const rows = await tx
          .select({
            id: notifications.id,
            type: notifications.type,
            orgId: notifications.orgId,
            boardId: notifications.boardId,
            cardId: notifications.cardId,
            actorName: users.name,
            data: notifications.data,
            readAt: notifications.readAt,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .leftJoin(users, eq(users.id, notifications.actorId))
          .where(
            and(
              eq(notifications.userId, me.id),
              query.before ? lt(notifications.createdAt, new Date(query.before)) : undefined,
              query.unread ? isNull(notifications.readAt) : undefined,
            ),
          )
          .orderBy(desc(notifications.createdAt))
          .limit(30);
        const [{ unread }] = await tx
          .select({ unread: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
        return { notifications: rows, unread, nextBefore: rows.length === 30 ? rows[rows.length - 1]!.createdAt : null };
      }),
  }),

  route({
    method: "GET",
    path: "/notifications/unread-count",
    summary: "Cantidad de notificaciones sin leer",
    tag: "Notificaciones",
    handler: async ({ me }) =>
      withUser(me.id, async (tx) => {
        const [{ unread }] = await tx
          .select({ unread: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
        return { unread };
      }),
  }),

  route({
    method: "POST",
    path: "/notifications/read",
    summary: "Marcar notificaciones como leídas (todas o algunas)",
    tag: "Notificaciones",
    body: z.object({ ids: z.array(z.uuid()).max(100).optional() }),
    handler: async ({ me, body }) =>
      withUser(me.id, async (tx) => {
        await tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(eq(notifications.userId, me.id), isNull(notifications.readAt), body.ids ? inArray(notifications.id, body.ids) : undefined),
          );
        return { ok: true };
      }),
  }),

  // ───────────── Dashboard ─────────────
  route({
    method: "GET",
    path: "/dashboard",
    summary: "Resumen personal: tableros, tareas, vencimientos y actividad",
    tag: "Dashboard",
    query: z.object({ orgId: z.uuid().optional() }),
    handler: async ({ me, query }) =>
      withUser(me.id, async (tx) => {
        const orgFilter = query.orgId ? sql`and mb.org_id = ${query.orgId}` : sql``;
        const mine = sql`(c.owner_id = ${me.id} or exists (select 1 from app.card_assignees a where a.card_id = c.id and a.user_id = ${me.id}))`;

        const [stats] = await tx.execute<{ pending: number; overdue: number; completed: number; due_soon: number }>(sql`
          select
            count(*) filter (where c.completed_at is null)::int as pending,
            count(*) filter (where c.completed_at is null and c.due_at < now())::int as overdue,
            count(*) filter (where c.completed_at is not null)::int as completed,
            count(*) filter (where c.completed_at is null and c.due_at between now() and now() + interval '7 days')::int as due_soon
          from app.cards c
          join app.my_boards mb on mb.board_id = c.board_id
          join app.boards b on b.id = c.board_id and b.archived_at is null
          where c.archived_at is null and ${mine} ${orgFilter}`);

        const taskRows = await tx.execute<{
          id: string; title: string; board_id: string; board_name: string; list_name: string;
          priority: string; due_at: Date | null; completed_at: Date | null;
        }>(sql`
          select c.id, c.title, c.board_id, b.name as board_name, l.name as list_name, c.priority, c.due_at, c.completed_at
          from app.cards c
          join app.my_boards mb on mb.board_id = c.board_id
          join app.boards b on b.id = c.board_id and b.archived_at is null
          join app.lists l on l.id = c.list_id and l.archived_at is null
          where c.archived_at is null and c.completed_at is null and ${mine} ${orgFilter}
          order by c.due_at asc nulls last, c.updated_at desc
          limit 25`);

        const boardRows = await tx.execute<{
          id: string; name: string; color: string; org_id: string; workspace_id: string; open_cards: number; last_activity: Date | null;
        }>(sql`
          select b.id, b.name, b.color, b.org_id, b.workspace_id,
            (select count(*)::int from app.cards c where c.board_id = b.id and c.archived_at is null and c.completed_at is null) as open_cards,
            (select max(a.created_at) from app.activity_logs a where a.board_id = b.id) as last_activity
          from app.my_boards mb join app.boards b on b.id = mb.board_id
          where b.archived_at is null ${orgFilter}
          order by last_activity desc nulls last
          limit 8`);

        const activity = await tx.execute<{
          id: number; action: string; board_id: string; board_name: string; card_id: string | null;
          actor_name: string | null; data: Record<string, unknown>; created_at: Date;
        }>(sql`
          select a.id, a.action, a.board_id, b.name as board_name, a.card_id, u.name as actor_name, a.data, a.created_at
          from app.activity_logs a
          join app.my_boards mb on mb.board_id = a.board_id
          join app.boards b on b.id = a.board_id
          left join app.users u on u.id = a.actor_id
          where true ${orgFilter}
          order by a.id desc
          limit 15`);

        const weekly = await tx.execute<{ week: string; completed: number; created: number }>(sql`
          with weeks as (
            select generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') as week
          )
          select to_char(w.week, 'YYYY-MM-DD') as week,
            (select count(*)::int from app.cards c join app.my_boards mb on mb.board_id = c.board_id
              where c.completed_at >= w.week and c.completed_at < w.week + interval '1 week' ${orgFilter}) as completed,
            (select count(*)::int from app.cards c join app.my_boards mb on mb.board_id = c.board_id
              where c.created_at >= w.week and c.created_at < w.week + interval '1 week' ${orgFilter}) as created
          from weeks w order by w.week`);

        return {
          stats: { pending: stats?.pending ?? 0, overdue: stats?.overdue ?? 0, completed: stats?.completed ?? 0, dueSoon: stats?.due_soon ?? 0 },
          myTasks: taskRows.map((t) => ({ id: t.id, title: t.title, boardId: t.board_id, boardName: t.board_name, listName: t.list_name, priority: t.priority, dueAt: t.due_at })),
          boards: boardRows.map((b) => ({ id: b.id, name: b.name, color: b.color, orgId: b.org_id, workspaceId: b.workspace_id, openCards: b.open_cards, lastActivity: b.last_activity })),
          activity: activity.map((a) => ({ id: Number(a.id), action: a.action, boardId: a.board_id, boardName: a.board_name, cardId: a.card_id, actorName: a.actor_name, data: a.data, createdAt: a.created_at })),
          weekly,
        };
      }),
  }),

  // ───────────── Búsqueda global ─────────────
  route({
    method: "GET",
    path: "/search",
    summary: "Búsqueda global de tarjetas y tableros con filtros",
    tag: "Búsqueda",
    rateLimit: [{ name: "search", by: "user", limit: 120, windowSec: 60 }],
    query: z.object({
      q: z.string().trim().max(100).default(""),
      orgId: z.uuid().optional(),
      workspaceId: z.uuid().optional(),
      boardId: z.uuid().optional(),
      assigneeId: z.union([z.uuid(), z.literal("me")]).optional(),
      labelId: z.uuid().optional(),
      priority: z.enum(PRIORITIES).optional(),
      status: z.enum(["open", "completed", "archived", "overdue"]).default("open"),
      due: z.enum(["overdue", "today", "week", "none"]).optional(),
    }),
    handler: async ({ me, query }) =>
      withUser(me.id, async (tx) => {
        // Prefijos por palabra: "dise inst" → dise:* & inst:*  (solo letras y números: sin inyección en tsquery)
        const terms = query.q.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 6) ?? [];
        const tsq = terms.map((t) => `${t}:*`).join(" & ");
        const assignee = query.assigneeId === "me" ? me.id : query.assigneeId;
        const where = [
          sql`true`,
          query.orgId ? sql`and mb.org_id = ${query.orgId}` : sql``,
          query.workspaceId ? sql`and mb.workspace_id = ${query.workspaceId}` : sql``,
          query.boardId ? sql`and c.board_id = ${query.boardId}` : sql``,
          assignee
            ? sql`and (c.owner_id = ${assignee} or exists (select 1 from app.card_assignees a where a.card_id = c.id and a.user_id = ${assignee}))`
            : sql``,
          query.labelId ? sql`and exists (select 1 from app.card_labels cl where cl.card_id = c.id and cl.label_id = ${query.labelId})` : sql``,
          query.priority ? sql`and c.priority = ${query.priority}` : sql``,
          query.status === "open" ? sql`and c.archived_at is null and c.completed_at is null` : sql``,
          query.status === "completed" ? sql`and c.archived_at is null and c.completed_at is not null` : sql``,
          query.status === "archived" ? sql`and c.archived_at is not null` : sql``,
          query.status === "overdue" ? sql`and c.archived_at is null and c.completed_at is null and c.due_at < now()` : sql``,
          query.due === "overdue" ? sql`and c.due_at < now()` : sql``,
          query.due === "today" ? sql`and c.due_at >= date_trunc('day', now()) and c.due_at < date_trunc('day', now()) + interval '1 day'` : sql``,
          query.due === "week" ? sql`and c.due_at >= now() and c.due_at < now() + interval '7 days'` : sql``,
          query.due === "none" ? sql`and c.due_at is null` : sql``,
          tsq ? sql`and (c.search_tsv @@ to_tsquery('spanish', ${tsq}) or c.title ilike ${"%" + query.q.replace(/[%_\\]/g, "\\$&") + "%"})` : sql``,
        ];
        const cardRows = await tx.execute<{
          id: string; title: string; board_id: string; board_name: string; list_name: string; org_id: string;
          priority: string; due_at: Date | null; completed_at: Date | null; archived_at: Date | null; assignee_ids: string[]; label_ids: string[];
        }>(sql`
          select c.id, c.title, c.board_id, b.name as board_name, l.name as list_name, c.org_id, c.priority, c.due_at, c.completed_at, c.archived_at,
            coalesce((select array_agg(a.user_id) from app.card_assignees a where a.card_id = c.id), '{}') as assignee_ids,
            coalesce((select array_agg(x.label_id) from app.card_labels x where x.card_id = c.id), '{}') as label_ids
          from app.cards c
          join app.my_boards mb on mb.board_id = c.board_id
          join app.boards b on b.id = c.board_id
          join app.lists l on l.id = c.list_id
          where ${sql.join(where, sql` `)}
          order by ${tsq ? sql`ts_rank(c.search_tsv, to_tsquery('spanish', ${tsq})) desc,` : sql``} c.updated_at desc
          limit 50`);

        const boardMatches = terms.length
          ? await tx
              .select({ id: boards.id, name: boards.name, color: boards.color, orgId: boards.orgId })
              .from(boards)
              .where(
                and(
                  sql`${boards.id} in (select board_id from app.my_boards)`,
                  isNull(boards.archivedAt),
                  sql`${boards.name} ilike ${"%" + query.q.replace(/[%_\\]/g, "\\$&") + "%"}`,
                  query.orgId ? eq(boards.orgId, query.orgId) : undefined,
                ),
              )
              .limit(8)
          : [];

        return {
          boards: boardMatches,
          cards: cardRows.map((c) => ({
            id: c.id,
            title: c.title,
            boardId: c.board_id,
            boardName: c.board_name,
            listName: c.list_name,
            orgId: c.org_id,
            priority: c.priority,
            dueAt: c.due_at,
            completedAt: c.completed_at,
            archivedAt: c.archived_at,
            assigneeIds: c.assignee_ids,
            labelIds: c.label_ids,
          })),
        };
      }),
  }),
];
