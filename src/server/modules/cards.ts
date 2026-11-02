import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser, type Tx } from "../db/client";
import {
  activityLogs,
  attachments,
  cardAssignees,
  cardLabels,
  cardRelations,
  cards,
  checklistItems,
  checklists,
  commentMentions,
  comments,
  labels,
  lists,
  myBoards,
  users,
} from "../db/schema";
import { storage } from "../storage/storage";
import { boardAccess, boardUserRoles, canBoard, cardAccess } from "./access";
import { downloadResponse, IMAGE_TYPES, MAX_ATTACHMENT_BYTES, validateUpload } from "./files";
import { positionAfter } from "./positions";
import { richTextInput, sanitizeRichText } from "./richtext";
import { logActivity, notify } from "./shared";
import { schedulePush } from "../integrations/sync";

const title = z.string().trim().min(1, "Ingresá un título").max(200);
const priority = z.enum(["none", "low", "medium", "high", "urgent"]);
const dueAt = z.iso.datetime({ offset: true }).nullable();

/** Las menciones viajan en el texto como @[Nombre](uuid); el render las muestra como texto plano. */
const MENTION_RE = /@\[[^\]\n]{1,80}\]\(([0-9a-f-]{36})\)/gi;
export const extractMentions = (body: string) => [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[1]!.toLowerCase()))];

async function assertBoardUsers(tx: Tx, boardId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const roles = await boardUserRoles(tx, boardId);
  if (userIds.some((id) => !roles.has(id))) throw badRequest("Solo podés asignar a personas con acceso al tablero");
}

async function cardDetail(tx: Tx, cardId: string) {
  const [card] = await tx.select().from(cards).where(eq(cards.id, cardId));
  if (!card) throw notFound("Tarjeta");
  const [list] = await tx.select({ id: lists.id, name: lists.name }).from(lists).where(eq(lists.id, card.listId));
  const [assignees, labelRows, checklistRows, itemRows, attachmentRows, relationRows, creator] = await Promise.all([
    tx.select({ userId: cardAssignees.userId }).from(cardAssignees).where(eq(cardAssignees.cardId, card.id)),
    tx.select({ labelId: cardLabels.labelId }).from(cardLabels).where(eq(cardLabels.cardId, card.id)),
    tx.select().from(checklists).where(eq(checklists.cardId, card.id)).orderBy(asc(checklists.position), asc(checklists.id)),
    tx
      .select({ item: checklistItems })
      .from(checklistItems)
      .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
      .where(eq(checklists.cardId, card.id))
      .orderBy(asc(checklistItems.position), asc(checklistItems.id)),
    tx
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        mime: attachments.mime,
        sizeBytes: attachments.sizeBytes,
        uploaderId: attachments.uploaderId,
        uploaderName: users.name,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .leftJoin(users, eq(users.id, attachments.uploaderId))
      .where(eq(attachments.cardId, card.id))
      .orderBy(desc(attachments.createdAt)),
    tx.execute<{ card_id: string; title: string; board_id: string; board_name: string; type: string; direction: "out" | "in"; completed: boolean }>(sql`
      select c.id as card_id, c.title, c.board_id, b.name as board_name, r.type, 'out' as direction, c.completed_at is not null as completed
      from app.card_relations r join app.cards c on c.id = r.to_card_id join app.boards b on b.id = c.board_id
      join app.my_boards mb on mb.board_id = c.board_id
      where r.from_card_id = ${card.id}
      union all
      select c.id, c.title, c.board_id, b.name, r.type, 'in', c.completed_at is not null
      from app.card_relations r join app.cards c on c.id = r.from_card_id join app.boards b on b.id = c.board_id
      join app.my_boards mb on mb.board_id = c.board_id
      where r.to_card_id = ${card.id}`),
    card.createdBy ? tx.select({ name: users.name }).from(users).where(eq(users.id, card.createdBy)) : Promise.resolve([]),
  ]);
  return {
    id: card.id,
    boardId: card.boardId,
    listId: card.listId,
    listName: list?.name ?? "",
    title: card.title,
    description: card.description,
    priority: card.priority,
    ownerId: card.ownerId,
    dueAt: card.dueAt,
    completedAt: card.completedAt,
    archivedAt: card.archivedAt,
    createdAt: card.createdAt,
    createdByName: creator[0]?.name ?? null,
    updatedAt: card.updatedAt,
    assigneeIds: assignees.map((a) => a.userId),
    labelIds: labelRows.map((l) => l.labelId),
    checklists: checklistRows.map((c) => ({
      id: c.id,
      title: c.title,
      items: itemRows
        .filter((r) => r.item.checklistId === c.id)
        .map((r) => ({ id: r.item.id, text: r.item.text, done: r.item.doneAt !== null })),
    })),
    attachments: attachmentRows.map((a) => ({ ...a, isImage: IMAGE_TYPES.has(a.mime) })),
    relations: relationRows.map((r) => ({
      cardId: r.card_id,
      title: r.title,
      boardId: r.board_id,
      boardName: r.board_name,
      type: r.type,
      direction: r.direction,
      completed: r.completed,
    })),
  };
}

