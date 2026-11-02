import "server-only";
import { eq, sql } from "drizzle-orm";
import { badRequest } from "../core/errors";
import type { Tx } from "../db/client";
import { cardAssignees, cards } from "../db/schema";
import { notify } from "./shared";

type CardLike = { id: string; orgId: string; boardId: string; title: string; ownerId: string | null; completedAt: Date | null };

/** Responsable y colaboradores de una tarjeta. */
export async function cardPeople(tx: Tx, card: { id: string; ownerId: string | null }) {
  const people = new Set((await tx.select({ userId: cardAssignees.userId }).from(cardAssignees).where(eq(cardAssignees.cardId, card.id))).map((a) => a.userId));
  if (card.ownerId) people.add(card.ownerId);
  return [...people];
}

/** Rechaza "A bloquea a B" si B ya bloquea (directa o indirectamente) a A. */
export async function assertNoCycle(tx: Tx, fromId: string, toId: string) {
  const [hit] = await tx.execute<{ found: boolean }>(sql`
    with recursive chain(id, depth) as (
      select r.to_card_id, 1 from app.card_relations r where r.from_card_id = ${toId} and r.type = 'blocks'
      union
      select r.to_card_id, c.depth + 1 from app.card_relations r join chain c on r.from_card_id = c.id
      where r.type = 'blocks' and c.depth < 50
    )
    select exists (select 1 from chain where id = ${fromId}) as found`);
  if (hit?.found) throw badRequest("Esa dependencia crearía un ciclo: la otra tarea ya depende de esta.");
}

/** Aviso a quienes trabajan en la tarea que quedó bloqueada por otra sin terminar. */
export async function notifyBlocked(tx: Tx, blocker: CardLike, blocked: CardLike, actorId: string) {
  if (blocker.completedAt || blocked.completedAt) return;
  await notify(tx, {
    orgId: blocked.orgId,
    userIds: await cardPeople(tx, blocked),
    actorId,
    type: "card.blocked",
    boardId: blocked.boardId,
    cardId: blocked.id,
    data: { cardTitle: blocked.title, blocker: blocker.title },
    dedupeKey: `blocked:${blocked.id}:${blocker.id}`,
  });
}

/** Al terminar una tarea, avisa a las tareas que ya no tienen dependencias pendientes. */
export async function notifyUnblocked(tx: Tx, done: CardLike, actorId: string) {
  const freed = await tx.execute<{ id: string }>(sql`
    select r.to_card_id as id from app.card_relations r
    join app.cards t on t.id = r.to_card_id
    where r.from_card_id = ${done.id} and r.type = 'blocks' and t.completed_at is null and t.archived_at is null
      and not exists (
        select 1 from app.card_relations o join app.cards b on b.id = o.from_card_id
        where o.to_card_id = r.to_card_id and o.type = 'blocks' and o.from_card_id <> ${done.id}
          and b.completed_at is null and b.archived_at is null)`);
  for (const { id } of freed) {
    const [card] = await tx.select().from(cards).where(eq(cards.id, id));
    if (!card) continue;
    await notify(tx, {
      orgId: card.orgId,
      userIds: await cardPeople(tx, card),
      actorId,
      type: "dependency.resolved",
      boardId: card.boardId,
      cardId: card.id,
      data: { cardTitle: card.title, blocker: done.title },
      dedupeKey: `unblocked:${card.id}:${done.id}`,
    });
  }
}
