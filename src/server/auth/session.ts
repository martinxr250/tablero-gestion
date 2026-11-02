import "server-only";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { randomToken, sha256 } from "../core/crypto";
import { audit, type AuditContext } from "../core/audit";
import { unauthorized } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withSystem, type Tx } from "../db/client";
import { sessions, users } from "../db/schema";
import { REFRESH_TTL_SEC } from "./cookies";
import { signAccessToken } from "./jwt";

/** Ventana en la que reusar el refresh anterior no se considera robo (requests concurrentes). */
const ROTATION_GRACE_MS = 30_000;

export async function createSession(tx: Tx, userId: string, meta: { userAgent?: string; ipHash?: string }) {
  const id = uuidv7();
  const refresh = randomToken(32);
  await tx.insert(sessions).values({
    id,
    userId,
    refreshHash: sha256(refresh),
    userAgent: meta.userAgent?.slice(0, 300),
    ipHash: meta.ipHash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
  });
  return { sessionId: id, accessToken: await signAccessToken(userId, id), refreshToken: refresh };
}

/**
 * Rota el refresh token. Si llega un refresh ya rotado fuera de la ventana de gracia,
 * se asume robo y se revoca la sesión completa.
 */
export async function rotateSession(refreshRaw: string, ctx: Omit<AuditContext, "actorId">) {
  const hash = sha256(refreshRaw);
  const result = await withSystem(async (tx) => {
    const now = new Date();
    const [current] = await tx
      .select({ s: sessions, deleted: users.deletedAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.refreshHash, hash))
      .for("update");

    if (current) {
      const s = current.s;
      if (s.revokedAt || s.expiresAt <= now || current.deleted) throw unauthorized("session_expired");
      const next = randomToken(32);
      await tx
        .update(sessions)
        .set({ refreshHash: sha256(next), prevRefreshHash: hash, rotatedAt: now, lastUsedAt: now })
        .where(eq(sessions.id, s.id));
      return { userId: s.userId, sessionId: s.id, accessToken: await signAccessToken(s.userId, s.id), refreshToken: next };
    }

    const [previous] = await tx.select().from(sessions).where(eq(sessions.prevRefreshHash, hash)).for("update");
    if (!previous || previous.revokedAt || previous.expiresAt <= now) throw unauthorized("session_expired");

    if (previous.rotatedAt && now.getTime() - previous.rotatedAt.getTime() < ROTATION_GRACE_MS) {
      // Request concurrente: solo se emite un access token; la cookie de refresh no se toca.
      return {
        userId: previous.userId,
        sessionId: previous.id,
        accessToken: await signAccessToken(previous.userId, previous.id),
        refreshToken: undefined,
      };
    }

    await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: "refresh_reuse" })
      .where(eq(sessions.id, previous.id));
    await audit(tx, { actorId: previous.userId, ...ctx }, "session.refresh_reuse_detected", {
      targetType: "session",
      targetId: previous.id,
    });
    // Se devuelve (no se lanza) para que la revocación quede confirmada antes de responder 401.
    return null;
  });
  if (!result) throw unauthorized("session_revoked");
  return result;
}

export async function revokeSession(tx: Tx, sessionId: string, reason: string) {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(tx: Tx, userId: string, reason: string, exceptSessionId?: string) {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date(), revokeReason: reason })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    );
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarKey: string | null;
  emailVerified: boolean;
  mfaEnabled: boolean;
  sessionId: string;
};

/** Valida que la sesión del token siga activa (permite revocación inmediata). */
export async function loadSessionUser(userId: string, sessionId: string): Promise<SessionUser | null> {
  const [row] = await withSystem((tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarKey: users.avatarKey,
        emailVerifiedAt: users.emailVerifiedAt,
        mfaEnabled: users.mfaEnabled,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          isNull(users.deletedAt),
        ),
      )
      .limit(1),
  );
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarKey: row.avatarKey,
    emailVerified: row.emailVerifiedAt !== null,
    mfaEnabled: row.mfaEnabled,
    sessionId,
  };
}