async function checklistAccess(tx: Tx, me: string, checklistId: string, action: "view" | "edit") {
  const [cl] = await tx.select().from(checklists).where(eq(checklists.id, checklistId));
  if (!cl) throw notFound("Checklist");
  const access = await cardAccess(tx, { actorId: me }, cl.cardId, action);
  return { checklist: cl, ...access };
}

export const cardRoutes = [
  route({
    method: "POST",
    path: "/lists/:listId/cards",
    summary: "Crear una tarjeta al final de una lista",
    tag: "Tarjetas",
    status: 201,
    body: z.object({ title }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [list] = await tx.select().from(lists).where(eq(lists.id, params.listId));
        if (!list || list.archivedAt) throw notFound("Lista");
        const { board } = await boardAccess(tx, actx, list.boardId, "edit");
        const position = await positionAfter(tx, "cards", list.id, undefined);
        const id = uuidv7();
        await tx.insert(cards).values({ id, orgId: board.orgId, boardId: board.id, listId: list.id, title: body.title, priority: "none", position, createdBy: me.id });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: id, actorId: me.id, action: "card.created", data: { title: body.title, list: list.name } });
        return { id, position };
      }),
  }),

  route({
    method: "GET",
    path: "/cards/:cardId",
    summary: "Detalle completo de una tarjeta",
    tag: "Tarjetas",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { role } = await cardAccess(tx, { actorId: me.id }, params.cardId, "view");
        return { card: await cardDetail(tx, params.cardId), role };
      }),
  }),

  route({
    method: "PATCH",
    path: "/cards/:cardId",
    summary: "Editar una tarjeta (título, descripción, prioridad, responsable, vencimiento, estado)",
    tag: "Tarjetas",
    body: z.object({
      title: title.optional(),
      description: richTextInput.optional(),
      priority: priority.optional(),
      ownerId: z.uuid().nullable().optional(),
      dueAt: dueAt.optional(),
      completed: z.boolean().optional(),
      expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
    }),
    handler: async ({ me, params, body, audit: actx }) => {
      const result = await withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        if (body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== card.updatedAt.getTime()) {
          throw conflict("Otra persona modificó esta tarjeta. Recargá para ver los cambios.", "stale_update");
        }
        const patch: Partial<typeof cards.$inferInsert> = {};
        const changed: string[] = [];
        if (body.title !== undefined && body.title !== card.title) {
          patch.title = body.title;
          changed.push("title");
        }
        if (body.description !== undefined) {
          const { json, text } = sanitizeRichText(body.description);
          patch.description = json;
          patch.descriptionText = text;
          changed.push("description");
        }
        if (body.priority !== undefined && body.priority !== card.priority) {
          patch.priority = body.priority;
          changed.push("priority");
        }
        if (body.ownerId !== undefined && body.ownerId !== card.ownerId) {
          if (body.ownerId) await assertBoardUsers(tx, board.id, [body.ownerId]);
          patch.ownerId = body.ownerId;
          changed.push("owner");
        }
        if (body.dueAt !== undefined) {
          patch.dueAt = body.dueAt ? new Date(body.dueAt) : null;
          changed.push("dueAt");
        }
        if (body.completed !== undefined && body.completed !== (card.completedAt !== null)) {
          patch.completedAt = body.completed ? new Date() : null;
          changed.push("completed");
        }
        if (changed.length === 0) return { card: await cardDetail(tx, card.id) };
        await tx.update(cards).set(patch).where(eq(cards.id, card.id));
        const action = changed.length === 1 && changed[0] === "completed" ? (body.completed ? "card.completed" : "card.reopened") : "card.updated";
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action, data: { title: patch.title ?? card.title, fields: changed } });
        if (patch.ownerId) {
          await notify(tx, { orgId: board.orgId, userIds: [patch.ownerId], actorId: me.id, type: "card.owner", boardId: board.id, cardId: card.id, data: { cardTitle: patch.title ?? card.title, boardName: board.name } });
        }
        return { card: await cardDetail(tx, card.id) };
      });
      await schedulePush(params.cardId);
      return result;
    },
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/move",
    summary: "Mover una tarjeta a otra lista o posición",
    tag: "Tarjetas",
    body: z.object({ listId: z.uuid(), afterCardId: z.uuid().nullable() }),
    handler: async ({ me, params, body, audit: actx }) => {
      const result = await withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        const [target] = await tx.select().from(lists).where(and(eq(lists.id, body.listId), eq(lists.boardId, board.id), isNull(lists.archivedAt)));
        if (!target) throw badRequest("La lista de destino no pertenece a este tablero");
        if (body.afterCardId === card.id) throw badRequest("Posición inválida");
        const position = await positionAfter(tx, "cards", target.id, body.afterCardId, card.id);
        await tx.update(cards).set({ listId: target.id, position }).where(eq(cards.id, card.id));
        if (target.id !== card.listId) {
          const [from] = await tx.select({ name: lists.name }).from(lists).where(eq(lists.id, card.listId));
          await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "card.moved", data: { title: card.title, from: from?.name, to: target.name } });
        } else {
          await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "card.reordered", data: { title: card.title } });
        }
        return { position, listId: target.id };
      });
      await schedulePush(params.cardId);
      return result;
    },
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/archive",
    summary: "Archivar o restaurar una tarjeta",
    tag: "Tarjetas",
    body: z.object({ archived: z.boolean() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        if (!body.archived) {
          const [list] = await tx.select().from(lists).where(eq(lists.id, card.listId));
          if (list?.archivedAt) throw conflict("La lista de esta tarjeta está archivada. Restaurala primero.");
        }
        await tx.update(cards).set({ archivedAt: body.archived ? new Date() : null }).where(eq(cards.id, card.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: body.archived ? "card.archived" : "card.restored", data: { title: card.title } });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/cards/:cardId",
    summary: "Eliminar definitivamente una tarjeta archivada",
    tag: "Tarjetas",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        if (!card.archivedAt) throw conflict("Archivá la tarjeta antes de eliminarla");
        await tx.delete(cards).where(eq(cards.id, card.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "card.deleted", data: { title: card.title } });
        return undefined;
      }),
  }),

  route({
    method: "PUT",
    path: "/cards/:cardId/assignees",
    summary: "Definir colaboradores asignados",
    tag: "Tarjetas",
    body: z.object({ userIds: z.array(z.uuid()).max(20) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        const wanted = [...new Set(body.userIds)];
        await assertBoardUsers(tx, board.id, wanted);
        const current = (await tx.select({ userId: cardAssignees.userId }).from(cardAssignees).where(eq(cardAssignees.cardId, card.id))).map((r) => r.userId);
        const added = wanted.filter((id) => !current.includes(id));
        const removed = current.filter((id) => !wanted.includes(id));
        if (removed.length) await tx.delete(cardAssignees).where(and(eq(cardAssignees.cardId, card.id), inArray(cardAssignees.userId, removed)));
        if (added.length) await tx.insert(cardAssignees).values(added.map((userId) => ({ orgId: board.orgId, cardId: card.id, userId })));
        if (added.length || removed.length) {
          await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "card.assignees", data: { title: card.title, added, removed } });
          await notify(tx, { orgId: board.orgId, userIds: added, actorId: me.id, type: "card.assigned", boardId: board.id, cardId: card.id, data: { cardTitle: card.title, boardName: board.name } });
        }
        return { assigneeIds: wanted };
      }),
  }),

  route({
    method: "PUT",
    path: "/cards/:cardId/labels",
    summary: "Definir las etiquetas de una tarjeta",
    tag: "Tarjetas",
    body: z.object({ labelIds: z.array(z.uuid()).max(20) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const result = await withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        const wanted = [...new Set(body.labelIds)];
        if (wanted.length) {
          const valid = await tx.select({ id: labels.id }).from(labels).where(and(eq(labels.boardId, board.id), inArray(labels.id, wanted)));
          if (valid.length !== wanted.length) throw badRequest("Etiqueta inválida para este tablero");
        }
        await tx.delete(cardLabels).where(eq(cardLabels.cardId, card.id));
        if (wanted.length) await tx.insert(cardLabels).values(wanted.map((labelId) => ({ orgId: board.orgId, boardId: board.id, cardId: card.id, labelId })));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "card.labels", data: { title: card.title } });
        return { labelIds: wanted };
      });
      await schedulePush(params.cardId);
      return result;
    },
  }),

  route({
    method: "GET",
    path: "/cards/:cardId/activity",
    summary: "Historial de cambios de la tarjeta",
    tag: "Tarjetas",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await cardAccess(tx, { actorId: me.id }, params.cardId, "view");
        const rows = await tx
          .select({ id: activityLogs.id, action: activityLogs.action, actorId: activityLogs.actorId, actorName: users.name, data: activityLogs.data, createdAt: activityLogs.createdAt })
          .from(activityLogs)
          .leftJoin(users, eq(users.id, activityLogs.actorId))
          .where(eq(activityLogs.cardId, params.cardId))
          .orderBy(desc(activityLogs.id))
          .limit(100);
        return { entries: rows };
      }),
  }),

  // ───────────── Relaciones ─────────────

  route({
    method: "POST",
    path: "/cards/:cardId/relations",
    summary: "Relacionar la tarjeta con otra de la misma organización",
    tag: "Tarjetas",
    status: 201,
    body: z.object({ toCardId: z.uuid(), type: z.enum(["blocks", "relates", "duplicates"]) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        if (body.toCardId === card.id) throw badRequest("Una tarjeta no puede relacionarse consigo misma");
        const { card: other } = await cardAccess(tx, actx, body.toCardId, "view");
        if (other.orgId !== card.orgId) throw notFound("Tarjeta");
        await tx.insert(cardRelations).values({ orgId: card.orgId, fromCardId: card.id, toCardId: other.id, type: body.type, createdBy: me.id }).onConflictDoNothing();
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "card.relation_added", data: { title: card.title, other: other.title, type: body.type } });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/cards/:cardId/relations/:otherCardId",
    summary: "Quitar una relación entre tarjetas",
    tag: "Tarjetas",
    query: z.object({ type: z.enum(["blocks", "relates", "duplicates"]) }),
    handler: async ({ me, params, query, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        await tx
          .delete(cardRelations)
          .where(
            and(
              eq(cardRelations.type, query.type),
              or(
                and(eq(cardRelations.fromCardId, card.id), eq(cardRelations.toCardId, params.otherCardId)),
                and(eq(cardRelations.fromCardId, params.otherCardId), eq(cardRelations.toCardId, card.id)),
              ),
            ),
          );
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "card.relation_removed", data: { title: card.title } });
        return undefined;
      }),
  }),

  route({
    method: "GET",
    path: "/cards/:cardId/relation-candidates",
    summary: "Buscar tarjetas para relacionar",
    tag: "Tarjetas",
    query: z.object({ q: z.string().trim().max(100).default("") }),
    handler: async ({ me, params, query }) =>
      withUser(me.id, async (tx) => {
        const { card } = await cardAccess(tx, { actorId: me.id }, params.cardId, "view");
        const rows = await tx
          .select({ id: cards.id, title: cards.title, boardId: cards.boardId })
          .from(cards)
          .innerJoin(myBoards, eq(myBoards.boardId, cards.boardId))
          .where(
            and(
              eq(cards.orgId, card.orgId),
              sql`${cards.id} <> ${card.id}`,
              isNull(cards.archivedAt),
              query.q ? sql`${cards.title} ilike ${"%" + query.q.replace(/[%_\\]/g, "\\$&") + "%"}` : undefined,
            ),
          )
          .orderBy(desc(cards.updatedAt))
          .limit(15);
        return { cards: rows };
      }),
  }),

  // ───────────── Checklists ─────────────

  route({
    method: "POST",
    path: "/cards/:cardId/checklists",
    summary: "Agregar un checklist",
    tag: "Checklists",
    status: 201,
    body: z.object({ title: z.string().trim().min(1).max(100) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        const id = uuidv7();
        await tx.insert(checklists).values({ id, orgId: card.orgId, cardId: card.id, title: body.title, position: await positionAfter(tx, "checklists", card.id, undefined) });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "checklist.created", data: { title: card.title, checklist: body.title } });
        return { id };
      }),
  }),

  route({
    method: "PATCH",
    path: "/checklists/:checklistId",
    summary: "Renombrar un checklist",
    tag: "Checklists",
    body: z.object({ title: z.string().trim().min(1).max(100) }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const { checklist, board, card } = await checklistAccess(tx, me.id, params.checklistId, "edit");
        await tx.update(checklists).set({ title: body.title }).where(eq(checklists.id, checklist.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "checklist.updated", data: { title: card.title } });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/checklists/:checklistId",
    summary: "Eliminar un checklist",
    tag: "Checklists",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { checklist, board, card } = await checklistAccess(tx, me.id, params.checklistId, "edit");
        await tx.delete(checklists).where(eq(checklists.id, checklist.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "checklist.deleted", data: { title: card.title, checklist: checklist.title } });
        return undefined;
      }),
  }),

  route({
    method: "POST",
    path: "/checklists/:checklistId/items",
    summary: "Agregar un ítem al checklist",
    tag: "Checklists",
    status: 201,
    body: z.object({ text: z.string().trim().min(1).max(300) }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const { checklist, board, card } = await checklistAccess(tx, me.id, params.checklistId, "edit");
        const id = uuidv7();
        await tx.insert(checklistItems).values({ id, orgId: card.orgId, checklistId: checklist.id, text: body.text, position: await positionAfter(tx, "checklist_items", checklist.id, undefined) });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "checklist.item_added", data: { title: card.title } });
        return { id };
      }),
  }),

  route({
    method: "PATCH",
    path: "/checklist-items/:itemId",
    summary: "Editar o marcar un ítem del checklist",
    tag: "Checklists",
    body: z.object({ text: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const [item] = await tx.select().from(checklistItems).where(eq(checklistItems.id, params.itemId));
        if (!item) throw notFound("Ítem");
        const { board, card } = await checklistAccess(tx, me.id, item.checklistId, "edit");
        const patch: Partial<typeof checklistItems.$inferInsert> = {};
        if (body.text !== undefined) patch.text = body.text;
        if (body.done !== undefined) {
          patch.doneAt = body.done ? new Date() : null;
          patch.doneBy = body.done ? me.id : null;
        }
        await tx.update(checklistItems).set(patch).where(eq(checklistItems.id, item.id));
        await logActivity(tx, {
          orgId: board.orgId,
          boardId: board.id,
          cardId: card.id,
          actorId: me.id,
          action: body.done === undefined ? "checklist.item_updated" : body.done ? "checklist.item_done" : "checklist.item_undone",
          data: { title: card.title, item: body.text ?? item.text },
        });
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/checklist-items/:itemId",
    summary: "Eliminar un ítem del checklist",
    tag: "Checklists",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const [item] = await tx.select().from(checklistItems).where(eq(checklistItems.id, params.itemId));
        if (!item) throw notFound("Ítem");
        const { board, card } = await checklistAccess(tx, me.id, item.checklistId, "edit");
        await tx.delete(checklistItems).where(eq(checklistItems.id, item.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "checklist.item_removed", data: { title: card.title } });
        return undefined;
      }),
  }),

  // ───────────── Comentarios ─────────────

  route({
    method: "GET",
    path: "/cards/:cardId/comments",
    summary: "Comentarios de una tarjeta",
    tag: "Comentarios",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await cardAccess(tx, { actorId: me.id }, params.cardId, "view");
        const rows = await tx
          .select({
            id: comments.id,
            authorId: comments.authorId,
            authorName: users.name,
            authorHasAvatar: sql<boolean>`${users.avatarKey} is not null`,
            body: comments.body,
            createdAt: comments.createdAt,
            editedAt: comments.editedAt,
          })
          .from(comments)
          .leftJoin(users, eq(users.id, comments.authorId))
          .where(and(eq(comments.cardId, params.cardId), isNull(comments.deletedAt)))
          .orderBy(asc(comments.createdAt));
        return { comments: rows };
      }),
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/comments",
    summary: "Comentar (con menciones @[Nombre](id))",
    tag: "Comentarios",
    status: 201,
    rateLimit: [{ name: "comment", by: "user", limit: 60, windowSec: 60 }],
    body: z.object({ body: z.string().trim().min(1, "Escribí un comentario").max(5000) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "comment");
        const id = uuidv7();
        await tx.insert(comments).values({ id, orgId: card.orgId, cardId: card.id, authorId: me.id, body: body.body });
        const roles = await boardUserRoles(tx, board.id);
        const mentioned = extractMentions(body.body).filter((uid) => roles.has(uid));
        if (mentioned.length) await tx.insert(commentMentions).values(mentioned.map((userId) => ({ orgId: card.orgId, commentId: id, userId })));
        const data = { cardTitle: card.title, boardName: board.name, excerpt: body.body.replace(MENTION_RE, (m) => m.slice(2, m.indexOf("]"))).slice(0, 140) };
        await notify(tx, { orgId: card.orgId, userIds: mentioned, actorId: me.id, type: "comment.mention", boardId: board.id, cardId: card.id, data });
        const followers = new Set<string>((await tx.select({ userId: cardAssignees.userId }).from(cardAssignees).where(eq(cardAssignees.cardId, card.id))).map((a) => a.userId));
        if (card.ownerId) followers.add(card.ownerId);
        mentioned.forEach((m) => followers.delete(m));
        await notify(tx, { orgId: card.orgId, userIds: followers, actorId: me.id, type: "comment.created", boardId: board.id, cardId: card.id, data });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "comment.created", data: { title: card.title } });
        return { id };
      }),
  }),

  route({
    method: "PATCH",
    path: "/comments/:commentId",
    summary: "Editar un comentario propio",
    tag: "Comentarios",
    body: z.object({ body: z.string().trim().min(1).max(5000) }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const [c] = await tx.select().from(comments).where(and(eq(comments.id, params.commentId), isNull(comments.deletedAt)));
        if (!c) throw notFound("Comentario");
        await cardAccess(tx, { actorId: me.id }, c.cardId, "comment");
        if (c.authorId !== me.id) throw forbidden("Solo podés editar tus comentarios");
        await tx.update(comments).set({ body: body.body, editedAt: new Date() }).where(eq(comments.id, c.id));
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/comments/:commentId",
    summary: "Eliminar un comentario (autor o administrador del tablero)",
    tag: "Comentarios",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [c] = await tx.select().from(comments).where(and(eq(comments.id, params.commentId), isNull(comments.deletedAt)));
        if (!c) throw notFound("Comentario");
        const { role, board, card } = await cardAccess(tx, actx, c.cardId, "view");
        if (c.authorId !== me.id && !canBoard(role, "manage")) throw forbidden();
        await tx.update(comments).set({ deletedAt: new Date(), body: "[eliminado]" }).where(eq(comments.id, c.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "comment.deleted", data: { title: card.title } });
        if (c.authorId !== me.id) {
          await audit(tx, actx, "comment.moderated", { orgId: board.orgId, targetType: "comment", targetId: c.id });
        }
        return undefined;
      }),
  }),

  // ───────────── Adjuntos ─────────────

  route({
    method: "POST",
    path: "/cards/:cardId/attachments",
    summary: "Subir un adjunto (máx. 4 MB; tipos permitidos validados por contenido)",
    tag: "Adjuntos",
    status: 201,
    multipart: true,
    rateLimit: [{ name: "upload", by: "user", limit: 30, windowSec: 3600 }],
    handler: async ({ me, params, form, audit: actx }) => {
      // 1) autorizar antes de leer el archivo
      const { card } = await withUser(me.id, (tx) => cardAccess(tx, actx, params.cardId, "edit"));
      const file = await validateUpload(form?.get("file") ?? null, { maxBytes: MAX_ATTACHMENT_BYTES });
      const id = uuidv7();
      const key = `${card.orgId}/${card.id}/${id}`;
      await storage().put(key, file.bytes, file.mime);
      try {
        await withUser(me.id, async (tx) => {
          const { board } = await cardAccess(tx, actx, params.cardId, "edit");
          await tx.insert(attachments).values({ id, orgId: card.orgId, cardId: card.id, uploaderId: me.id, storageKey: key, fileName: file.name, mime: file.mime, sizeBytes: file.size, sha256: file.sha256 });
          await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "attachment.added", data: { title: card.title, file: file.name } });
        });
      } catch (err) {
        await storage().remove([key]).catch(() => {});
        throw err;
      }
      return { id };
    },
  }),

  route({
    method: "GET",
    path: "/attachments/:attachmentId/download",
    summary: "Descargar un adjunto (requiere acceso al tablero)",
    tag: "Adjuntos",
    query: z.object({ inline: z.enum(["1"]).optional() }),
    handler: async ({ me, params, query }) => {
      const att = await withUser(me.id, async (tx) => {
        const [a] = await tx.select().from(attachments).where(eq(attachments.id, params.attachmentId));
        if (!a) throw notFound("Adjunto");
        await cardAccess(tx, { actorId: me.id }, a.cardId, "view");
        return a;
      });
      const bytes = await storage().get(att.storageKey);
      return downloadResponse(bytes, att.mime, att.fileName, query.inline === "1" && IMAGE_TYPES.has(att.mime));
    },
  }),

  route({
    method: "DELETE",
    path: "/attachments/:attachmentId",
    summary: "Eliminar un adjunto",
    tag: "Adjuntos",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [a] = await tx.select().from(attachments).where(eq(attachments.id, params.attachmentId));
        if (!a) throw notFound("Adjunto");
        const { board, card } = await cardAccess(tx, actx, a.cardId, "edit");
        // El trigger agenda el borrado del objeto en storage_gc.
        await tx.delete(attachments).where(eq(attachments.id, a.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: card.id, actorId: me.id, action: "attachment.removed", data: { title: card.title, file: a.fileName } });
        return undefined;
      }),
  }),
];
