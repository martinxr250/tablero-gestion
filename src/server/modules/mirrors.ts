import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { badRequest, conflict, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser, type Tx } from "../db/client";
import { cardMirrors, labels, lists, users } from "../db/schema";
import { boardAccess, cardAccess } from "./access";
import { cardSummaries } from "./boards";
import { listBoardFields } from "./fields";
import { positionAfter } from "./positions";
import { logActivity } from "./shared";

/**
 * Espejos visibles en un tablero. Solo se incluyen los de tarjetas cuyo tablero original
 * la persona puede ver (my_boards): un espejo nunca da acceso a una tarjeta ajena.
 */
export async function boardMirrors(tx: Tx, boardId: string) {
  const rows = await tx.execute<{ mirror_id: string; card_id: string; list_id: string; position: string; source_board_id: string; source_board_name: string }>(sql`
    select m.id as mirror_id, m.card_id, m.list_id, m.position, b.id as source_board_id, b.name as source_board_name
    from app.card_mirrors m
    join app.cards c on c.id = m.card_id
    join app.boards b on b.id = c.board_id
    join app.my_boards mb on mb.board_id = c.board_id
    where m.board_id = ${boardId} and c.archived_at is null`);
  if (rows.length === 0) return { cards: [], external: { labels: [], people: [], fields: [] } };

  const summaries = new Map((await cardSummaries(tx, sql`c.id in ${sql`(${sql.join(rows.map((r) => sql`${r.card_id}`), sql`, `)})`}`)).map((c) => [c.id, c]));
  const cards = rows.flatMap((r) => {
    const c = summaries.get(r.card_id);
    if (!c) return [];
    // Etapa y tarea principal son del tablero original: en el espejo no aplican.
    return [{ ...c, id: r.mirror_id, listId: r.list_id, position: r.position, sprintId: null, parentId: null, mirror: { cardId: r.card_id, boardId: r.source_board_id, boardName: r.source_board_name } }];
  });

  // Datos del tablero original que necesita la tarjeta para mostrarse completa.
  const sourceBoards = [...new Set(rows.map((r) => r.source_board_id))];
  const personIds = [...new Set(cards.flatMap((c) => [c.ownerId, ...c.assigneeIds].filter(Boolean) as string[]))];
  const [labelRows, peopleRows, fieldLists] = await Promise.all([
    tx.select({ id: labels.id, name: labels.name, color: labels.color }).from(labels).where(inArray(labels.boardId, sourceBoards)),
    personIds.length
      ? tx.select({ userId: users.id, name: users.name, hasAvatar: sql<boolean>`${users.avatarKey} is not null` }).from(users).where(inArray(users.id, personIds))
      : Promise.resolve([]),
    Promise.all(sourceBoards.map((id) => listBoardFields(tx, id))),
  ]);
  return { cards, external: { labels: labelRows, people: peopleRows.map((p) => ({ ...p, email: "", role: "viewer" })), fields: fieldLists.flat() } };
}

/** Tableros donde se espeja una tarjeta (solo los que la persona puede ver). */
export async function cardMirrorList(tx: Tx, cardId: string) {
  return tx.execute<{ id: string; board_id: string; board_name: string; list_name: string }>(sql`
    select m.id, m.board_id, b.name as board_name, l.name as list_name
    from app.card_mirrors m
    join app.boards b on b.id = m.board_id
    join app.lists l on l.id = m.list_id
    join app.my_boards mb on mb.board_id = m.board_id
    where m.card_id = ${cardId}
    order by b.name`);
}

async function mirrorWithAccess(tx: Tx, actx: Parameters<typeof boardAccess>[1], mirrorId: string) {
  const [mirror] = await tx.select().from(cardMirrors).where(eq(cardMirrors.id, mirrorId));
  if (!mirror) throw notFound("Espejo");
  const { board } = await boardAccess(tx, actx, mirror.boardId, "edit");
  return { mirror, board };
}

export const mirrorRoutes = [
  route({
    method: "POST",
    path: "/cards/:cardId/mirrors",
    summary: "Espejar una tarjeta en otro tablero de la organización",
    tag: "Tarjetas espejo",
    status: 201,
    body: z.object({ boardId: z.uuid(), listId: z.uuid().optional() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card } = await cardAccess(tx, actx, params.cardId, "view");
        if (card.archivedAt) throw badRequest("La tarjeta está archivada");
        if (body.boardId === card.boardId) throw badRequest("La tarjeta ya está en ese tablero");
        const { board } = await boardAccess(tx, actx, body.boardId, "edit");
        if (board.orgId !== card.orgId) throw badRequest("Solo se puede espejar dentro de la misma organización");
        const [list] = body.listId
          ? await tx.select().from(lists).where(and(eq(lists.id, body.listId), eq(lists.boardId, board.id), isNull(lists.archivedAt)))
          : await tx.select().from(lists).where(and(eq(lists.boardId, board.id), isNull(lists.archivedAt))).orderBy(lists.position).limit(1);
        if (!list) throw badRequest("El tablero de destino no tiene esa lista");
        const [dup] = await tx.select({ id: cardMirrors.id }).from(cardMirrors).where(and(eq(cardMirrors.cardId, card.id), eq(cardMirrors.boardId, board.id)));
        if (dup) throw conflict("La tarjeta ya está espejada en ese tablero");
        const id = uuidv7();
        await tx.insert(cardMirrors).values({
          id,
          orgId: card.orgId,
          cardId: card.id,
          boardId: board.id,
          listId: list.id,
          position: await positionAfter(tx, "card_mirrors", list.id, undefined),
          createdBy: me.id,
        });
        // En el tablero del espejo no se registra qué tarjeta es: quien no ve el original no debe enterarse.
        await logActivity(tx, { orgId: card.orgId, boardId: board.id, actorId: me.id, action: "card.mirror_added", data: {} });
        await logActivity(tx, { orgId: card.orgId, boardId: card.boardId, cardId: card.id, actorId: me.id, action: "card.mirrored", data: { title: card.title, to: board.name } });
        return { id };
      }),
  }),

  route({
    method: "POST",
    path: "/mirrors/:mirrorId/move",
    summary: "Mover un espejo dentro de su tablero",
    tag: "Tarjetas espejo",
    body: z.object({ listId: z.uuid(), afterCardId: z.uuid().nullable() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { mirror, board } = await mirrorWithAccess(tx, actx, params.mirrorId);
        const [target] = await tx.select().from(lists).where(and(eq(lists.id, body.listId), eq(lists.boardId, board.id), isNull(lists.archivedAt)));
        if (!target) throw badRequest("La lista de destino no pertenece a este tablero");
        if (body.afterCardId === mirror.id) throw badRequest("Posición inválida");
        const position = await positionAfter(tx, "card_mirrors", target.id, body.afterCardId, mirror.id);
        await tx.update(cardMirrors).set({ listId: target.id, position }).where(eq(cardMirrors.id, mirror.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "card.mirror_moved", data: { to: target.name } });
        return { position, listId: target.id };
      }),
  }),

  route({
    method: "DELETE",
    path: "/mirrors/:mirrorId",
    summary: "Quitar un espejo (la tarjeta original no se toca)",
    tag: "Tarjetas espejo",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { mirror, board } = await mirrorWithAccess(tx, actx, params.mirrorId);
        await tx.delete(cardMirrors).where(eq(cardMirrors.id, mirror.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "card.mirror_removed", data: {} });
        return { ok: true };
      }),
  }),
];
