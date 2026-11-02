import "server-only";
import { addMonths, addWeeks } from "date-fns";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { audit } from "../core/audit";
import { AppError, badRequest, conflict, forbidden, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser, type Tx } from "../db/client";
import {
  boardMembers,
  boards,
  cardAssignees,
  cardLabels,
  cards,
  cardWatchers,
  checklistItems,
  checklists,
  labels,
  lists,
  myBoards,
  sprints,
  workspaces,
} from "../db/schema";
import { createIssueForCard } from "../integrations/sync";
import { boardAccess, boardUserRoles, cardAccess, workspaceAccess } from "./access";
import { positionAfter } from "./positions";
import { sanitizeRichText } from "./richtext";
import { COLORS, logActivity, notify, type NotificationType } from "./shared";
import { BUILTIN_TEMPLATES, copyBoardContents } from "./templates";

type Board = typeof boards.$inferSelect;
type Card = typeof cards.$inferSelect;

// ───────────── Reglas compartidas con el módulo de tarjetas ─────────────

/** Con control de calidad activo, una tarjeta solo se completa si fue aprobada. */
export function assertCanComplete(board: Board, card: Card) {
  if (board.qaRequired && card.qaStatus !== "approved") {
    throw new AppError(409, "qa_required", "Esta tarea necesita la aprobación de control de calidad antes de terminarse.");
  }
}

/** Efecto de mover una tarjeta sobre su estado de control de calidad. */
export function qaOnMove(board: Board, card: Card, targetListId: string): Partial<Card> {
  if (!board.qaRequired) return {};
  if (targetListId === board.doneListId) {
    assertCanComplete(board, card);
    return {};
  }
  if (targetListId === board.qaListId) return card.qaStatus === "approved" ? {} : { qaStatus: "pending", qaNote: null };
  // Volver a trabajar en una tarea aprobada exige una nueva aprobación.
  return card.qaStatus === "approved" || card.qaStatus === "pending" ? { qaStatus: "none" } : {};
}

export async function assertSprintInBoard(tx: Tx, boardId: string, sprintId: string) {
  const [sp] = await tx.select().from(sprints).where(and(eq(sprints.id, sprintId), eq(sprints.boardId, boardId)));
  if (!sp) throw badRequest("La etapa no pertenece a este tablero");
  if (sp.status === "closed") throw badRequest("La etapa ya está cerrada");
}

/** Subtareas de un solo nivel, dentro del mismo tablero. */
export async function assertValidParent(tx: Tx, card: Card, parentId: string) {
  if (parentId === card.id) throw badRequest("Una tarea no puede ser su propia subtarea");
  const [parent] = await tx.select().from(cards).where(and(eq(cards.id, parentId), eq(cards.boardId, card.boardId)));
  if (!parent) throw badRequest("La tarea principal tiene que estar en el mismo tablero");
  if (parent.parentId) throw badRequest("Una subtarea no puede tener subtareas");
  const [child] = await tx.select({ id: cards.id }).from(cards).where(eq(cards.parentId, card.id)).limit(1);
  if (child) throw badRequest("Esta tarea ya tiene subtareas: no puede ser subtarea de otra");
}

export async function notifyWatchers(
  tx: Tx,
  input: { card: Card; board: Board; actorId: string; type: NotificationType; extra?: Record<string, unknown> },
) {
  const rows = await tx.select({ userId: cardWatchers.userId }).from(cardWatchers).where(eq(cardWatchers.cardId, input.card.id));
  await notify(tx, {
    orgId: input.board.orgId,
    userIds: rows.map((r) => r.userId),
    actorId: input.actorId,
    type: input.type,
    boardId: input.board.id,
    cardId: input.card.id,
    data: { cardTitle: input.card.title, boardName: input.board.name, ...input.extra },
  });
}

