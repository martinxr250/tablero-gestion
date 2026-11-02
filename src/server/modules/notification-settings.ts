import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { withUser } from "../db/client";
import { notificationSettings } from "../db/schema";
import { MUTABLE_NOTIFICATIONS, type NotificationType } from "./shared";

export const notificationSettingsRoutes = [
  route({
    method: "GET",
    path: "/me/notification-settings",
    summary: "Tipos de aviso silenciados por la persona",
    tag: "Notificaciones",
    handler: async ({ me }) =>
      withUser(me.id, async (tx) => {
        const [row] = await tx.select().from(notificationSettings).where(eq(notificationSettings.userId, me.id));
        return { mutable: MUTABLE_NOTIFICATIONS, muted: row?.muted ?? [] };
      }),
  }),
  route({
    method: "PUT",
    path: "/me/notification-settings",
    summary: "Silenciar o reactivar tipos de aviso (los esenciales no se pueden silenciar)",
    tag: "Notificaciones",
    body: z.object({ muted: z.array(z.enum(MUTABLE_NOTIFICATIONS as [NotificationType, ...NotificationType[]])).max(30) }),
    handler: async ({ me, body }) =>
      withUser(me.id, async (tx) => {
        const muted = [...new Set(body.muted)];
        await tx
          .insert(notificationSettings)
          .values({ userId: me.id, muted })
          .onConflictDoUpdate({ target: notificationSettings.userId, set: { muted, updatedAt: new Date() } });
        return { muted };
      }),
  }),
];
