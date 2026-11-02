import "server-only";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import QRCode from "qrcode";
import { z } from "zod";
import { route } from "../api/router";
import { clearAuthCookies } from "../auth/cookies";
import { hashPassword, verifyPassword } from "../auth/password";
import { passwordContainsEmail, passwordSchema } from "../auth/password-policy";
import { revokeSession, revokeUserSessions } from "../auth/session";
import { audit } from "../core/audit";
import { decrypt, encrypt, randomToken, sha256 } from "../core/crypto";
import { AppError, badRequest, conflict, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { withSystem, withUser } from "../db/client";
import { mfaRecoveryCodes, organizationMembers, organizations, sessions, storageGc, users } from "../db/schema";
import { sendMail } from "../email/mailer";
import { passwordChangedMail } from "../email/templates";
import { storage } from "../storage/storage";
import { verifySecondFactor, nameSchema } from "./auth";
import { downloadResponse, MAX_AVATAR_BYTES, validateUpload } from "./files";

async function checkPassword(userId: string, password: string) {
  const [u] = await withSystem((tx) => tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId)));
  if (!u || !(await verifyPassword(u.hash, password))) throw new AppError(403, "invalid_password", "Contraseña incorrecta");
}

function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const raw = randomToken(8).replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 10).padEnd(10, "x");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const meRoutes = [
  route({
    method: "GET",
    path: "/me",
    summary: "Perfil del usuario actual y sus organizaciones",
    tag: "Perfil",
    auth: "user-unverified",
    handler: async ({ me }) => {
      const orgs = me.emailVerified
        ? await withUser(me.id, (tx) =>
            tx
              .select({ id: organizations.id, name: organizations.name, role: organizationMembers.role })
              .from(organizationMembers)
              .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
              .where(and(eq(organizationMembers.userId, me.id), isNull(organizations.deletedAt)))
              .orderBy(organizations.name),
          )
        : [];
      return {
        user: {
          id: me.id,
          email: me.email,
          name: me.name,
          hasAvatar: Boolean(me.avatarKey),
          emailVerified: me.emailVerified,
          mfaEnabled: me.mfaEnabled,
        },
        orgs,
      };
    },
  }),

  route({
    method: "PATCH",
    path: "/me",
    summary: "Actualizar el perfil",
    tag: "Perfil",
    body: z.object({ name: nameSchema }),
    handler: async ({ me, body }) => {
      await withUser(me.id, (tx) => tx.update(users).set({ name: body.name }).where(eq(users.id, me.id)));
      return { ok: true };
    },
  }),

  route({
    method: "POST",
    path: "/me/password",
    summary: "Cambiar la contraseña (cierra las demás sesiones)",
    tag: "Perfil",
    rateLimit: [{ name: "change-password", by: "user", limit: 5, windowSec: 900 }],
    body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }),
    handler: async ({ me, body, audit: actx }) => {
      await checkPassword(me.id, body.currentPassword);
      if (passwordContainsEmail(body.newPassword, me.email)) throw badRequest("La contraseña no puede contener tu correo");
      const passwordHash = await hashPassword(body.newPassword);
      await withSystem(async (tx) => {
        await tx.update(users).set({ passwordHash, passwordChangedAt: new Date() }).where(eq(users.id, me.id));
        await revokeUserSessions(tx, me.id, "password_changed", me.sessionId);
        await audit(tx, actx, "auth.password_changed", { targetType: "user", targetId: me.id });
      });
      await sendMail({ to: me.email, ...passwordChangedMail(me.name) }).catch((err) => logger.error("mail_failed", { err }));
      return { ok: true };
    },
  }),

  route({
    method: "GET",
    path: "/me/sessions",
    summary: "Listar sesiones activas",
    tag: "Perfil",
    handler: async ({ me }) => {
      const rows = await withUser(me.id, (tx) =>
        tx
          .select({
            id: sessions.id,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
            lastUsedAt: sessions.lastUsedAt,
            expiresAt: sessions.expiresAt,
          })
          .from(sessions)
          .where(and(eq(sessions.userId, me.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
          .orderBy(desc(sessions.lastUsedAt)),
      );
      return { sessions: rows.map((s) => ({ ...s, current: s.id === me.sessionId })) };
    },
  }),

  route({
    method: "DELETE",
    path: "/me/sessions/:sessionId",
    summary: "Cerrar una sesión específica",
    tag: "Perfil",
    handler: async ({ me, params, audit: actx, setCookies }) => {
      await withUser(me.id, async (tx) => {
        const [s] = await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, params.sessionId));
        if (!s) throw notFound("Sesión");
        await revokeSession(tx, s.id, "user_revoked");
        await audit(tx, actx, "auth.session_revoked", { targetType: "session", targetId: s.id });
      });
      if (params.sessionId === me.sessionId) setCookies.push(...clearAuthCookies());
      return undefined;
    },
  }),

  route({
    method: "POST",
    path: "/me/mfa/setup",
    summary: "Iniciar la configuración de MFA (TOTP)",
    tag: "Perfil",
    rateLimit: [{ name: "mfa-setup", by: "user", limit: 10, windowSec: 3600 }],
    handler: async ({ me }) => {
      if (me.mfaEnabled) throw conflict("MFA ya está activo");
      const secret = generateSecret();
      await withSystem((tx) => tx.update(users).set({ mfaPendingSecretEnc: encrypt(secret) }).where(eq(users.id, me.id)));
      const otpauthUrl = generateURI({ issuer: "Tableros", label: me.email, secret });
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
      return { secret, otpauthUrl, qrDataUrl };
    },
  }),

  route({
    method: "POST",
    path: "/me/mfa/enable",
    summary: "Activar MFA confirmando un código (devuelve códigos de recuperación)",
    tag: "Perfil",
    rateLimit: [{ name: "mfa-enable", by: "user", limit: 10, windowSec: 900 }],
    body: z.object({ code: z.string().trim().regex(/^\d{6}$/, "Código de 6 dígitos") }),
    handler: async ({ me, body, audit: actx }) => {
      const codes = await withSystem(async (tx) => {
        const [u] = await tx.select({ pending: users.mfaPendingSecretEnc }).from(users).where(eq(users.id, me.id));
        if (!u?.pending) throw badRequest("Primero iniciá la configuración de MFA");
        const secret = decrypt(u.pending);
        const r = await verifyTotp({ secret, token: body.code, epochTolerance: 30 });
        if (!r.valid) throw new AppError(400, "invalid_code", "Código incorrecto");
        await tx
          .update(users)
          .set({ mfaEnabled: true, mfaSecretEnc: encrypt(secret), mfaPendingSecretEnc: null })
          .where(eq(users.id, me.id));
        const list = newRecoveryCodes();
        await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, me.id));
        await tx.insert(mfaRecoveryCodes).values(list.map((c) => ({ id: uuidv7(), userId: me.id, codeHash: sha256(c.replace("-", "")) })));
        await revokeUserSessions(tx, me.id, "mfa_enabled", me.sessionId);
        await audit(tx, actx, "auth.mfa_enabled", { targetType: "user", targetId: me.id });
        return list;
      });
      return { recoveryCodes: codes };
    },
  }),

  route({
    method: "POST",
    path: "/me/mfa/disable",
    summary: "Desactivar MFA (requiere contraseña y código)",
    tag: "Perfil",
    rateLimit: [{ name: "mfa-disable", by: "user", limit: 5, windowSec: 900 }],
    body: z.object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(20) }),
    handler: async ({ me, body, audit: actx }) => {
      await checkPassword(me.id, body.password);
      await withSystem(async (tx) => {
        if (!(await verifySecondFactor(tx, me.id, body.code))) throw new AppError(400, "invalid_code", "Código incorrecto");
        await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null }).where(eq(users.id, me.id));
        await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, me.id));
        await audit(tx, actx, "auth.mfa_disabled", { targetType: "user", targetId: me.id });
      });
      return { ok: true };
    },
  }),

  route({
    method: "POST",
    path: "/me/mfa/recovery-codes",
    summary: "Regenerar códigos de recuperación",
    tag: "Perfil",
    rateLimit: [{ name: "mfa-codes", by: "user", limit: 5, windowSec: 3600 }],
    body: z.object({ password: z.string().min(1).max(128) }),
    handler: async ({ me, body, audit: actx }) => {
      if (!me.mfaEnabled) throw badRequest("MFA no está activo");
      await checkPassword(me.id, body.password);
      const list = newRecoveryCodes();
      await withSystem(async (tx) => {
        await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, me.id));
        await tx.insert(mfaRecoveryCodes).values(list.map((c) => ({ id: uuidv7(), userId: me.id, codeHash: sha256(c.replace("-", "")) })));
        await audit(tx, actx, "auth.mfa_codes_regenerated", { targetType: "user", targetId: me.id });
      });
      return { recoveryCodes: list };
    },
  }),

  route({
    method: "POST",
    path: "/me/avatar",
    summary: "Subir avatar (PNG, JPEG, GIF o WebP, máx. 1 MB)",
    tag: "Perfil",
    multipart: true,
    rateLimit: [{ name: "avatar", by: "user", limit: 10, windowSec: 3600 }],
    handler: async ({ me, form }) => {
      const file = await validateUpload(form?.get("file") ?? null, { maxBytes: MAX_AVATAR_BYTES, imagesOnly: true });
      const key = `avatars/${me.id}/${uuidv7()}`;
      await storage().put(key, file.bytes, file.mime);
      await withSystem(async (tx) => {
        if (me.avatarKey) await tx.insert(storageGc).values({ key: me.avatarKey }).onConflictDoNothing();
        await tx.update(users).set({ avatarKey: key }).where(eq(users.id, me.id));
      });
      return { ok: true };
    },
  }),

  route({
    method: "DELETE",
    path: "/me/avatar",
    summary: "Quitar avatar",
    tag: "Perfil",
    handler: async ({ me }) => {
      await withSystem(async (tx) => {
        if (me.avatarKey) await tx.insert(storageGc).values({ key: me.avatarKey }).onConflictDoNothing();
        await tx.update(users).set({ avatarKey: null }).where(eq(users.id, me.id));
      });
      return undefined;
    },
  }),

  route({
    method: "GET",
    path: "/users/:userId/avatar",
    summary: "Avatar de un usuario visible (comparte organización)",
    tag: "Perfil",
    handler: async ({ me, params }) => {
      const [u] = await withUser(me.id, (tx) =>
        tx.select({ key: users.avatarKey }).from(users).where(eq(users.id, params.userId)),
      );
      if (!u?.key) throw notFound("Avatar");
      const bytes = await storage().get(u.key);
      const { fileTypeFromBuffer } = await import("file-type");
      const mime = (await fileTypeFromBuffer(bytes))?.mime ?? "application/octet-stream";
      const res = downloadResponse(bytes, mime, "avatar", true);
      return res;
    },
  }),

  route({
    method: "DELETE",
    path: "/me",
    summary: "Eliminar la cuenta (anonimiza datos personales)",
    tag: "Perfil",
    rateLimit: [{ name: "delete-account", by: "user", limit: 3, windowSec: 3600 }],
    body: z.object({ password: z.string().min(1).max(128) }),
    handler: async ({ me, body, audit: actx, setCookies }) => {
      await checkPassword(me.id, body.password);
      await withSystem(async (tx) => {
        const owned = await tx
          .select({ orgId: organizationMembers.orgId })
          .from(organizationMembers)
          .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
          .where(and(eq(organizationMembers.userId, me.id), eq(organizationMembers.role, "owner"), isNull(organizations.deletedAt)));
        if (owned.length > 0) {
          const ids = owned.map((o) => o.orgId);
          const otherOwners = await tx
            .select({ orgId: organizationMembers.orgId, n: sql<number>`count(*)::int` })
            .from(organizationMembers)
            .where(and(inArray(organizationMembers.orgId, ids), eq(organizationMembers.role, "owner")))
            .groupBy(organizationMembers.orgId);
          if (otherOwners.some((o) => o.n < 2)) {
            throw conflict("Sos el único dueño de una organización. Transferí la propiedad o eliminá la organización primero.", "sole_owner");
          }
        }
        await tx.delete(organizationMembers).where(eq(organizationMembers.userId, me.id));
        if (me.avatarKey) await tx.insert(storageGc).values({ key: me.avatarKey }).onConflictDoNothing();
        await tx
          .update(users)
          .set({
            email: `deleted+${me.id}@invalid.local`,
            name: "Usuario eliminado",
            passwordHash: "!",
            avatarKey: null,
            mfaEnabled: false,
            mfaSecretEnc: null,
            mfaPendingSecretEnc: null,
            deletedAt: new Date(),
          })
          .where(eq(users.id, me.id));
        await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, me.id));
        await revokeUserSessions(tx, me.id, "account_deleted");
        await audit(tx, actx, "account.deleted", { targetType: "user", targetId: me.id });
      });
      setCookies.push(...clearAuthCookies());
      return undefined;
    },
  }),
];
