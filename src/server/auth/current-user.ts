import "server-only";
import { cookies } from "next/headers";
import { cookieNames } from "./cookies";
import { verifyAccessToken } from "./jwt";
import { loadSessionUser, type SessionUser } from "./session";

export type PageAuth =
  | { status: "ok"; user: SessionUser }
  | { status: "refresh" } // access vencido pero hay refresh: renovar y volver
  | { status: "anonymous" };

/** Para Server Components / layouts. La API usa su propio flujo en el router. */
export async function getPageAuth(): Promise<PageAuth> {
  const jar = await cookies();
  const names = cookieNames();
  const access = jar.get(names.access)?.value;
  const hasRefresh = Boolean(jar.get(names.refresh)?.value);
  if (access) {
    const r = await verifyAccessToken(access);
    if (r.ok) {
      const user = await loadSessionUser(r.value.userId, r.value.sessionId);
      if (user) return { status: "ok", user };
      return { status: "anonymous" };
    }
  }
  return hasRefresh ? { status: "refresh" } : { status: "anonymous" };
}
