import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generate } from "otplib";
import { dispatch } from "@/server/api/router";
import { compiledRoutes } from "@/server/api";

const BASE = "http://localhost:3000";
let ipCounter = 1;

export type Res<T = any> = { status: number; body: T; headers: Headers };

/** Cliente HTTP que invoca el mismo dispatcher de la API, con su propio "navegador" (cookies, IP). */
export class Client {
  cookies = new Map<string, string>();
  ip = `10.0.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
  email = "";
  password = "";
  id = "";
  name = "";

  async req<T = any>(method: string, p: string, body?: unknown, opts: { origin?: string | null; form?: FormData; headers?: Record<string, string>; rawBody?: string } = {}): Promise<Res<T>> {
    const headers = new Headers(opts.headers);
    if (opts.origin !== null) headers.set("origin", opts.origin ?? BASE);
    headers.set("x-real-ip", this.ip);
    headers.set("user-agent", "vitest");
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let payload: BodyInit | undefined;
    if (opts.form) {
      const r = new Request(BASE, { method: "POST", body: opts.form });
      const buf = await r.arrayBuffer();
      headers.set("content-type", r.headers.get("content-type")!);
      headers.set("content-length", String(buf.byteLength));
      payload = buf;
    } else if (opts.rawBody !== undefined) {
      payload = opts.rawBody;
    } else if (body !== undefined) {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body);
    }
    const res = await dispatch(new Request(`${BASE}/api/v1${p}`, { method, headers, body: payload }), compiledRoutes);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const idx = pair!.indexOf("=");
      const k = pair!.slice(0, idx);
      const v = pair!.slice(idx + 1);
      if (/Max-Age=0/.test(c) || v === "") this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = res.headers.get("content-type")?.includes("json") ? await res.text() : "";
    return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers } as Res<T>;
  }
  get = <T = any>(p: string) => this.req<T>("GET", p);
  post = <T = any>(p: string, b?: unknown) => this.req<T>("POST", p, b ?? {});
  patch = <T = any>(p: string, b: unknown) => this.req<T>("PATCH", p, b);
  put = <T = any>(p: string, b: unknown) => this.req<T>("PUT", p, b);
  del = <T = any>(p: string, b?: unknown) => this.req<T>("DELETE", p, b);
}

export function mailsTo(email: string): { to: string; subject: string; text: string }[] {
  const dir = path.join(process.cwd(), ".data", "mail");
  let files: string[] = [];
  try {
    files = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return files
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")))
    .filter((m) => m.to === email);
}

export function tokenFromLastMail(email: string, kind: "verify-email" | "reset-password" | "invite") {
  const mails = mailsTo(email);
  for (let i = mails.length - 1; i >= 0; i--) {
    const m = mails[i]!.text.match(new RegExp(`/${kind}\\?token=([A-Za-z0-9_%-]+)`));
    if (m) return decodeURIComponent(m[1]!);
  }
  throw new Error(`No hay correo ${kind} para ${email}`);
}

let userCounter = 0;
export async function newUser(name = "Usuario"): Promise<Client> {
  const c = new Client();
  c.name = `${name} ${++userCounter}`;
  c.email = `user${userCounter}-${Date.now()}@example.test`;
  c.password = "Una-clave-larga-2026";
  const r = await c.post("/auth/register", { email: c.email, name: c.name, password: c.password });
  if (r.status !== 202) throw new Error(`register ${r.status} ${JSON.stringify(r.body)}`);
  await c.post("/auth/verify-email", { token: tokenFromLastMail(c.email, "verify-email") });
  const l = await c.post("/auth/login", { email: c.email, password: c.password });
  if (l.status !== 200) throw new Error(`login ${l.status} ${JSON.stringify(l.body)}`);
  c.id = (await c.get("/me")).body.user.id;
  return c;
}

export const totp = (secret: string) => generate({ secret });

/** Crea org + tablero (en el workspace inicial) + una tarjeta. */
export async function seedBoard(owner: Client) {
  const org = (await owner.post("/orgs", { name: `Org de ${owner.name}` })).body as { id: string; workspaceId: string };
  const board = (await owner.post(`/workspaces/${org.workspaceId}/boards`, { name: "Tablero", visibility: "private" })).body as { id: string };
  const detail = (await owner.get(`/boards/${board.id}`)).body;
  const listId = detail.lists[0].id as string;
  const card = (await owner.post(`/lists/${listId}/cards`, { title: "Primera tarea" })).body as { id: string };
  return { orgId: org.id, workspaceId: org.workspaceId, boardId: board.id, listId, lists: detail.lists as { id: string }[], cardId: card.id };
}

export async function inviteAndAccept(admin: Client, invitee: Client, path: string, role: string) {
  const r = await admin.post(path, { email: invitee.email, role });
  if (r.status !== 201) throw new Error(`invite ${r.status} ${JSON.stringify(r.body)}`);
  const token = tokenFromLastMail(invitee.email, "invite");
  const a = await invitee.post("/invitations/accept", { token });
  if (a.status !== 200) throw new Error(`accept ${a.status} ${JSON.stringify(a.body)}`);
  return a.body;
}
