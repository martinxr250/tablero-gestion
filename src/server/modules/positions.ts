import "server-only";
import { sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { badRequest } from "../core/errors";
import type { Tx } from "../db/client";

// Orden por índices fraccionarios: mover un elemento actualiza solo su fila.
const SCOPES = {
  lists: "board_id",
  cards: "list_id",
  checklists: "card_id",
  checklist_items: "checklist_id",
} as const;

export type PositionTable = keyof typeof SCOPES;

/**
 * Calcula la posición para ubicar un elemento dentro de su contenedor.
 * afterId: undefined → al final · null → al principio · uuid → justo después de ese elemento.
 */
export async function positionAfter(
  tx: Tx,
  table: PositionTable,
  scopeId: string,
  afterId: string | null | undefined,
  excludeId?: string,
): Promise<string> {
  const t = sql`${sql.identifier("app")}.${sql.identifier(table)}`;
  const scope = sql.identifier(SCOPES[table]);
  const exclude = excludeId ? sql`and id <> ${excludeId}` : sql``;

  if (afterId === undefined) {
    const [r] = await tx.execute<{ p: string | null }>(sql`select max(position) as p from ${t} where ${scope} = ${scopeId} ${exclude}`);
    return generateKeyBetween(r?.p ?? null, null);
  }
  if (afterId === null) {
    const [r] = await tx.execute<{ p: string | null }>(sql`select min(position) as p from ${t} where ${scope} = ${scopeId} ${exclude}`);
    return generateKeyBetween(null, r?.p ?? null);
  }
  const [anchor] = await tx.execute<{ p: string }>(sql`select position as p from ${t} where id = ${afterId} and ${scope} = ${scopeId}`);
  if (!anchor) throw badRequest("La posición de referencia no existe en ese destino");
  const [next] = await tx.execute<{ p: string | null }>(
    sql`select min(position) as p from ${t} where ${scope} = ${scopeId} and position > ${anchor.p} ${exclude}`,
  );
  return generateKeyBetween(anchor.p, next?.p ?? null);
}
