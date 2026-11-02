import "server-only";
import { isProd } from "../core/env";
import { ACCESS_TTL_SEC } from "./jwt";

// En producción se usan prefijos __Host- (Secure, Path=/, sin Domain). En localhost http no aplican.
export const cookieNames = () => {
  const p = isProd() ? "__Host-" : "";
  return { access: `${p}faro_at`, refresh: `${p}faro_rt`, mfa: `${p}faro_mfa` };
};

export const REFRESH_TTL_SEC = 14 * 24 * 60 * 60;

function serialize(name: string, value: string, maxAge: number) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (isProd()) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookies(accessToken: string, refreshToken?: string): string[] {
  const n = cookieNames();
  const out = [serialize(n.access, accessToken, ACCESS_TTL_SEC + 60)];
  if (refreshToken) out.push(serialize(n.refresh, refreshToken, REFRESH_TTL_SEC));
  return out;
}

export const mfaCookie = (token: string) => serialize(cookieNames().mfa, token, 5 * 60);

export function clearAuthCookies(): string[] {
  const n = cookieNames();
  return [serialize(n.access, "", 0), serialize(n.refresh, "", 0), serialize(n.mfa, "", 0)];
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}
