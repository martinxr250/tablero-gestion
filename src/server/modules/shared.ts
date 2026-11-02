import "server-only";
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
  | "board.added";

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
  },
) {
  const recipients = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return;
  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      id: uuidv7(),
      orgId: input.orgId,
      userId,
      type: input.type,
      actorId: input.actorId,
      boardId: input.boardId,
      cardId: input.cardId,
      data: input.data,
    })),
  );
}