/** Al completar una tarea que se repite, crea la próxima con la fecha corrida y el checklist sin marcar. */
export async function spawnRecurrence(tx: Tx, card: Card, actorId: string) {
  if (!card.recurrence) return null;
  const base = card.dueAt ?? new Date();
  const nextDue = card.recurrence === "weekly" ? addWeeks(base, 1) : addMonths(base, 1);
  const [first] = await tx
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.boardId, card.boardId), isNull(lists.archivedAt)))
    .orderBy(asc(lists.position))
    .limit(1);
  const listId = first?.id ?? card.listId;
  const id = uuidv7();
  await tx.insert(cards).values({
    id,
    orgId: card.orgId,
    boardId: card.boardId,
    listId,
    title: card.title,
    description: card.description,
    descriptionText: card.descriptionText,
    priority: card.priority,
    ownerId: card.ownerId,
    dueAt: nextDue,
    position: await positionAfter(tx, "cards", listId, undefined),
    estimatePoints: card.estimatePoints,
    recurrence: card.recurrence,
    createdBy: actorId,
  });
  // La repetición pasa a la tarea nueva.
  await tx.update(cards).set({ recurrence: null }).where(eq(cards.id, card.id));
  const assignees = await tx.select().from(cardAssignees).where(eq(cardAssignees.cardId, card.id));
  if (assignees.length) await tx.insert(cardAssignees).values(assignees.map((a) => ({ orgId: a.orgId, cardId: id, userId: a.userId })));
  const cl = await tx.select().from(cardLabels).where(eq(cardLabels.cardId, card.id));
  if (cl.length) await tx.insert(cardLabels).values(cl.map((l) => ({ ...l, cardId: id })));
  for (const k of await tx.select().from(checklists).where(eq(checklists.cardId, card.id))) {
    const kid = uuidv7();
    await tx.insert(checklists).values({ id: kid, orgId: k.orgId, cardId: id, title: k.title, position: k.position });
    const items = await tx.select().from(checklistItems).where(eq(checklistItems.checklistId, k.id));
    if (items.length) await tx.insert(checklistItems).values(items.map((i) => ({ id: uuidv7(), orgId: i.orgId, checklistId: kid, text: i.text, position: i.position })));
  }
  await logActivity(tx, {
    orgId: card.orgId,
    boardId: card.boardId,
    cardId: id,
    actorId,
    action: "card.recurred",
    data: { title: card.title, due: nextDue.toISOString() },
  });
  return id;
}

/** Copia una tarjeta (sin comentarios, adjuntos ni vínculo con issues) justo debajo de la original. */
async function duplicateCard(tx: Tx, card: Card, actorId: string) {
  const id = uuidv7();
  await tx.insert(cards).values({
    id,
    orgId: card.orgId,
    boardId: card.boardId,
    listId: card.listId,
    title: `${card.title} (copia)`.slice(0, 200),
    description: card.description,
    descriptionText: card.descriptionText,
    priority: card.priority,
    ownerId: card.ownerId,
    dueAt: card.dueAt,
    position: await positionAfter(tx, "cards", card.listId, card.id),
    parentId: card.parentId,
    sprintId: card.sprintId,
    estimatePoints: card.estimatePoints,
    recurrence: card.recurrence,
    createdBy: actorId,
  });
  const assignees = await tx.select().from(cardAssignees).where(eq(cardAssignees.cardId, card.id));
  if (assignees.length) await tx.insert(cardAssignees).values(assignees.map((a) => ({ orgId: a.orgId, cardId: id, userId: a.userId })));
  const cl = await tx.select().from(cardLabels).where(eq(cardLabels.cardId, card.id));
  if (cl.length) await tx.insert(cardLabels).values(cl.map((l) => ({ ...l, cardId: id })));
  for (const k of await tx.select().from(checklists).where(eq(checklists.cardId, card.id))) {
    const kid = uuidv7();
    await tx.insert(checklists).values({ id: kid, orgId: k.orgId, cardId: id, title: k.title, position: k.position });
    const items = await tx.select().from(checklistItems).where(eq(checklistItems.checklistId, k.id));
    if (items.length) {
      await tx.insert(checklistItems).values(items.map((i) => ({ id: uuidv7(), orgId: i.orgId, checklistId: kid, text: i.text, position: i.position, doneAt: i.doneAt })));
    }
  }
  return id;
}

