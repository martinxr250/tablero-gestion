import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { badRequest, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser } from "../db/client";
import { cards, inboxItems, lists } from "../db/schema";
import { boardAccess } from "./access";
import { deliveryStatus } from "./delivery";
import { positionAfter } from "./positions";
import { logActivity } from "./shared";

type WorkRow = {
  id: string;
  title: string;
  priority: string;
  due_at: Date | null;
  completed_at: Date | null;
  board_id: string;
  board_name: string;
  board_color: string;
  org_name: string;
  list_name: string;
  is_owner: boolean;
  blocked: boolean;
  qa_status: string;
  sprint_name: string | null;
  prs_open: number;
  prs_merged: number;
  has_branch: boolean;
  review_pending: boolean;
  checks_failed: boolean;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (aaaa-mm-dd)");

export const workRoutes = [
  route({
    method: "GET",
    path: "/me/work",
    summary: "Mis tareas de todos los tableros: responsable o colaborador",
    tag: "Mi trabajo",
    query: z.object({ completed: z.enum(["none", "week"]).default("none") }),
    handler: async ({ me, query }) =>
      withUser(me.id, async (tx) => {
        // my_boards respeta los permisos: solo tableros que la persona puede ver.
        const rows = await tx.execute<WorkRow>(sql`
          select c.id, c.title, c.priority, c.due_at, c.completed_at, c.qa_status,
            b.id as board_id, b.name as board_name, b.color as board_color, o.name as org_name, l.name as list_name,
            (c.owner_id = ${me.id}) as is_owner, sp.name as sprint_name,
            coalesce(dr.prs_open, 0)::int as prs_open, coalesce(dr.prs_merged, 0)::int as prs_merged,
            coalesce(dr.has_branch, false) as has_branch, coalesce(dr.review_pending, false) as review_pending,
            coalesce(dr.checks_failed, false) as checks_failed,
            exists (
              select 1 from app.card_relations r join app.cards x on x.id = r.from_card_id
              where r.to_card_id = c.id and r.type = 'blocks' and x.completed_at is null and x.archived_at is null
            ) as blocked
          from app.cards c
          join app.my_boards mb on mb.board_id = c.board_id
          join app.boards b on b.id = c.board_id
          join app.organizations o on o.id = c.org_id
          join app.lists l on l.id = c.list_id
          left join app.sprints sp on sp.id = c.sprint_id
          left join lateral (
            select count(*) filter (where d.kind = 'pr' and d.state = 'open') as prs_open,
              count(*) filter (where d.kind = 'pr' and d.merged) as prs_merged,
              bool_or(d.kind = 'branch') as has_branch,
              bool_or(d.kind = 'pr' and d.state = 'open' and not d.draft and coalesce(d.review_status, '') <> 'approved') as review_pending,
              bool_or(d.kind = 'pr' and d.checks_status = 'failure' and not d.merged) as checks_failed
            from app.card_dev_refs d where d.card_id = c.id
          ) dr on true
          where c.archived_at is null and b.archived_at is null
            and (c.owner_id = ${me.id} or exists (select 1 from app.card_assignees a where a.card_id = c.id and a.user_id = ${me.id}))
            and ${query.completed === "week" ? sql`(c.completed_at is null or c.completed_at > now() - interval '7 days')` : sql`c.completed_at is null`}
          order by c.due_at asc nulls last, c.created_at desc
          limit 500`);
        return {
          cards: rows.map((r) => ({
            id: r.id,
            title: r.title,
            priority: r.priority,
            dueAt: r.due_at,
            completedAt: r.completed_at,
            qaStatus: r.qa_status,
            blocked: r.blocked,
            isOwner: r.is_owner,
            listName: r.list_name,
            sprintName: r.sprint_name,
            reviewPending: r.review_pending || r.qa_status === "pending",
            checksFailed: r.checks_failed,
            delivery: deliveryStatus({
              completed: !!r.completed_at,
              blocked: r.blocked,
              qaStatus: r.qa_status,
              prsOpen: r.prs_open,
              prsMerged: r.prs_merged,
              hasBranch: r.has_branch,
              reviewPending: r.review_pending,
            }),
            board: { id: r.board_id, name: r.board_name, color: r.board_color, orgName: r.org_name },
          })),
        };
      }),
  }),

  route({
    method: "GET",
    path: "/me/inbox",
    summary: "Bandeja personal: notas rápidas que todavía no son tarjetas",
    tag: "Mi trabajo",
    handler: async ({ me }) =>
      withUser(me.id, async (tx) => {
        const rows = await tx
          .select()
          .from(inboxItems)
          .where(and(eq(inboxItems.userId, me.id), sql`(${inboxItems.doneAt} is null or ${inboxItems.doneAt} > now() - interval '1 day')`))
          .orderBy(desc(inboxItems.createdAt));
        return { items: rows.map((r) => ({ id: r.id, title: r.title, dueOn: r.dueOn, done: r.doneAt !== null, createdAt: r.createdAt })) };
      }),
  }),

  route({
    method: "POST",
    path: "/me/inbox",
    summary: "Anotar algo en la bandeja personal",
    tag: "Mi trabajo",
    status: 201,
    rateLimit: [{ name: "inbox", by: "user", limit: 120, windowSec: 600 }],
    body: z.object({ title: z.string().trim().min(1).max(200), dueOn: dateSchema.nullable().optional() }),
    handler: async ({ me, body }) =>
      withUser(me.id, async (tx) => {
        const count = await tx.$count(inboxItems, and(eq(inboxItems.userId, me.id), isNull(inboxItems.doneAt)));
        if (count >= 300) throw badRequest("La bandeja admite hasta 300 notas pendientes");
        const id = uuidv7();
        await tx.insert(inboxItems).values({ id, userId: me.id, title: body.title, dueOn: body.dueOn ?? null });
        return { id };
      }),
  }),

  route({
    method: "PATCH",
    path: "/me/inbox/:itemId",
    summary: "Editar o marcar como hecha una nota de la bandeja",
    tag: "Mi trabajo",
    body: z.object({ title: z.string().trim().min(1).max(200).optional(), dueOn: dateSchema.nullable().optional(), done: z.boolean().optional() }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const patch: Partial<typeof inboxItems.$inferInsert> = {};
        if (body.title !== undefined) patch.title = body.title;
        if (body.dueOn !== undefined) patch.dueOn = body.dueOn;
        if (body.done !== undefined) patch.doneAt = body.done ? new Date() : null;
        const res = await tx
          .update(inboxItems)
          .set(patch)
          .where(and(eq(inboxItems.id, params.itemId), eq(inboxItems.userId, me.id)))
          .returning({ id: inboxItems.id });
        if (res.length === 0) throw notFound("Nota");
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/me/inbox/:itemId",
    summary: "Borrar una nota de la bandeja",
    tag: "Mi trabajo",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const res = await tx.delete(inboxItems).where(and(eq(inboxItems.id, params.itemId), eq(inboxItems.userId, me.id))).returning({ id: inboxItems.id });
        if (res.length === 0) throw notFound("Nota");
        return { ok: true };
      }),
  }),

  route({
    method: "POST",
    path: "/me/inbox/:itemId/move",
    summary: "Convertir una nota de la bandeja en tarjeta de un tablero (queda como responsable)",
    tag: "Mi trabajo",
    body: z.object({ listId: z.uuid() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [item] = await tx.select().from(inboxItems).where(and(eq(inboxItems.id, params.itemId), eq(inboxItems.userId, me.id)));
        if (!item) throw notFound("Nota");
        const [list] = await tx.select().from(lists).where(eq(lists.id, body.listId));
        if (!list || list.archivedAt) throw notFound("Lista");
        const { board } = await boardAccess(tx, actx, list.boardId, "edit");
        const id = uuidv7();
        await tx.insert(cards).values({
          id,
          orgId: board.orgId,
          boardId: board.id,
          listId: list.id,
          title: item.title,
          priority: "none",
          ownerId: me.id,
          dueAt: item.dueOn ? new Date(`${item.dueOn}T12:00:00Z`) : null,
          position: await positionAfter(tx, "cards", list.id, undefined),
          createdBy: me.id,
        });
        await tx.delete(inboxItems).where(eq(inboxItems.id, item.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: id, actorId: me.id, action: "card.created", data: { title: item.title, list: list.name } });
        return { cardId: id, boardId: board.id };
      }),
  }),
];
