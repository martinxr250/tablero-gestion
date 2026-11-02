import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// IPs se guardan solo como HMAC (para auditoría/rate limit sin almacenar la IP).
export const hashIp = (ip: string) => createHmac("sha256", env().IP_HASH_SECRET).update(ip).digest("hex").slice(0, 32);

// AES-256-GCM para secretos en reposo (p. ej. semilla TOTP). Formato: v1.iv.tag.ciphertext
// La etiqueta se fija en 16 bytes: no se acepta una más corta al descifrar.
const TAG_LENGTH = 16;
export function encrypt(plain: string): string {
  const key = Buffer.from(env().ENCRYPTION_KEY, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Formato de cifrado desconocido");
  const key = Buffer.from(env().ENCRYPTION_KEY, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"), { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
