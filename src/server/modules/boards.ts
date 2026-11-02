import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { badRequest, conflict, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser, type Tx } from "../db/client";
import { activityLogs, boardMembers, boards, cards, labels, lists, organizationMembers, sprints, users, workspaces } from "../db/schema";
import { applyTemplate, templateSchema } from "./templates";
import { sendMail } from "../email/mailer";
import { listBoardFields } from "./fields";
import { boardMirrors } from "./mirrors";
import { boardAccess, workspaceAccess } from "./access";
import { emailSchema } from "./auth";
import { createInvitation } from "./orgs";
import { positionAfter } from "./positions";
import { colorSchema, logActivity, notify } from "./shared";

const boardBody = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre").max(80),
  description: z.string().trim().max(500).optional().nullable(),
  color: colorSchema.default("indigo"),
  visibility: z.enum(["private", "workspace"]).default("workspace"),
  workspaceAccess: z.enum(["viewer", "commenter", "editor"]).default("editor"),
});

const listName = z.string().trim().min(1, "Ingresá un nombre").max(80);
const afterId = z.uuid().nullable().optional();

type CardSummaryRow = {
  field_values: Record<string, string | number | boolean>;
  id: string;
  list_id: string;
  title: string;
  priority: string;
  owner_id: string | null;
  due_at: Date | null;
  completed_at: Date | null;
  position: string;
  updated_at: Date;
  has_description: boolean;
  excerpt: string;
  issue_number: number | null;
  sync_attention: boolean | null;
  assignee_ids: string[];
  label_ids: string[];
  comment_count: number;
  attachment_count: number;
  checklist_total: number;
  checklist_done: number;
  parent_id: string | null;
  sprint_id: string | null;
  estimate_points: string | null;
  recurrence: "weekly" | "monthly" | null;
  qa_status: "none" | "pending" | "approved" | "rejected";
  subtask_total: number;
  subtask_done: number;
  blocked: boolean;
};

export async function boardCards(tx: Tx, boardId: string, archived = false) {
  return cardSummaries(tx, sql`c.board_id = ${boardId} and ${archived ? sql`c.archived_at is not null` : sql`c.archived_at is null`}`);
}

/** Resumen de tarjetas para el tablero (también para los espejos, que muestran tarjetas de otros tableros). */
export async function cardSummaries(tx: Tx, where: SQL) {
  const rows = await tx.execute<CardSummaryRow>(sql`
    select c.id, c.list_id, c.title, c.priority, c.owner_id, c.due_at, c.completed_at, c.position, c.updated_at,
      (c.description_text <> '') as has_description,
      left(c.description_text, 160) as excerpt,
      (select l.issue_number from app.card_issue_links l where l.card_id = c.id) as issue_number,
      (select (l.conflict is not null or l.pending_push) from app.card_issue_links l where l.card_id = c.id) as sync_attention,
      coalesce((select array_agg(a.user_id) from app.card_assignees a where a.card_id = c.id), '{}') as assignee_ids,
      coalesce((select array_agg(l.label_id) from app.card_labels l where l.card_id = c.id), '{}') as label_ids,
      (select count(*)::int from app.comments m where m.card_id = c.id and m.deleted_at is null) as comment_count,
      (select count(*)::int from app.attachments f where f.card_id = c.id) as attachment_count,
      (select count(*)::int from app.checklist_items i join app.checklists k on k.id = i.checklist_id where k.card_id = c.id) as checklist_total,
      (select count(*)::int from app.checklist_items i join app.checklists k on k.id = i.checklist_id
         where k.card_id = c.id and i.done_at is not null) as checklist_done,
      c.parent_id, c.sprint_id, c.estimate_points, c.recurrence, c.qa_status,
      coalesce((select jsonb_object_agg(v.field_id, v.value) from app.card_field_values v where v.card_id = c.id), '{}'::jsonb) as field_values,
      (select count(*)::int from app.cards s where s.parent_id = c.id and s.archived_at is null) as subtask_total,
      (select count(*)::int from app.cards s where s.parent_id = c.id and s.archived_at is null and s.completed_at is not null) as subtask_done,
      -- Bloqueada: otra tarjeta sin terminar la bloquea.
      exists (
        select 1 from app.card_relations r join app.cards b on b.id = r.from_card_id
        where r.to_card_id = c.id and r.type = 'blocks' and b.completed_at is null and b.archived_at is null
      ) as blocked
    from app.cards c
    where ${where}
    order by c.position, c.id`);
  return rows.map((r) => ({
    id: r.id,
    listId: r.list_id,
    title: r.title,
    priority: r.priority,
    ownerId: r.owner_id,
    dueAt: r.due_at,
    completedAt: r.completed_at,
    position: r.position,
    updatedAt: r.updated_at,
    hasDescription: r.has_description,
    excerpt: r.excerpt,
    issueNumber: r.issue_number,
    syncAttention: !!r.sync_attention,
    assigneeIds: r.assignee_ids,
    labelIds: r.label_ids,
    commentCount: r.comment_count,
    attachmentCount: r.attachment_count,
    checklistTotal: r.checklist_total,
    checklistDone: r.checklist_done,
    parentId: r.parent_id,
    sprintId: r.sprint_id,
    estimatePoints: r.estimate_points === null ? null : Number(r.estimate_points),
    recurrence: r.recurrence,
    qaStatus: r.qa_status,
    subtaskTotal: r.subtask_total,
    subtaskDone: r.subtask_done,
    blocked: r.blocked,
    fieldValues: r.field_values,
  }));
}

