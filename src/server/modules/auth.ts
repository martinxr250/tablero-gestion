import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { verify as verifyTotp } from "otplib";
import { z } from "zod";
import { route } from "../api/router";
import { clearAuthCookies, cookieNames, mfaCookie, readCookie, sessionCookies } from "../auth/cookies";
import { signMfaToken, verifyMfaToken } from "../auth/jwt";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../auth/password";
import { passwordContainsEmail, passwordSchema } from "../auth/password-policy";
import { createSession, revokeSession, revokeUserSessions, rotateSession } from "../auth/session";
import { audit } from "../core/audit";
import { decrypt, randomToken, sha256 } from "../core/crypto";
import { env } from "../core/env";
import { AppError, badRequest, unauthorized } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { rateLimit } from "../core/rate-limit";
import { withSystem, type Tx } from "../db/client";
import { authTokens, mfaRecoveryCodes, sessions, users } from "../db/schema";
import { sendMail } from "../email/mailer";
import { passwordChangedMail, registerAttemptMail, resetPasswordMail, verifyEmailMail } from "../email/templates";

export const emailSchema = z.email("Correo inválido").max(254).transform((e) => e.trim().toLowerCase());
export const nameSchema = z.string().trim().min(1, "Ingresá tu nombre").max(80);

const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;

async function issueToken(tx: Tx, userId: string, type: "verify_email" | "reset_password", ttlMin: number) {
  const token = randomToken(32);
  // Un único token vigente por tipo: los anteriores quedan invalidados.
  await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.type, type), isNull(authTokens.usedAt)));
  await tx.insert(authTokens).values({
    id: uuidv7(),
    userId,
    type,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMin * 60_000),
  });
  return token;
}

async function consumeToken(tx: Tx, token: string, type: "verify_email" | "reset_password") {
  const [row] = await tx
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: authTokens.userId });
  if (!row) throw badRequest("El enlace no es válido o ya venció");
  return row.userId;
}

/** Verifica un código TOTP o de recuperación de un usuario con MFA activo. */
export async function verifySecondFactor(tx: Tx, userId: string, code: string): Promise<"totp" | "recovery" | null> {
  const [u] = await tx.select({ secret: users.mfaSecretEnc }).from(users).where(eq(users.id, userId));
  if (!u?.secret) return null;
  const clean = code.replace(/\s|-/g, "");
  if (/^\d{6}$/.test(clean)) {
    const r = await verifyTotp({ secret: decrypt(u.secret), token: clean, epochTolerance: 30 });
    return r.valid ? "totp" : null;
  }
  const [used] = await tx
    .update(mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(eq(mfaRecoveryCodes.userId, userId), eq(mfaRecoveryCodes.codeHash, sha256(clean.toLowerCase())), isNull(mfaRecoveryCodes.usedAt)),
    )
    .returning({ id: mfaRecoveryCodes.id });
  return used ? "recovery" : null;
}

const GENERIC_LOGIN_ERROR = () => new AppError(401, "invalid_credentials", "Correo o contraseña incorrectos");

