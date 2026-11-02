import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "../core/ids";
import type { Tx } from "../db/client";
import { activityLogs, notifications } from "../db/schema";

export const COLORS = ["slate", "red", "orange", "amber", "green", "teal", "sky", "indigo", "violet", "pink"] as const;
export type ColorName = (typeof COLORS)[number];
export const colorSchema = z.enum(COLORS);
export const uuidSchema = z.uuid();

/** Registro de actividad visible para el equipo. Su id también es el "cursor" de cambios del tablero. */
export async function logActivity(
  tx: Tx,
  entry: { orgId: string; boardId: string; cardId?: string | null; actorId: string; action: string; data?: Record<string, unknown> },
) {
  await tx.insert(activityLogs).values({
    orgId: entry.orgId,
    boardId: entry.boardId,
    cardId: entry.cardId ?? null,
    actorId: entry.actorId,
    action: entry.action,
    data: entry.data ?? {},
  });
}

export type NotificationType =
  | "card.assigned"
  | "card.owner"
  | "comment.mention"
  | "comment.created"
  | "card.due_soon"
  | "card.moved"
  | "card.completed"
  | "qa.requested"
  | "qa.approved"
  | "qa.rejected"
  | "board.added"
  | "card.blocked"
  | "dependency.resolved"
  | "pr.review_requested"
  | "ci.failed"
  | "sprint.risk";

/** Avisos que cada persona puede silenciar (los de asignación y menciones siempre llegan). */
export const MUTABLE_NOTIFICATIONS: NotificationType[] = [
  "comment.created",
  "card.moved",
  "card.completed",
  "card.due_soon",
  "card.blocked",
  "dependency.resolved",
  "pr.review_requested",
  "ci.failed",
  "qa.requested",
  "sprint.risk",
];

/** Crea notificaciones internas (nunca para el propio actor). Sin RETURNING: RLS solo deja leer las propias. */
export async function notify(
  tx: Tx,
  input: {
    orgId: string;
    userIds: Iterable<string>;
    actorId: string | null;
    type: NotificationType;
    boardId?: string;
    cardId?: string;
    data: Record<string, unknown>;
    /** Evita avisar dos veces lo mismo a la misma persona (p. ej. el mismo check fallido). */
    dedupeKey?: string;
  },
) {
  let recipients = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return;
  if (MUTABLE_NOTIFICATIONS.includes(input.type)) {
    const muted = await tx.execute<{ id: string }>(
      sql`select app.muted_recipients(${input.type}, ${sql`array[${sql.join(recipients.map((r) => sql`${r}::uuid`), sql`, `)}]`}) as id`,
    );
    const skip = new Set(muted.map((m) => m.id));
    recipients = recipients.filter((id) => !skip.has(id));
    if (recipients.length === 0) return;
  }
  await tx
    .insert(notifications)
    .values(
    recipients.map((userId) => ({
      id: uuidv7(),
      orgId: input.orgId,
      userId,
      type: input.type,
      actorId: input.actorId,
      boardId: input.boardId,
      cardId: input.cardId,
      data: input.data,
      dedupeKey: input.dedupeKey ?? null,
    })),
    )
    .onConflictDoNothing();
}