// ───────────── Exportación ─────────────

/** Celda CSV segura: comillas escapadas y sin fórmulas (evita inyección al abrir en Excel). */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PRIORITY_LABEL: Record<string, string> = { none: "", low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const QA_LABEL: Record<string, string> = { none: "", pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada" };

// ───────────── Rutas ─────────────

const sprintBody = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre").max(80),
  goal: z.string().trim().max(500).nullable().optional(),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  capacityPoints: z.number().min(0).max(10000).nullable().optional(),
});

const bulkItem = z.object({
  title: z.string().trim().min(1, "Falta el título").max(200),
  description: z.string().max(5000).optional(),
  listId: z.uuid().optional(),
  priority: z.enum(["none", "low", "medium", "high", "urgent"]).default("none"),
  ownerId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  estimatePoints: z.number().min(0).max(1000).nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  /** Índice (dentro del mismo envío) de la tarea principal de esta subtarea. */
  parentIndex: z.number().int().min(0).optional(),
  sprintId: z.uuid().nullable().optional(),
});

export const planningRoutes = [
  // Subtareas
  route({
    method: "POST",
    path: "/cards/:cardId/subtasks",
    summary: "Crear una subtarea",
    tag: "Planificación",
    status: 201,
    body: z.object({ title: z.string().trim().min(1, "Ingresá un título").max(200) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        if (card.parentId) throw badRequest("Una subtarea no puede tener subtareas");
        const id = uuidv7();
        await tx.insert(cards).values({
          id,
          orgId: card.orgId,
          boardId: card.boardId,
          listId: card.listId,
          title: body.title,
          priority: "none",
          position: await positionAfter(tx, "cards", card.listId, undefined),
          parentId: card.id,
          sprintId: card.sprintId,
          createdBy: me.id,
        });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: id, actorId: me.id, action: "card.subtask_created", data: { title: body.title, parent: card.title } });
        return { id };
      }),
  }),

  // Seguir una tarjeta
  route({
    method: "PUT",
    path: "/cards/:cardId/watch",
    summary: "Seguir o dejar de seguir una tarjeta",
    tag: "Planificación",
    body: z.object({ watching: z.boolean() }),
    handler: async ({ me, params, body }) =>
      withUser(me.id, async (tx) => {
        const { card } = await cardAccess(tx, { actorId: me.id }, params.cardId, "view");
        if (body.watching) await tx.insert(cardWatchers).values({ orgId: card.orgId, cardId: card.id, userId: me.id }).onConflictDoNothing();
        else await tx.delete(cardWatchers).where(and(eq(cardWatchers.cardId, card.id), eq(cardWatchers.userId, me.id)));
        return { watching: body.watching };
      }),
  }),

  // Duplicar tarjeta
  route({
    method: "POST",
    path: "/cards/:cardId/duplicate",
    summary: "Duplicar una tarjeta (con checklists, etiquetas y asignados)",
    tag: "Planificación",
    status: 201,
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board } = await cardAccess(tx, actx, params.cardId, "edit");
        const id = await duplicateCard(tx, card, me.id);
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, cardId: id, actorId: me.id, action: "card.duplicated", data: { title: card.title } });
        return { id };
      }),
  }),

  // Control de calidad
  route({
    method: "POST",
    path: "/cards/:cardId/qa",
    summary: "Aprobar o rechazar una tarea en control de calidad",
    tag: "Planificación",
    body: z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card, board, role } = await cardAccess(tx, actx, params.cardId, "view");
        const [member] = await tx.select().from(boardMembers).where(and(eq(boardMembers.boardId, board.id), eq(boardMembers.userId, me.id)));
        if (role !== "admin" && !member?.canReview) throw forbidden("Solo quienes revisan en este tablero pueden aprobar o rechazar");
        if (!board.qaRequired) throw badRequest("Este tablero no usa control de calidad");
        if (body.decision === "reject" && !body.note) throw badRequest("Contá qué hay que corregir");
        const approved = body.decision === "approve";
        const patch: Partial<Card> = { qaStatus: approved ? "approved" : "rejected", qaBy: me.id, qaAt: new Date(), qaNote: body.note ?? null };
        // Al aprobar, la tarea pasa a terminado.
        if (approved && board.doneListId) {
          patch.listId = board.doneListId;
          patch.position = await positionAfter(tx, "cards", board.doneListId, undefined, card.id);
          patch.completedAt = new Date();
        }
        await tx.update(cards).set(patch).where(eq(cards.id, card.id));
        await logActivity(tx, {
          orgId: board.orgId,
          boardId: board.id,
          cardId: card.id,
          actorId: me.id,
          action: approved ? "qa.approved" : "qa.rejected",
          data: { title: card.title, note: body.note },
        });
        const people = new Set((await tx.select({ userId: cardAssignees.userId }).from(cardAssignees).where(eq(cardAssignees.cardId, card.id))).map((a) => a.userId));
        if (card.ownerId) people.add(card.ownerId);
        await notify(tx, {
          orgId: board.orgId,
          userIds: people,
          actorId: me.id,
          type: approved ? "qa.approved" : "qa.rejected",
          boardId: board.id,
          cardId: card.id,
          data: { cardTitle: card.title, boardName: board.name, note: body.note },
        });
        if (approved) await spawnRecurrence(tx, { ...card, ...patch } as Card, me.id);
        return { status: patch.qaStatus };
      }),
  }),

  // Etapas de trabajo
  route({
    method: "POST",
    path: "/boards/:boardId/sprints",
    summary: "Crear una etapa de trabajo",
    tag: "Planificación",
    status: 201,
    body: sprintBody,
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "edit");
        if (body.endsOn < body.startsOn) throw badRequest("La fecha de fin tiene que ser posterior al inicio");
        const id = uuidv7();
        await tx.insert(sprints).values({ id, orgId: board.orgId, boardId: board.id, ...body, status: "planned", createdBy: me.id });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "sprint.created", data: { name: body.name } });
        return { id };
      }),
  }),

  route({
    method: "PATCH",
    path: "/sprints/:sprintId",
    summary: "Editar, iniciar o cerrar una etapa",
    tag: "Planificación",
    body: sprintBody.partial().extend({
      status: z.enum(["planned", "active", "closed"]).optional(),
      /** Al cerrar: a qué etapa mover lo pendiente (null = volver a pendientes sin etapa). */
      moveOpenTo: z.uuid().nullable().optional(),
    }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [sp] = await tx.select().from(sprints).where(eq(sprints.id, params.sprintId));
        if (!sp) throw notFound("Etapa");
        const { board } = await boardAccess(tx, actx, sp.boardId, "edit");
        const { moveOpenTo, ...fields } = body;
        const startsOn = fields.startsOn ?? sp.startsOn;
        const endsOn = fields.endsOn ?? sp.endsOn;
        if (endsOn < startsOn) throw badRequest("La fecha de fin tiene que ser posterior al inicio");
        if (fields.status === "active" && sp.status !== "active") {
          const [active] = await tx.select({ id: sprints.id }).from(sprints).where(and(eq(sprints.boardId, board.id), eq(sprints.status, "active")));
          if (active) throw conflict("Ya hay una etapa en curso en este tablero. Cerrala antes de iniciar otra.");
        }
        await tx.update(sprints).set(fields).where(eq(sprints.id, sp.id));
        if (fields.status === "closed" && sp.status !== "closed") {
          if (moveOpenTo) await assertSprintInBoard(tx, board.id, moveOpenTo);
          await tx
            .update(cards)
            .set({ sprintId: moveOpenTo ?? null })
            .where(and(eq(cards.sprintId, sp.id), isNull(cards.completedAt), isNull(cards.archivedAt)));
        }
        if (fields.status && fields.status !== sp.status) {
          await logActivity(tx, {
            orgId: board.orgId,
            boardId: board.id,
            actorId: me.id,
            action: fields.status === "active" ? "sprint.started" : fields.status === "closed" ? "sprint.closed" : "sprint.updated",
            data: { name: fields.name ?? sp.name },
          });
        }
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/sprints/:sprintId",
    summary: "Eliminar una etapa (sus tareas vuelven a pendientes)",
    tag: "Planificación",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const [sp] = await tx.select().from(sprints).where(eq(sprints.id, params.sprintId));
        if (!sp) throw notFound("Etapa");
        const { board } = await boardAccess(tx, actx, sp.boardId, "manage");
        await tx.delete(sprints).where(eq(sprints.id, sp.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "sprint.deleted", data: { name: sp.name } });
        return undefined;
      }),
  }),

  // Carga masiva
  route({
    method: "POST",
    path: "/boards/:boardId/cards/bulk",
    summary: "Crear muchas tareas de una vez (opcionalmente también como issues)",
    tag: "Planificación",
    status: 201,
    rateLimit: [{ name: "bulk", by: "user", limit: 20, windowSec: 3600 }],
    body: z.object({ items: z.array(bulkItem).min(1).max(200), createIssues: z.boolean().default(false) }),
    handler: async ({ me, params, body, audit: actx }) => {
      const created = await withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "edit");
        const boardLists = await tx
          .select()
          .from(lists)
          .where(and(eq(lists.boardId, board.id), isNull(lists.archivedAt)))
          .orderBy(asc(lists.position));
        if (boardLists.length === 0) throw badRequest("El tablero no tiene listas");
        const listIds = new Set(boardLists.map((l) => l.id));
        const roles = await boardUserRoles(tx, board.id);
        const sprintIds = new Set(
          (await tx.select({ id: sprints.id }).from(sprints).where(and(eq(sprints.boardId, board.id), sql`${sprints.status} <> 'closed'`))).map((s) => s.id),
        );

        // Validación completa antes de escribir: o se crean todas, o ninguna.
        const errors: { index: number; message: string }[] = [];
        body.items.forEach((it, i) => {
          if (it.listId && !listIds.has(it.listId)) errors.push({ index: i, message: "La lista no pertenece al tablero" });
          if (it.ownerId && !roles.has(it.ownerId)) errors.push({ index: i, message: "El responsable no tiene acceso al tablero" });
          if (it.sprintId && !sprintIds.has(it.sprintId)) errors.push({ index: i, message: "La etapa no existe o está cerrada" });
          if (it.parentIndex !== undefined) {
            if (it.parentIndex >= i) errors.push({ index: i, message: "La tarea principal tiene que estar antes en la lista" });
            else if (body.items[it.parentIndex]!.parentIndex !== undefined) errors.push({ index: i, message: "Una subtarea no puede tener subtareas" });
          }
        });
        if (errors.length) throw new AppError(400, "validation_error", "Hay filas con errores", errors.map((e) => ({ path: `items.${e.index}`, message: e.message })));

        const existing = await tx.select().from(labels).where(eq(labels.boardId, board.id));
        const labelByName = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]));
        const ids: string[] = [];
        const placedIn: string[] = [];
        for (const it of body.items) {
          // Sin lista explícita, la subtarea va a la lista de su tarea principal; el resto, a la primera.
          const parentId = it.parentIndex !== undefined ? ids[it.parentIndex]! : null;
          const finalList = it.listId ?? (it.parentIndex !== undefined ? placedIn[it.parentIndex]! : boardLists[0]!.id);
          const rich = it.description ? sanitizeRichText({ type: "doc", content: it.description.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) }) : null;
          const id = uuidv7();
          await tx.insert(cards).values({
            id,
            orgId: board.orgId,
            boardId: board.id,
            listId: finalList,
            title: it.title,
            description: rich?.json ?? null,
            descriptionText: rich?.text ?? "",
            priority: it.priority,
            ownerId: it.ownerId ?? null,
            dueAt: it.dueAt ? new Date(it.dueAt) : null,
            estimatePoints: it.estimatePoints ?? null,
            sprintId: it.sprintId ?? null,
            parentId,
            position: await positionAfter(tx, "cards", finalList, undefined),
            createdBy: me.id,
          });
          for (const name of new Set(it.labels)) {
            let labelId = labelByName.get(name.toLowerCase());
            if (!labelId) {
              labelId = uuidv7();
              await tx.insert(labels).values({ id: labelId, orgId: board.orgId, boardId: board.id, name, color: COLORS[(labelByName.size + 3) % COLORS.length]! });
              labelByName.set(name.toLowerCase(), labelId);
            }
            await tx.insert(cardLabels).values({ orgId: board.orgId, boardId: board.id, cardId: id, labelId });
          }
          ids.push(id);
          placedIn.push(finalList);
        }
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "cards.bulk_created", data: { count: ids.length } });
        return { boardId: board.id, ids };
      });

      // Issues fuera de la transacción: un fallo en una fila no deshace las tarjetas.
      const results: { index: number; cardId: string; issueNumber?: number; error?: string }[] = created.ids.map((cardId, index) => ({ index, cardId }));
      if (body.createIssues) {
        const [repo] = await withUser(me.id, (tx) =>
          tx.execute<{ id: string }>(sql`select id from app.board_repos where board_id = ${created.boardId}`),
        );
        if (!repo) throw badRequest("El tablero no tiene un repositorio vinculado");
        for (const r of results) {
          try {
            r.issueNumber = (await createIssueForCard(r.cardId, repo.id)).number;
          } catch (err) {
            r.error = err instanceof Error ? err.message : "No se pudo crear el issue";
          }
        }
      }
      return { created: results.length, results };
    },
  }),

  // Panel del líder
  route({
    method: "GET",
    path: "/boards/:boardId/insights",
    summary: "Panel del líder: carga por persona, revisiones, bloqueos, calidad y tiempos",
    tag: "Planificación",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const workload = await tx.execute<{
          user_id: string; name: string; has_avatar: boolean; open: number; points: string | null; overdue: number; done_30d: number; avg_hours: string | null;
        }>(sql`
          select r.user_id, u.name, (u.avatar_key is not null) as has_avatar,
            count(c.id) filter (where c.completed_at is null)::int as open,
            sum(c.estimate_points) filter (where c.completed_at is null) as points,
            count(c.id) filter (where c.completed_at is null and c.due_at < now())::int as overdue,
            count(c.id) filter (where c.completed_at > now() - interval '30 days')::int as done_30d,
            avg(extract(epoch from c.completed_at - c.created_at) / 3600) filter (where c.completed_at > now() - interval '90 days') as avg_hours
          from app.board_roles(${board.id}) r
          join app.users u on u.id = r.user_id
          left join app.cards c on c.board_id = ${board.id} and c.archived_at is null
            and (c.owner_id = r.user_id or exists (select 1 from app.card_assignees a where a.card_id = c.id and a.user_id = r.user_id))
          group by r.user_id, u.name, u.avatar_key
          order by open desc, u.name`);

        const [resolution] = await tx.execute<{ avg_hours: string | null; completed: number }>(sql`
          select avg(extract(epoch from completed_at - created_at) / 3600) as avg_hours, count(*)::int as completed
          from app.cards where board_id = ${board.id} and completed_at > now() - interval '90 days'`);

        const reviews = await tx.execute<{ card_id: string; card_title: string; number: string; title: string; url: string; author: string | null; review: string | null; checks: string | null; updated: Date | null }>(sql`
          select c.id as card_id, c.title as card_title, d.external_id as number, d.title, d.url, d.author,
            d.review_status as review, d.checks_status as checks, d.remote_updated_at as updated
          from app.card_dev_refs d join app.cards c on c.id = d.card_id
          where c.board_id = ${board.id} and d.kind = 'pr' and d.state = 'open' and not d.draft
          order by d.remote_updated_at asc nulls last`);

        const blocked = await tx.execute<{ id: string; title: string; blockers: string[] }>(sql`
          select c.id, c.title, array_agg(b.title) as blockers
          from app.cards c
          join app.card_relations r on r.to_card_id = c.id and r.type = 'blocks'
          join app.cards b on b.id = r.from_card_id and b.completed_at is null and b.archived_at is null
          where c.board_id = ${board.id} and c.archived_at is null and c.completed_at is null
          group by c.id, c.title`);

        const qa = await tx
          .select({ id: cards.id, title: cards.title, status: cards.qaStatus, note: cards.qaNote })
          .from(cards)
          .where(and(eq(cards.boardId, board.id), isNull(cards.archivedAt), inArray(cards.qaStatus, ["pending", "rejected"])));

        const [active] = await tx.select().from(sprints).where(and(eq(sprints.boardId, board.id), eq(sprints.status, "active")));
        let sprint = null;
        if (active) {
          const [p] = await tx.execute<{ total: string | null; done: string | null; cards: number; cards_done: number }>(sql`
            select sum(estimate_points) as total, sum(estimate_points) filter (where completed_at is not null) as done,
              count(*)::int as cards, count(*) filter (where completed_at is not null)::int as cards_done
            from app.cards where sprint_id = ${active.id} and archived_at is null`);
          sprint = {
            id: active.id,
            name: active.name,
            endsOn: active.endsOn,
            capacityPoints: active.capacityPoints,
            totalPoints: Number(p?.total ?? 0),
            donePoints: Number(p?.done ?? 0),
            cards: p?.cards ?? 0,
            cardsDone: p?.cards_done ?? 0,
          };
        }

        return {
          workload: workload.map((w) => ({
            userId: w.user_id,
            name: w.name,
            hasAvatar: w.has_avatar,
            open: w.open,
            points: Number(w.points ?? 0),
            overdue: w.overdue,
            done30d: w.done_30d,
            avgHours: w.avg_hours === null ? null : Number(w.avg_hours),
          })),
          resolution: { avgHours: resolution?.avg_hours === null || !resolution ? null : Number(resolution.avg_hours), completed: resolution?.completed ?? 0 },
          reviews: reviews.map((r) => ({ cardId: r.card_id, cardTitle: r.card_title, number: Number(r.number), title: r.title, url: r.url, author: r.author, review: r.review, checks: r.checks, updatedAt: r.updated })),
          blocked: blocked.map((b) => ({ id: b.id, title: b.title, blockers: b.blockers })),
          qa,
          sprint,
        };
      }),
  }),

  // Exportar a planilla
  route({
    method: "GET",
    path: "/boards/:boardId/export",
    summary: "Exportar las tarjetas del tablero a CSV (planilla)",
    tag: "Planificación",
    rateLimit: [{ name: "export", by: "user", limit: 30, windowSec: 3600 }],
    handler: async ({ me, params }) => {
      const { board, rows } = await withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const rows = await tx.execute<Record<string, unknown>>(sql`
          select c.title, l.name as list, c.priority, o.name as owner,
            (select string_agg(u.name, ', ') from app.card_assignees a join app.users u on u.id = a.user_id where a.card_id = c.id) as assignees,
            (select string_agg(lb.name, ', ') from app.card_labels x join app.labels lb on lb.id = x.label_id where x.card_id = c.id) as labels,
            to_char(c.due_at at time zone 'UTC', 'YYYY-MM-DD') as due, c.estimate_points as estimate, s.name as sprint, c.qa_status as qa,
            to_char(c.completed_at at time zone 'UTC', 'YYYY-MM-DD') as completed, p.title as parent, c.description_text as description,
            (select k.issue_number from app.card_issue_links k where k.card_id = c.id) as issue,
            to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD') as created
          from app.cards c
          join app.lists l on l.id = c.list_id
          left join app.users o on o.id = c.owner_id
          left join app.sprints s on s.id = c.sprint_id
          left join app.cards p on p.id = c.parent_id
          where c.board_id = ${board.id} and c.archived_at is null
          order by l.position, c.position`);
        return { board, rows };
      });
      const header = ["Título", "Lista", "Prioridad", "Responsable", "Colaboradores", "Etiquetas", "Vencimiento", "Estimación", "Etapa", "Control de calidad", "Completada", "Tarea principal", "Descripción", "Issue", "Creada"];
      const lines = [header.map(csvCell).join(",")];
      for (const r of rows) {
        lines.push(
          [r.title, r.list, PRIORITY_LABEL[String(r.priority)] ?? "", r.owner, r.assignees, r.labels, r.due, r.estimate, r.sprint, QA_LABEL[String(r.qa)] ?? "", r.completed, r.parent, r.description, r.issue ? `#${r.issue}` : "", r.created]
            .map(csvCell)
            .join(","),
        );
      }
      const name = `${board.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "tablero"}.csv`;
      // BOM para que Excel reconozca UTF-8 (acentos y eñes).
      return new Response("﻿" + lines.join("\r\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  }),

  // Duplicar tablero / guardar como plantilla
  route({
    method: "POST",
    path: "/boards/:boardId/duplicate",
    summary: "Duplicar un tablero (o crear una plantilla a partir de él)",
    tag: "Planificación",
    status: 201,
    body: z.object({ name: z.string().trim().min(1).max(80), includeCards: z.boolean().default(false), asTemplate: z.boolean().default(false) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "view", { allowArchived: true });
        await workspaceAccess(tx, me.id, board.workspaceId, "create_board");
        const id = uuidv7();
        await tx.insert(boards).values({
          id,
          orgId: board.orgId,
          workspaceId: board.workspaceId,
          name: body.name,
          description: board.description,
          color: board.color,
          visibility: board.visibility,
          workspaceAccess: board.workspaceAccess,
          isTemplate: body.asTemplate,
          createdBy: me.id,
        });
        await tx.insert(boardMembers).values({ orgId: board.orgId, boardId: id, userId: me.id, role: "admin" });
        await copyBoardContents(tx, { orgId: board.orgId, sourceBoardId: board.id, targetBoardId: id, actorId: me.id, includeCards: body.includeCards });
        await logActivity(tx, { orgId: board.orgId, boardId: id, actorId: me.id, action: "board.created", data: { name: body.name, from: board.name } });
        await audit(tx, actx, "board.created", { orgId: board.orgId, targetType: "board", targetId: id, data: { duplicatedFrom: board.id } });
        return { id };
      }),
  }),

  route({
    method: "GET",
    path: "/workspaces/:workspaceId/board-templates",
    summary: "Plantillas disponibles para crear un tablero",
    tag: "Planificación",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const { workspace } = await workspaceAccess(tx, me.id, params.workspaceId, "view");
        const own = await tx
          .select({ id: boards.id, name: boards.name, description: boards.description, workspaceName: workspaces.name })
          .from(boards)
          .innerJoin(myBoards, eq(myBoards.boardId, boards.id))
          .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
          .where(and(eq(boards.orgId, workspace.orgId), eq(boards.isTemplate, true), isNull(boards.archivedAt)))
          .orderBy(asc(boards.name));
        return {
          builtin: Object.entries(BUILTIN_TEMPLATES).map(([key, t]) => ({ key, name: t.name, description: t.description, lists: t.lists, qa: !!t.qa })),
          boards: own,
        };
      }),
  }),
];
