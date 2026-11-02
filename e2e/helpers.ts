import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_URL } from "../playwright.config";

let n = 0;
const stamp = Date.now().toString(36);

/** Lee el token del último correo de verificación (driver "file" en .data/mail). */
function verifyToken(email: string) {
  const dir = path.join(process.cwd(), ".data", "mail");
  const mails = readdirSync(dir)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { to: string; text: string })
    .filter((m) => m.to === email);
  const m = mails.at(-1)?.text.match(/\/verify-email\?token=([A-Za-z0-9_%-]+)/);
  if (!m) throw new Error(`Sin correo de verificación para ${email}`);
  return decodeURIComponent(m[1]!);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- respuestas JSON de la API en pruebas
export type Session = { context: BrowserContext; page: Page; email: string; id: string; api: <T = any>(method: string, p: string, body?: unknown) => Promise<{ status: number; body: T }> };

/**
 * Crea una persona de prueba (registro + verificación por la API) e inicia sesión por la
 * pantalla real de login en un contexto de navegador propio (cookies independientes).
 */
export async function newSession(browser: Browser, name: string, opts: { viewport?: { width: number; height: number } } = {}): Promise<Session> {
  const email = `e2e-${stamp}-${++n}@example.test`;
  const password = "Prueba-E2E-segura-2026";
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 } });
  const page = await context.newPage();
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await context.request.fetch(`${E2E_URL}/api/v1${p}`, { method, headers: { origin: E2E_URL, "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status(), body: text ? JSON.parse(text) : undefined };
  };
  expect((await call("POST", "/auth/register", { email, name, password })).status).toBe(202);
  expect((await call("POST", "/auth/verify-email", { token: verifyToken(email) })).status).toBeLessThan(300);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  const me = await call("GET", "/me");
  return { context, page, email, id: me.body.user.id, api: call as Session["api"] };
}

/** Organización + tablero de prueba creados por la API. */
export async function seedBoard(s: Session, name = "Tablero E2E") {
  const org = (await s.api("POST", "/orgs", { name: `Org ${name}` })).body;
  const board = (await s.api("POST", `/workspaces/${org.workspaceId}/boards`, { name, visibility: "private" })).body;
  const detail = (await s.api("GET", `/boards/${board.id}`)).body;
  return { orgId: org.id as string, boardId: board.id as string, lists: detail.lists as { id: string; name: string }[] };
}
