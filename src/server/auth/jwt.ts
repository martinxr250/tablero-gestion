import "server-only";
import { errors, importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from "jose";
import { randomToken } from "../core/crypto";
import { env } from "../core/env";

const ALG = "EdDSA";
const ISSUER = "faro";
export const ACCESS_TTL_SEC = 10 * 60;

let keysPromise: Promise<{ priv: CryptoKey; pub: CryptoKey }> | undefined;
function keys() {
  keysPromise ??= (async () => {
    const pem = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
    return {
      priv: await importPKCS8(pem(env().JWT_PRIVATE_KEY), ALG),
      pub: await importSPKI(pem(env().JWT_PUBLIC_KEY), ALG),
    };
  })();
  return keysPromise;
}

type Purpose = "access" | "mfa";

async function sign(purpose: Purpose, subject: string, claims: Record<string, unknown>, ttlSec: number) {
  return new SignJWT({ ...claims, pur: purpose })
    .setProtectedHeader({ alg: ALG, kid: env().JWT_KID, typ: "JWT" })
    .setSubject(subject)
    .setIssuer(ISSUER)
    .setAudience(`faro:${purpose}`)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
    .setJti(randomToken(12))
    .sign((await keys()).priv);
}

export type VerifyResult<T> = { ok: true; value: T } | { ok: false; reason: "expired" | "invalid" };

async function verify(purpose: Purpose, token: string): Promise<VerifyResult<{ sub: string; claims: Record<string, unknown> }>> {
  try {
    const { payload } = await jwtVerify(token, (await keys()).pub, {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: `faro:${purpose}`,
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (payload.pur !== purpose || typeof payload.sub !== "string") return { ok: false, reason: "invalid" };
    return { ok: true, value: { sub: payload.sub, claims: payload } };
  } catch (err) {
    return { ok: false, reason: err instanceof errors.JWTExpired ? "expired" : "invalid" };
  }
}

export const signAccessToken = (userId: string, sessionId: string) =>
  sign("access", userId, { sid: sessionId }, ACCESS_TTL_SEC);

export async function verifyAccessToken(token: string): Promise<VerifyResult<{ userId: string; sessionId: string }>> {
  const r = await verify("access", token);
  if (!r.ok) return r;
  const sid = r.value.claims.sid;
  if (typeof sid !== "string") return { ok: false, reason: "invalid" };
  return { ok: true, value: { userId: r.value.sub, sessionId: sid } };
}

// Token intermedio entre contraseña correcta y código MFA (5 minutos, sin acceso a la API).
export const signMfaToken = (userId: string) => sign("mfa", userId, {}, 5 * 60);
export async function verifyMfaToken(token: string) {
  const r = await verify("mfa", token);
  return r.ok ? r.value.sub : null;
}
