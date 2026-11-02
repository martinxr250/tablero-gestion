import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt } from "@/server/core/crypto";
import { withSystem } from "@/server/db/client";
import { boardRepos } from "@/server/db/schema";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

// GitHub simulado: issues, PRs, checks por commit y revisiones por PR.
type Issue = { id: number; number: number; title: string; body: string; state: "open" | "closed"; labels: string[]; assignees: string[]; updated_at: string };
type Pull = { number: number; title: string; body: string; state: "open" | "closed"; merged_at: string | null; head: { ref: string; sha: string }; updated_at: string };
const gh = {
  issues: new Map<number, Issue>(),
  pulls: new Map<number, Pull>(),
  checks: new Map<string, "success" | "failure" | "pending">(),
  reviews: new Map<number, string>(),
  tick: Date.now(),
  now() {
    this.tick += 1000;
    return new Date(this.tick).toISOString();
  },
  issue(number: number, title: string) {
    const i: Issue = { id: 5000 + number, number, title, body: "", state: "open", labels: [], assignees: [], updated_at: this.now() };
    this.issues.set(number, i);
    return i;
  },
  pull(number: number, extra: Partial<Pull> = {}) {
    const p: Pull = { number, title: `PR ${number}`, body: "", state: "open", merged_at: null, head: { ref: `rama-${number}`, sha: `sha${number}` }, updated_at: this.now(), ...extra };
    this.pulls.set(number, p);
    return p;
  },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const apiIssue = (i: Issue) => ({ ...i, html_url: `https://github.com/acme/app/issues/${i.number}`, labels: [], assignees: [], milestone: null });
const apiPull = (p: Pull) => ({ id: 9000 + p.number, draft: false, html_url: `https://github.com/acme/app/pull/${p.number}`, user: { login: "dev" }, ...p });

function fakeGitHub(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const method = init?.method ?? "GET";
  const path = url.pathname;
  if (path === "/user") return json({ login: "octo" });
  if (path === "/repos/acme/app") return json({ id: 42, full_name: "acme/app", html_url: "https://github.com/acme/app", private: true, permissions: { push: true } });
  if (path === "/repos/acme/app/issues" && method === "GET") return json([]);
  let m = path.match(/^\/repos\/acme\/app\/issues\/(\d+)$/);
  if (m) {
    const i = gh.issues.get(Number(m[1]));
    if (!i) return json({ message: "Not Found" }, 404);
    if (method === "PATCH") Object.assign(i, JSON.parse(String(init!.body)), { updated_at: gh.now() });
    return json(apiIssue(i));
  }
  if (path === "/repos/acme/app/pulls") return json([...gh.pulls.values()].map(apiPull));
  m = path.match(/^\/repos\/acme\/app\/pulls\/(\d+)$/);
  if (m) return gh.pulls.has(Number(m[1])) ? json(apiPull(gh.pulls.get(Number(m[1]))!)) : json({ message: "Not Found" }, 404);
  m = path.match(/^\/repos\/acme\/app\/pulls\/(\d+)\/reviews$/);
  if (m) return json(gh.reviews.has(Number(m[1])) ? [{ state: gh.reviews.get(Number(m[1])) }] : []);
  m = path.match(/^\/repos\/acme\/app\/commits\/([^/]+)\/check-runs$/);
  if (m) {
    const st = gh.checks.get(m[1]!);
    if (!st) return json({ check_runs: [] });
    return json({ check_runs: [{ status: st === "pending" ? "in_progress" : "completed", conclusion: st === "pending" ? null : st }] });
  }
  return json({ message: `Ruta simulada inexistente: ${method} ${path}` }, 404);
}

describe("flujo de entrega con GitHub", () => {
  let lead: Client;
  let dev: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let boardRepoId: string;
  const newCard = async (title: string) => (await lead.post(`/lists/${s.listId}/cards`, { title })).body.id as string;
  const notifications = async (c: Client) => (await c.get("/notifications")).body.notifications as { type: string; cardId: string }[];

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeGitHub));
    lead = await newUser("Líder");
    dev = await newUser("Dev");
    s = await seedBoard(lead);
    await inviteAndAccept(lead, dev, `/boards/${s.boardId}/invitations`, "editor");
    await lead.post(`/orgs/${s.orgId}/vcs/connections`, { provider: "github", token: "github_pat_" + "x".repeat(40) });
    const conn = (await lead.get(`/orgs/${s.orgId}/vcs/connections`)).body.connections[0].id;
    boardRepoId = (await lead.put(`/boards/${s.boardId}/repo`, { connectionId: conn, repoFullName: "acme/app" })).body.id;
  });
  afterAll(() => vi.unstubAllGlobals());

  it("vincula un issue existente: igual queda sincronizado, distinto queda en conflicto sin pisar nada", async () => {
    gh.issue(10, "Login con Google");
    const same = await newCard("Login con Google");
    const r = await lead.post(`/cards/${same}/issue/link`, { number: 10 });
    expect(r.status).toBe(200);
    expect((await lead.get(`/cards/${same}/dev`)).body.issue).toMatchObject({ number: 10, conflict: null });

    gh.issue(11, "Título en GitHub");
    const diff = await newCard("Título en Tableros");
    await lead.post(`/cards/${diff}/issue/link`, { number: 11 });
    const dev11 = (await lead.get(`/cards/${diff}/dev`)).body.issue;
    expect(dev11.conflict.remote.title).toBe("Título en GitHub");
    expect(gh.issues.get(11)!.title).toBe("Título en GitHub");
    expect((await lead.get(`/cards/${diff}`)).body.card.title).toBe("Título en Tableros");

    // Sin duplicados: el mismo issue no se vincula a dos tarjetas.
    const other = await newCard("Otra");
    expect((await lead.post(`/cards/${other}/issue/link`, { number: 10 })).status).toBe(409);
    expect((await lead.post(`/cards/${other}/issue/link`, { number: 999 })).status).toBe(404);
  });

  it("vincula un PR a mano y muestra revisión, checks y merge reales", async () => {
    const card = await newCard("Pantalla de pagos");
    gh.pull(21);
    gh.checks.set("sha21", "pending");
    expect((await lead.post(`/cards/${card}/dev/pulls`, { number: 21 })).status).toBe(201);
    let pr = (await lead.get(`/cards/${card}/dev`)).body.pulls[0];
    expect(pr).toMatchObject({ number: 21, state: "open", checks: "pending", review: null, merged: false, manual: true });
    expect((await lead.post(`/cards/${card}/dev/pulls`, { number: 404 })).status).toBe(404);

    gh.reviews.set(21, "APPROVED");
    gh.checks.set("sha21", "success");
    gh.pull(21, { state: "closed", merged_at: gh.now() });
    await lead.post(`/boards/${s.boardId}/repo/sync`, {});
    pr = (await lead.get(`/cards/${card}/dev`)).body.pulls[0];
    expect(pr).toMatchObject({ state: "merged", merged: true, review: "approved", checks: "success" });
  });

  it("reglas de cierre: bloquean con el motivo, informan sin bloquear y se validan en el servidor", async () => {
    await lead.put(`/boards/${s.boardId}/completion-rules`, { subtasks: "block", dependencies: "block", checklists: "warn", prApproved: "block", ciPassing: "block", prMerged: "block" });
    expect((await dev.put(`/boards/${s.boardId}/completion-rules`, { subtasks: "off" })).status).toBe(403);

    const card = await newCard("Integrar pasarela");
    const sub = (await lead.post(`/cards/${card}/subtasks`, { title: "Probar en sandbox" })).body.id;
    const blocker = await newCard("Contrato firmado");
    await lead.post(`/cards/${blocker}/relations`, { toCardId: card, type: "blocks" });
    const chk = (await lead.post(`/cards/${card}/checklists`, { title: "Pasos" })).body.id;
    await lead.post(`/checklists/${chk}/items`, { text: "Documentar" });

    let r = await dev.patch(`/cards/${card}`, { completed: true });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("completion_blocked");
    expect(r.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["dependencies", "subtasks"]);
    // Sin PR vinculados, las reglas de GitHub no aplican (tareas administrativas).
    const evalr = (await dev.get(`/cards/${card}/completion`)).body;
    expect(evalr.results.map((x: { key: string }) => x.key)).not.toContain("prApproved");
    expect(evalr.results.find((x: { key: string }) => x.key === "checklists")).toMatchObject({ level: "warn", ok: false });

    await lead.patch(`/cards/${sub}`, { completed: true });
    await lead.patch(`/cards/${blocker}`, { completed: true });
    // Con un PR abierto, sin aprobar y con CI fallida, aparecen las reglas de GitHub.
    gh.pull(30);
    gh.checks.set("sha30", "failure");
    await lead.post(`/cards/${card}/dev/pulls`, { number: 30 });
    r = await dev.patch(`/cards/${card}`, { completed: true });
    expect(r.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["ciPassing", "prApproved", "prMerged"]);

    gh.reviews.set(30, "APPROVED");
    gh.checks.set("sha30", "success");
    gh.pull(30, { state: "closed", merged_at: gh.now() });
    await lead.post(`/boards/${s.boardId}/repo/sync`, {});
    r = await dev.patch(`/cards/${card}`, { completed: true }); // la checklist pendiente solo advierte
    expect(r.status).toBe(200);
    const auditLog = (await lead.get(`/orgs/${s.orgId}/audit`)).body;
    expect(JSON.stringify(auditLog)).toContain("card.completed");
  });

  it("si GitHub falla, sus reglas advierten en vez de bloquear", async () => {
    const card = await newCard("Tarea con PR sin datos");
    gh.pull(40);
    await lead.post(`/cards/${card}/dev/pulls`, { number: 40 });
    await withSystem((tx) => tx.update(boardRepos).set({ lastSyncError: "GitHub no responde" }).where(eq(boardRepos.id, boardRepoId)));
    const res = (await lead.get(`/cards/${card}/completion`)).body;
    expect(res.canComplete).toBe(true);
    expect(res.results.find((x: { key: string }) => x.key === "prApproved")).toMatchObject({ level: "warn" });
    expect(res.results.find((x: { key: string }) => x.key === "prApproved").detail).toContain("no se pudo verificar");
    await withSystem((tx) => tx.update(boardRepos).set({ lastSyncError: null }).where(eq(boardRepos.id, boardRepoId)));
  });

  it("QA aprobada no cierra la tarea si faltan otras condiciones", async () => {
    await lead.patch(`/boards/${s.boardId}`, { qaRequired: true, qaListId: s.lists[1]!.id, doneListId: s.lists[2]!.id });
    const card = await newCard("Revisar textos");
    await lead.post(`/cards/${card}/subtasks`, { title: "Pendiente" });
    const r = await lead.post(`/cards/${card}/qa`, { decision: "approve" });
    expect(r.body).toMatchObject({ status: "approved", completed: false, pending: [{ rule: "subtasks" }] });
    expect((await lead.get(`/cards/${card}`)).body.card.completedAt).toBeNull();
    await lead.patch(`/boards/${s.boardId}`, { qaRequired: false });
  });

  it("avisa una sola vez cuando falla la CI de un PR vinculado y descarta eventos viejos", async () => {
    const card = await newCard("Optimizar consultas");
    await lead.patch(`/cards/${card}`, { ownerId: dev.id });
    gh.pull(50);
    gh.checks.set("sha50", "failure");
    await lead.post(`/cards/${card}/dev/pulls`, { number: 50 });
    await lead.post(`/boards/${s.boardId}/repo/sync`, {});
    await lead.post(`/boards/${s.boardId}/repo/sync`, {});
    const fails = (await notifications(dev)).filter((n) => n.type === "ci.failed" && n.cardId === card);
    expect(fails).toHaveLength(1);

    // Un webhook con un estado más viejo que el guardado no pisa el dato.
    const [repo] = await withSystem((tx) => tx.select().from(boardRepos).where(eq(boardRepos.id, boardRepoId)));
    const secret = decrypt(repo!.webhookSecretEnc!);
    const old = { ...apiPull(gh.pulls.get(50)!), title: "Título viejo", updated_at: new Date(gh.tick - 3_600_000).toISOString() };
    const body = JSON.stringify({ action: "edited", pull_request: old });
    const hook = new Client();
    const res = await hook.req("POST", `/webhooks/github/${boardRepoId}`, undefined, {
      origin: null,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
        "x-github-delivery": "viejo-1",
        "x-github-event": "pull_request",
      },
      rawBody: body,
    });
    expect(res.status).toBe(200);
    expect((await lead.get(`/cards/${card}/dev`)).body.pulls[0].title).toBe("PR 50");
  });

  it("otra organización no puede vincular issues ni PRs de este tablero", async () => {
    const intruder = await newUser("Intruso");
    const card = await newCard("Privada");
    expect((await intruder.post(`/cards/${card}/issue/link`, { number: 10 })).status).toBe(404);
    expect((await intruder.post(`/cards/${card}/dev/pulls`, { number: 21 })).status).toBe(404);
    expect((await intruder.get(`/cards/${card}/completion`)).status).toBe(404);
  });
});