export async function boardPeople(tx: Tx, boardId: string) {
  return tx.execute<{ user_id: string; role: string; name: string; email: string; has_avatar: boolean; can_review: boolean }>(sql`
    select r.user_id, r.role, u.name, u.email, (u.avatar_key is not null) as has_avatar,
      (r.role = 'admin' or coalesce(bm.can_review, false)) as can_review
    from app.board_roles(${boardId}) r
    join app.users u on u.id = r.user_id
    left join app.board_members bm on bm.board_id = ${boardId} and bm.user_id = r.user_id
    order by u.name`);
}

async function listInBoard(tx: Tx, listId: string) {
  const [list] = await tx.select().from(lists).where(eq(lists.id, listId));
  if (!list) throw notFound("Lista");
  return list;
}

export const boardRoutes = [
  route({
    method: "POST",
    path: "/workspaces/:workspaceId/boards",
    summary: "Crear un tablero (vacío con listas iniciales, desde una plantilla o copiando otro tablero)",
    tag: "Tableros",
    status: 201,
    body: boardBody.extend({ template: templateSchema.optional() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { workspace } = await workspaceAccess(tx, me.id, params.workspaceId, "create_board");
        const id = uuidv7();
        await tx.insert(boards).values({
          id,
          orgId: workspace.orgId,
          workspaceId: workspace.id,
          name: body.name,
          description: body.description,
          color: body.color,
          visibility: body.visibility,
          workspaceAccess: body.workspaceAccess,
          createdBy: me.id,
        });
        await tx.insert(boardMembers).values({ orgId: workspace.orgId, boardId: id, userId: me.id, role: "admin" });
        await applyTemplate(tx, { orgId: workspace.orgId, boardId: id, actorId: me.id, template: body.template ?? { kind: "builtin", key: "kanban" } });
        await logActivity(tx, { orgId: workspace.orgId, boardId: id, actorId: me.id, action: "board.created", data: { name: body.name } });
        await audit(tx, actx, "board.created", { orgId: workspace.orgId, targetType: "board", targetId: id });
        return { id };
      }),
  }),

  route({
    method: "GET",
    path: "/boards/:boardId",
    summary: "Tablero completo: listas, tarjetas, etiquetas y personas con acceso",
    tag: "Tableros",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board, role, viaOverride } = await boardAccess(tx, actx, params.boardId, "view", { allowArchived: true });
        if (viaOverride) {
          await audit(tx, actx, "admin.board_override", {
            orgId: board.orgId,
            targetType: "board",
            targetId: board.id,
            data: { action: "view" },
          });
        }
        const [listRows, cardRows, labelRows, people, [cursor], [ws], sprintRows] = await Promise.all([
          tx.select().from(lists).where(and(eq(lists.boardId, board.id), isNull(lists.archivedAt))).orderBy(asc(lists.position), asc(lists.id)),
          boardCards(tx, board.id),
          tx.select().from(labels).where(eq(labels.boardId, board.id)).orderBy(asc(labels.name)),
          boardPeople(tx, board.id),
          tx.select({ max: sql<number | null>`max(${activityLogs.id})` }).from(activityLogs).where(eq(activityLogs.boardId, board.id)),
          tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, board.workspaceId)),
          tx.select().from(sprints).where(eq(sprints.boardId, board.id)).orderBy(asc(sprints.startsOn)),
        ]);
        const fields = await listBoardFields(tx, board.id);
        const mirrors = await boardMirrors(tx, board.id);
        const meRow = people.find((p) => p.user_id === me.id);
        return {
          board: {
            id: board.id,
            orgId: board.orgId,
            workspaceId: board.workspaceId,
            workspaceName: ws?.name ?? "",
            name: board.name,
            description: board.description,
            color: board.color,
            visibility: board.visibility,
            workspaceAccess: board.workspaceAccess,
            archivedAt: board.archivedAt,
            qaRequired: board.qaRequired,
            qaListId: board.qaListId,
            doneListId: board.doneListId,
            isTemplate: board.isTemplate,
            completionRules: board.completionRules,
          },
          role,
          canReview: role === "admin" || !!meRow?.can_review,
          sprints: sprintRows.map((sp) => ({
            id: sp.id,
            name: sp.name,
            goal: sp.goal,
            startsOn: sp.startsOn,
            endsOn: sp.endsOn,
            status: sp.status,
            capacityPoints: sp.capacityPoints,
          })),
          lists: listRows.map((l) => ({ id: l.id, name: l.name, color: l.color, position: l.position })),
          cards: [...cardRows, ...mirrors.cards].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)),
          external: mirrors.external,
          labels: labelRows.map((l) => ({ id: l.id, name: l.name, color: l.color })),
          fields,
          people: people.map((p) => ({ userId: p.user_id, name: p.name, email: p.email, hasAvatar: p.has_avatar, role: p.role, canReview: p.can_review })),
          cursor: Number(cursor?.max ?? 0),
        };
      }),
  }),

  route({
    method: "PATCH",
    path: "/boards/:boardId",
    summary: "Editar nombre, color o visibilidad del tablero",
    tag: "Tableros",
    body: boardBody.partial().extend({
      qaRequired: z.boolean().optional(),
      qaListId: z.uuid().nullable().optional(),
      doneListId: z.uuid().nullable().optional(),
      isTemplate: z.boolean().optional(),
    }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        const listIds = [body.qaListId, body.doneListId].filter(Boolean) as string[];
        if (listIds.length) {
          const found = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.boardId, board.id), inArray(lists.id, listIds)));
          if (found.length !== new Set(listIds).size) throw badRequest("Lista inválida para este tablero");
        }
        const qaRequired = body.qaRequired ?? board.qaRequired;
        if (qaRequired && !(body.qaListId !== undefined ? body.qaListId : board.qaListId)) throw badRequest("Elegí la lista de revisión para el control de calidad");
        if (qaRequired && !(body.doneListId !== undefined ? body.doneListId : board.doneListId)) throw badRequest("Elegí la lista de terminado para el control de calidad");
        await tx.update(boards).set(body).where(eq(boards.id, board.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "board.updated", data: { fields: Object.keys(body) } });
        if (body.visibility || body.workspaceAccess) {
          await audit(tx, actx, "board.access_changed", {
            orgId: board.orgId,
            targetType: "board",
            targetId: board.id,
            data: { visibility: body.visibility, workspaceAccess: body.workspaceAccess },
          });
        }
        return { ok: true };
      }),
  }),

  route({
    method: "POST",
    path: "/boards/:boardId/archive",
    summary: "Archivar o restaurar un tablero",
    tag: "Tableros",
    body: z.object({ archived: z.boolean() }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "manage");
        await tx.update(boards).set({ archivedAt: body.archived ? new Date() : null }).where(eq(boards.id, board.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: body.archived ? "board.archived" : "board.restored" });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/boards/:boardId",
    summary: "Eliminar un tablero definitivamente",
    tag: "Tableros",
    body: z.object({ confirmName: z.string() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        if (board.name !== body.confirmName) throw badRequest("El nombre de confirmación no coincide");
        await audit(tx, actx, "board.deleted", { orgId: board.orgId, targetType: "board", targetId: board.id, data: { name: board.name } });
        await tx.delete(boards).where(eq(boards.id, board.id));
        return undefined;
      }),
  }),

  route({
    method: "GET",
    path: "/boards/:boardId/members",
    summary: "Miembros explícitos del tablero",
    tag: "Tableros",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "view");
        const rows = await tx
          .select({ userId: users.id, name: users.name, email: users.email, hasAvatar: sql<boolean>`${users.avatarKey} is not null`, role: boardMembers.role })
          .from(boardMembers)
          .innerJoin(users, eq(users.id, boardMembers.userId))
          .where(eq(boardMembers.boardId, board.id))
          .orderBy(users.name);
        return { members: rows };
      }),
  }),

  route({
    method: "PUT",
    path: "/boards/:boardId/members/:userId",
    summary: "Agregar a un miembro de la organización al tablero o cambiar su rol",
    tag: "Tableros",
    body: z.object({ role: z.enum(["admin", "editor", "commenter", "viewer"]), canReview: z.boolean().optional() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        const [target] = await tx
          .select()
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, board.orgId), eq(organizationMembers.userId, params.userId)));
        if (!target) throw notFound("Miembro");
        const [existing] = await tx
          .select()
          .from(boardMembers)
          .where(and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, params.userId)));
        if (existing?.role === "admin" && body.role !== "admin") await assertAnotherBoardAdmin(tx, board.id, params.userId);
        await tx
          .insert(boardMembers)
          .values({ orgId: board.orgId, boardId: board.id, userId: params.userId, role: body.role, canReview: body.canReview ?? false })
          .onConflictDoUpdate({
            target: [boardMembers.boardId, boardMembers.userId],
            set: { role: body.role, ...(body.canReview !== undefined ? { canReview: body.canReview } : {}) },
          });
        if (!existing) {
          await notify(tx, {
            orgId: board.orgId,
            userIds: [params.userId],
            actorId: me.id,
            type: "board.added",
            boardId: board.id,
            data: { boardName: board.name, role: body.role },
          });
        }
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "board.member_set", data: { userId: params.userId, role: body.role } });
        await audit(tx, actx, "board.member_set", {
          orgId: board.orgId,
          targetType: "user",
          targetId: params.userId,
          data: { boardId: board.id, role: body.role },
        });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/boards/:boardId/members/:userId",
    summary: "Quitar a alguien del tablero (o salir)",
    tag: "Tableros",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const self = params.userId === me.id;
        const { board } = await boardAccess(tx, actx, params.boardId, self ? "view" : "manage");
        const [existing] = await tx
          .select()
          .from(boardMembers)
          .where(and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, params.userId)));
        if (!existing) throw notFound("Miembro");
        if (existing.role === "admin") await assertAnotherBoardAdmin(tx, board.id, params.userId);
        await tx.delete(boardMembers).where(and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, params.userId)));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "board.member_removed", data: { userId: params.userId } });
        await audit(tx, actx, "board.member_removed", { orgId: board.orgId, targetType: "user", targetId: params.userId, data: { boardId: board.id } });
        return undefined;
      }),
  }),

  route({
    method: "POST",
    path: "/boards/:boardId/invitations",
    summary: "Invitar por correo a un tablero",
    tag: "Invitaciones",
    status: 201,
    rateLimit: [{ name: "invite", by: "user", limit: 30, windowSec: 3600 }],
    body: z.object({ email: emailSchema, role: z.enum(["admin", "editor", "commenter", "viewer"]) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { id, mail } = await withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "manage");
        const created = await createInvitation(tx, {
          orgId: board.orgId,
          email: body.email,
          inviter: me,
          targetName: board.name,
          scope: "board",
          boardId: board.id,
          role: body.role,
        });
        await audit(tx, actx, "invitation.created", {
          orgId: board.orgId,
          targetType: "invitation",
          targetId: created.id,
          data: { scope: "board", role: body.role },
        });
        return created;
      });
      await sendMail(mail);
      return { id };
    },
  }),

  route({
    method: "GET",
    path: "/boards/:boardId/changes",
    summary: "Cambios del tablero desde un cursor (actualización casi en tiempo real por sondeo)",
    tag: "Tableros",
    query: z.object({ after: z.coerce.number().int().min(0).default(0) }),
    handler: async ({ me, params, query }) =>
      withUser(me.id, async (tx) => {
        await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const rows = await tx
          .select({
            id: activityLogs.id,
            action: activityLogs.action,
            cardId: activityLogs.cardId,
            actorId: activityLogs.actorId,
            actorName: users.name,
            data: activityLogs.data,
            createdAt: activityLogs.createdAt,
          })
          .from(activityLogs)
          .leftJoin(users, eq(users.id, activityLogs.actorId))
          .where(
            and(
              gt(activityLogs.id, query.after),
              // También los cambios de tarjetas espejadas acá (si la persona ve el tablero original).
              sql`(${activityLogs.boardId} = ${params.boardId} or ${activityLogs.cardId} in (
                select m.card_id from app.card_mirrors m join app.cards c on c.id = m.card_id
                join app.my_boards mb on mb.board_id = c.board_id where m.board_id = ${params.boardId}))`,
            ),
          )
          .orderBy(asc(activityLogs.id))
          .limit(100);
        return { cursor: rows.length ? rows[rows.length - 1]!.id : query.after, changes: rows };
      }),
  }),

  route({
    method: "GET",
    path: "/boards/:boardId/activity",
    summary: "Historial de actividad del tablero",
    tag: "Tableros",
    query: z.object({ before: z.coerce.number().int().positive().optional() }),
    handler: async ({ me, params, query }) =>
      withUser(me.id, async (tx) => {
        await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const rows = await tx
          .select({
            id: activityLogs.id,
            action: activityLogs.action,
            cardId: activityLogs.cardId,
            cardTitle: cards.title,
            actorId: activityLogs.actorId,
            actorName: users.name,
            data: activityLogs.data,
            createdAt: activityLogs.createdAt,
          })
          .from(activityLogs)
          .leftJoin(users, eq(users.id, activityLogs.actorId))
          .leftJoin(cards, eq(cards.id, activityLogs.cardId))
          .where(and(eq(activityLogs.boardId, params.boardId), query.before ? lt(activityLogs.id, query.before) : undefined))
          .orderBy(desc(activityLogs.id))
          .limit(40);
        return { entries: rows, nextBefore: rows.length === 40 ? rows[rows.length - 1]!.id : null };
      }),
  }),

  route({
    method: "GET",
    path: "/boards/:boardId/archived",
    summary: "Listas y tarjetas archivadas del tablero",
    tag: "Tableros",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const listRows = await tx
          .select({ id: lists.id, name: lists.name, archivedAt: lists.archivedAt })
          .from(lists)
          .where(and(eq(lists.boardId, board.id), isNotNull(lists.archivedAt)))
          .orderBy(desc(lists.archivedAt));
        const cardRows = await tx
          .select({ id: cards.id, title: cards.title, listId: cards.listId, listName: lists.name, archivedAt: cards.archivedAt })
          .from(cards)
          .innerJoin(lists, eq(lists.id, cards.listId))
          .where(and(eq(cards.boardId, board.id), isNotNull(cards.archivedAt)))
          .orderBy(desc(cards.archivedAt));
        return { lists: listRows, cards: cardRows };
      }),
  }),

  // ───────────── Listas ─────────────

  route({
    method: "POST",
    path: "/boards/:boardId/lists",
    summary: "Crear una lista",
    tag: "Listas",
    status: 201,
    body: z.object({ name: listName, color: colorSchema.default("slate"), afterListId: afterId }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "edit");
        const position = await positionAfter(tx, "lists", board.id, body.afterListId);
        const id = uuidv7();
        await tx.insert(lists).values({ id, orgId: board.orgId, boardId: board.id, name: body.name, color: body.color, position });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "list.created", data: { listId: id, name: body.name } });
        return { id, position };
      }),
  }),

  route({
    method: "PATCH",
    path: "/lists/:listId",
    summary: "Renombrar o cambiar el color de una lista",
    tag: "Listas",
    body: z.object({ name: listName.optional(), color: colorSchema.optional() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const list = await listInBoard(tx, params.listId);
        const { board } = await boardAccess(tx, actx, list.boardId, "edit");
        await tx.update(lists).set(body).where(eq(lists.id, list.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "list.updated", data: { listId: list.id, name: body.name ?? list.name } });
        return { ok: true };
      }),
  }),

  route({
    method: "POST",
    path: "/lists/:listId/move",
    summary: "Reordenar una lista",
    tag: "Listas",
    body: z.object({ afterListId: z.uuid().nullable() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const list = await listInBoard(tx, params.listId);
        const { board } = await boardAccess(tx, actx, list.boardId, "edit");
        if (body.afterListId === list.id) throw badRequest("Posición inválida");
        const position = await positionAfter(tx, "lists", board.id, body.afterListId, list.id);
        await tx.update(lists).set({ position }).where(eq(lists.id, list.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "list.moved", data: { listId: list.id, name: list.name } });
        return { position };
      }),
  }),

  route({
    method: "POST",
    path: "/lists/:listId/archive",
    summary: "Archivar o restaurar una lista",
    tag: "Listas",
    body: z.object({ archived: z.boolean() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const list = await listInBoard(tx, params.listId);
        const { board } = await boardAccess(tx, actx, list.boardId, "edit");
        await tx.update(lists).set({ archivedAt: body.archived ? new Date() : null }).where(eq(lists.id, list.id));
        await logActivity(tx, {
          orgId: board.orgId,
          boardId: board.id,
          actorId: me.id,
          action: body.archived ? "list.archived" : "list.restored",
          data: { listId: list.id, name: list.name },
        });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/lists/:listId",
    summary: "Eliminar una lista archivada y sus tarjetas",
    tag: "Listas",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const list = await listInBoard(tx, params.listId);
        const { board } = await boardAccess(tx, actx, list.boardId, "manage");
        if (!list.archivedAt) throw conflict("Archivá la lista antes de eliminarla");
        await tx.delete(lists).where(eq(lists.id, list.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "list.deleted", data: { name: list.name } });
        return undefined;
      }),
  }),

  // ───────────── Etiquetas ─────────────

  route({
    method: "POST",
    path: "/boards/:boardId/labels",
    summary: "Crear una etiqueta",
    tag: "Etiquetas",
    status: 201,
    body: z.object({ name: z.string().trim().min(1).max(40), color: colorSchema }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "edit");
        const id = uuidv7();
        await tx.insert(labels).values({ id, orgId: board.orgId, boardId: board.id, name: body.name, color: body.color });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "label.created", data: { name: body.name } });
        return { id };
      }),
  }),

  route({
    method: "PATCH",
    path: "/labels/:labelId",
    summary: "Editar una etiqueta",
    tag: "Etiquetas",
    body: z.object({ name: z.string().trim().min(1).max(40).optional(), color: colorSchema.optional() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [label] = await tx.select().from(labels).where(eq(labels.id, params.labelId));
        if (!label) throw notFound("Etiqueta");
        const { board } = await boardAccess(tx, actx, label.boardId, "edit");
        await tx.update(labels).set(body).where(eq(labels.id, label.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "label.updated", data: { name: body.name ?? label.name } });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/labels/:labelId",
    summary: "Eliminar una etiqueta",
    tag: "Etiquetas",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [label] = await tx.select().from(labels).where(eq(labels.id, params.labelId));
        if (!label) throw notFound("Etiqueta");
        const { board } = await boardAccess(tx, actx, label.boardId, "edit");
        await tx.delete(labels).where(eq(labels.id, label.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "label.deleted", data: { name: label.name } });
        return undefined;
      }),
  }),
];

async function assertAnotherBoardAdmin(tx: Tx, boardId: string, leavingUserId: string) {
  const admins = await tx
    .select({ userId: boardMembers.userId })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.role, "admin")));
  if (admins.filter((a) => a.userId !== leavingUserId).length === 0) {
    throw conflict("El tablero necesita al menos un administrador");
  }
}