export const authRoutes = [
  route({
    method: "POST",
    path: "/auth/register",
    summary: "Registrar una cuenta (envía correo de verificación)",
    tag: "Autenticación",
    auth: "none",
    status: 202,
    rateLimit: [{ name: "register", by: "ip", limit: 10, windowSec: 3600 }],
    body: z.object({ email: emailSchema, name: nameSchema, password: passwordSchema }),
    handler: async ({ body, audit: actx }) => {
      if (passwordContainsEmail(body.password, body.email)) throw badRequest("La contraseña no puede contener tu correo");
      const passwordHash = await hashPassword(body.password);
      const mail = await withSystem(async (tx) => {
        const [existing] = await tx.select().from(users).where(eq(users.email, body.email));
        if (existing) {
          if (existing.deletedAt) return null;
          if (!existing.emailVerifiedAt) {
            const token = await issueToken(tx, existing.id, "verify_email", 24 * 60);
            return { to: existing.email, ...verifyEmailMail(existing.name, token) };
          }
          return { to: existing.email, ...registerAttemptMail(existing.name) };
        }
        const id = uuidv7();
        await tx.insert(users).values({ id, email: body.email, name: body.name, passwordHash });
        await audit(tx, { ...actx, actorId: id }, "auth.register", { targetType: "user", targetId: id });
        const token = await issueToken(tx, id, "verify_email", 24 * 60);
        return { to: body.email, ...verifyEmailMail(body.name, token) };
      });
      if (mail) await sendMail(mail);
      // Respuesta idéntica exista o no la cuenta: evita enumerar correos.
      return { message: "Si el correo es válido, te enviamos un enlace para confirmarlo." };
    },
  }),

  route({
    method: "POST",
    path: "/auth/verify-email",
    summary: "Confirmar correo con el token recibido",
    tag: "Autenticación",
    auth: "none",
    rateLimit: [{ name: "verify-email", by: "ip", limit: 20, windowSec: 900 }],
    body: z.object({ token: z.string().min(10).max(200) }),
    handler: async ({ body, audit: actx }) => {
      await withSystem(async (tx) => {
        const userId = await consumeToken(tx, body.token, "verify_email");
        await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
        await audit(tx, { ...actx, actorId: userId }, "auth.email_verified", { targetType: "user", targetId: userId });
      });
      return { message: "Correo confirmado. Ya podés iniciar sesión." };
    },
  }),

  route({
    method: "POST",
    path: "/auth/resend-verification",
    summary: "Reenviar correo de verificación (respuesta genérica)",
    tag: "Autenticación",
    auth: "none",
    status: 202,
    rateLimit: [{ name: "resend-verification", by: "ip", limit: 10, windowSec: 3600 }],
    body: z.object({ email: emailSchema }),
    handler: async ({ body }) => {
      await rateLimit(`resend:email:${sha256(body.email)}`, 3, 3600);
      const mail = await withSystem(async (tx) => {
        const [u] = await tx.select().from(users).where(eq(users.email, body.email));
        if (!u || u.deletedAt || u.emailVerifiedAt) return null;
        const token = await issueToken(tx, u.id, "verify_email", 24 * 60);
        return { to: u.email, ...verifyEmailMail(u.name, token) };
      });
      if (mail) await sendMail(mail).catch((err) => logger.error("resend_mail_failed", { err }));
      return { message: "Si la cuenta existe y no está confirmada, te enviamos un nuevo enlace." };
    },
  }),

  route({
    method: "POST",
    path: "/auth/login",
    summary: "Iniciar sesión con correo y contraseña",
    tag: "Autenticación",
    auth: "none",
    rateLimit: [{ name: "login", by: "ip", limit: 30, windowSec: 900 }],
    body: z.object({ email: emailSchema, password: z.string().min(1).max(128) }),
    handler: async ({ body, ipHash, userAgent, audit: actx, setCookies }) => {
      await rateLimit(`login:email:${sha256(body.email)}`, 10, 900);
      const result = await withSystem(async (tx) => {
        const [u] = await tx.select().from(users).where(eq(users.email, body.email)).for("update");
        if (!u || u.deletedAt) {
          await burnPasswordCheck(body.password);
          return { kind: "fail" as const };
        }
        if (u.lockedUntil && u.lockedUntil > new Date()) {
          await burnPasswordCheck(body.password);
          return { kind: "locked" as const };
        }
        if (!(await verifyPassword(u.passwordHash, body.password))) {
          const failures = u.failedLoginCount + 1;
          const lock = failures >= LOCK_AFTER_FAILURES;
          await tx
            .update(users)
            .set({
              failedLoginCount: lock ? 0 : failures,
              lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : u.lockedUntil,
            })
            .where(eq(users.id, u.id));
          await audit(tx, { ...actx, actorId: u.id }, lock ? "auth.account_locked" : "auth.login_failed", {
            targetType: "user",
            targetId: u.id,
          });
          return { kind: "fail" as const };
        }
        await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, u.id));
        if (!u.emailVerifiedAt) return { kind: "unverified" as const };
        if (u.mfaEnabled) return { kind: "mfa" as const, userId: u.id };
        const s = await createSession(tx, u.id, { userAgent, ipHash });
        await audit(tx, { ...actx, actorId: u.id }, "auth.login", { targetType: "session", targetId: s.sessionId });
        return { kind: "ok" as const, ...s };
      });

      if (result.kind === "fail") throw GENERIC_LOGIN_ERROR();
      if (result.kind === "locked") {
        throw new AppError(423, "account_locked", `Cuenta bloqueada temporalmente por intentos fallidos. Probá en ${LOCK_MINUTES} minutos.`);
      }
      if (result.kind === "unverified") {
        throw new AppError(403, "email_not_verified", "Confirmá tu correo antes de iniciar sesión. Revisá tu bandeja de entrada.");
      }
      if (result.kind === "mfa") {
        setCookies.push(mfaCookie(await signMfaToken(result.userId)));
        return { status: "mfa_required" };
      }
      setCookies.push(...sessionCookies(result.accessToken, result.refreshToken));
      return { status: "ok" };
    },
  }),

  route({
    method: "POST",
    path: "/auth/mfa",
    summary: "Completar el inicio de sesión con el segundo factor",
    tag: "Autenticación",
    auth: "none",
    rateLimit: [{ name: "mfa", by: "ip", limit: 10, windowSec: 300 }],
    body: z.object({ code: z.string().trim().min(6).max(20) }),
    handler: async ({ req, body, ipHash, userAgent, audit: actx, setCookies }) => {
      const pending = readCookie(req.headers.get("cookie"), cookieNames().mfa);
      const userId = pending ? await verifyMfaToken(pending) : null;
      if (!userId) throw unauthorized("mfa_expired", "El paso de verificación venció. Iniciá sesión de nuevo.");
      await rateLimit(`mfa:user:${userId}`, 5, 300);
      const s = await withSystem(async (tx) => {
        const method = await verifySecondFactor(tx, userId, body.code);
        if (!method) {
          await audit(tx, { ...actx, actorId: userId }, "auth.mfa_failed", { targetType: "user", targetId: userId });
          return null;
        }
        const session = await createSession(tx, userId, { userAgent, ipHash });
        await audit(tx, { ...actx, actorId: userId }, "auth.login", {
          targetType: "session",
          targetId: session.sessionId,
          data: { mfa: method },
        });
        return session;
      });
      if (!s) throw new AppError(401, "invalid_code", "Código incorrecto");
      setCookies.push(...sessionCookies(s.accessToken, s.refreshToken), `${cookieNames().mfa}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
      return { status: "ok" };
    },
  }),

  route({
    method: "POST",
    path: "/auth/refresh",
    summary: "Renovar el access token rotando el refresh token",
    tag: "Autenticación",
    auth: "none",
    handler: async ({ req, ipHash, userAgent, setCookies }) => {
      const refresh = readCookie(req.headers.get("cookie"), cookieNames().refresh);
      if (!refresh) throw unauthorized("unauthenticated", "Iniciá sesión para continuar");
      try {
        const r = await rotateSession(refresh, { ipHash, userAgent });
        setCookies.push(...sessionCookies(r.accessToken, r.refreshToken));
      } catch (err) {
        setCookies.push(...clearAuthCookies());
        throw err;
      }
      return undefined;
    },
  }),

  route({
    method: "GET",
    path: "/auth/refresh-redirect",
    summary: "Renovar la sesión durante una navegación y volver a la página",
    tag: "Autenticación",
    auth: "none",
    query: z.object({ next: z.string().max(500).optional() }),
    handler: async ({ req, query, ipHash, userAgent }) => {
      const next = query.next && /^\/(?!\/)[\w\-./?=&%#]*$/.test(query.next) ? query.next : "/dashboard";
      const base = env().APP_URL;
      const refresh = readCookie(req.headers.get("cookie"), cookieNames().refresh);
      const res = (location: string) => new Response(null, { status: 303, headers: { Location: new URL(location, base).toString() } });
      if (!refresh) return res(`/login?next=${encodeURIComponent(next)}`);
      try {
        const r = await rotateSession(refresh, { ipHash, userAgent });
        const out = res(next);
        for (const c of sessionCookies(r.accessToken, r.refreshToken)) out.headers.append("Set-Cookie", c);
        return out;
      } catch {
        const out = res(`/login?next=${encodeURIComponent(next)}`);
        for (const c of clearAuthCookies()) out.headers.append("Set-Cookie", c);
        return out;
      }
    },
  }),

  route({
    method: "POST",
    path: "/auth/logout",
    summary: "Cerrar la sesión actual",
    tag: "Autenticación",
    auth: "none",
    handler: async ({ req, setCookies, audit: actx }) => {
      const refresh = readCookie(req.headers.get("cookie"), cookieNames().refresh);
      if (refresh) {
        await withSystem(async (tx) => {
          const [s] = await tx.select().from(sessions).where(eq(sessions.refreshHash, sha256(refresh)));
          if (s) {
            await revokeSession(tx, s.id, "logout");
            await audit(tx, { ...actx, actorId: s.userId }, "auth.logout", { targetType: "session", targetId: s.id });
          }
        });
      }
      setCookies.push(...clearAuthCookies());
      return undefined;
    },
  }),

  route({
    method: "POST",
    path: "/auth/logout-all",
    summary: "Cerrar todas las sesiones del usuario",
    tag: "Autenticación",
    auth: "user-unverified",
    handler: async ({ me, setCookies, audit: actx }) => {
      await withSystem(async (tx) => {
        await revokeUserSessions(tx, me.id, "logout_all");
        await audit(tx, actx, "auth.logout_all", { targetType: "user", targetId: me.id });
      });
      setCookies.push(...clearAuthCookies());
      return undefined;
    },
  }),

  route({
    method: "POST",
    path: "/auth/forgot-password",
    summary: "Solicitar enlace para restablecer la contraseña",
    tag: "Autenticación",
    auth: "none",
    status: 202,
    rateLimit: [{ name: "forgot", by: "ip", limit: 10, windowSec: 900 }],
    body: z.object({ email: emailSchema }),
    handler: async ({ body }) => {
      await rateLimit(`forgot:email:${sha256(body.email)}`, 3, 900);
      const mail = await withSystem(async (tx) => {
        const [u] = await tx.select().from(users).where(eq(users.email, body.email));
        if (!u || u.deletedAt) return null;
        const token = await issueToken(tx, u.id, "reset_password", 30);
        return { to: u.email, ...resetPasswordMail(u.name, token) };
      });
      if (mail) {
        await sendMail(mail).catch((err) => logger.error("forgot_mail_failed", { err }));
      }
      return { message: "Si el correo está registrado, te enviamos un enlace." };
    },
  }),

  route({
    method: "POST",
    path: "/auth/reset-password",
    summary: "Restablecer la contraseña con el token recibido",
    tag: "Autenticación",
    auth: "none",
    rateLimit: [{ name: "reset", by: "ip", limit: 10, windowSec: 900 }],
    body: z.object({ token: z.string().min(10).max(200), password: passwordSchema }),
    handler: async ({ body, audit: actx }) => {
      const passwordHash = await hashPassword(body.password);
      const u = await withSystem(async (tx) => {
        const userId = await consumeToken(tx, body.token, "reset_password");
        const [current] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
        // Al lanzar, la transacción se revierte y el token sigue siendo válido para reintentar.
        if (current && passwordContainsEmail(body.password, current.email)) {
          throw badRequest("La contraseña no puede contener tu correo");
        }
        const [user] = await tx
          .update(users)
          .set({ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() })
          .where(eq(users.id, userId))
          .returning();
        await revokeUserSessions(tx, userId, "password_reset");
        await audit(tx, { ...actx, actorId: userId }, "auth.password_reset", { targetType: "user", targetId: userId });
        return user!;
      });
      await sendMail({ to: u.email, ...passwordChangedMail(u.name) }).catch((err) => logger.error("mail_failed", { err }));
      return { message: "Contraseña actualizada. Ya podés iniciar sesión." };
    },
  }),
];
