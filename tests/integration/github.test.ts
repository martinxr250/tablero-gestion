import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt } from "@/server/core/crypto";
import { withSystem } from "@/server/db/client";
import { boardRepos } from "@/server/db/schema";
import { Client, newUser, seedBoard } from "../helpers";

// GitHub simulado en memoria: responde a las rutas que usa el cliente real.
type Issue = { id: number; number: number; title: string; body: string; state: "open" | "closed"; labels: string[]; assignees: string[]; updated_at: string };
const gh = {
  issues: new Map<number, Issue>(),
  pulls: [] as Record<string, unknown>[],
  patches: 0,
  nextNumber: 1,
  tick: Date.now(),
  reset() {
    this.issues.clear();
    this.pulls = [];
    this.patches = 0;
    this.nextNumber = 1;
  },
  now() {
    this.tick = Math.max(this.tick + 1000, Date.now());
    return new Date(this.tick).toISOString();
  },
  add(title: string, state: "open" | "closed" = "open", extra: Partial<Issue> = {}) {
    const n = this.nextNumber++;
    const issue: Issue = { id: 1000 + n, number: n, title, body: "", state, labels: [], assignees: [], updated_at: this.now(), ...extra };
    this.issues.set(n, issue);
    return issue;
  },
};
const asApi = (i: Issue) => ({
  ...i,
  html_url: `https://github.com/acme/app/issues/${i.number}`,
  labels: i.labels.map((name) => ({ name })),
  assignees: i.assignees.map((login) => ({ login })),
  milestone: null,
});

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function fakeGitHub(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const method = init?.method ?? "GET";
  const path = url.pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (path === "/user") return json({ login: "octo" });
  if (path === "/repos/acme/app" && method === "GET") return json({ id: 42, full_name: "acme/app", html_url: "https://github.com/acme/app", private: true, permissions: { push: true } });
  if (path === "/repos/acme/app/issues" && method === "GET") {
    const since = url.searchParams.get("since");
    const list = [...gh.issues.values()].filter((i) => !since || i.updated_at >= since).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    return json(list.map(asApi));
  }
  if (path === "/repos/acme/app/issues" && method === "POST") {
    return json(asApi(gh.add(body.title, "open", { body: body.body ?? "", labels: body.labels ?? [], assignees: body.assignees ?? [] })), 201);
  }
  const issueMatch = path.match(/^\/repos\/acme\/app\/issues\/(\d+)$/);
  if (issueMatch) {
    const issue = gh.issues.get(Number(issueMatch[1]));
    if (!issue) return json({ message: "Not Found" }, 404);
    if (method === "PATCH") {
      gh.patches++;
      Object.assign(issue, body, { updated_at: gh.now() });
    }
    return json(asApi(issue));
  }
  if (path === "/repos/acme/app/pulls") return json(gh.pulls);
  if (/\/check-runs$/.test(path)) return json({ check_runs: [{ status: "completed", conclusion: "failure" }] });
  if (/\/reviews$/.test(path)) return json([{ state: "APPROVED" }]);
  return json({ message: `Ruta simulada inexistente: ${method} ${path}` }, 404);
}

describe("integración con GitHub", () => {
  let pm: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let boardRepoId: string;
  const card = async (title: string) => {
    const b = (await pm.get(`/boards/${s.boardId}`)).body;
    return b.cards.find((c: { title: string }) => c.title === title);
  };

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeGitHub));
    gh.reset();
    gh.add("Issue abierto existente", "open", { body: "Texto **importante**", labels: ["bug", "prioridad: alta"] });
    gh.add("Issue ya cerrado", "closed");
    pm = await newUser("PM");
    s = await seedBoard(pm);
  });
  afterAll(() => vi.unstubAllGlobals());

  it("conecta la cuenta sin exponer el token", async () => {
    const r = await pm.post(`/orgs/${s.orgId}/vcs/connections`, { provider: "github", token: "github_pat_" + "x".repeat(40) });
    expect(r.status).toBe(201);
    expect(r.body.accountLogin).toBe("octo");
    const list = await pm.get(`/orgs/${s.orgId}/vcs/connections`);
    expect(JSON.stringify(list.body)).not.toContain("github_pat_");
  });

  it("vincula el repo e importa solo los issues abiertos con etiquetas y prioridad", async () => {
    const conn = (await pm.get(`/orgs/${s.orgId}/vcs/connections`)).body.connections[0].id;
    const r = await pm.put(`/boards/${s.boardId}/repo`, { connectionId: conn, repoFullName: "acme/app" });
    expect(r.status).toBe(200);
    expect(r.body.webhook).toBe(false); // APP_URL es http: se sincroniza por sondeo
    boardRepoId = r.body.id;
    const imported = await card("Issue abierto existente");
    expect(imported).toBeTruthy();
    expect(imported.issueNumber).toBe(1);
    expect(imported.priority).toBe("high");
    expect(await card("Issue ya cerrado")).toBeUndefined();
    const detail = (await pm.get(`/cards/${imported.id}`)).body.card;
    expect(detail.description.content[0].content[1]).toMatchObject({ text: "importante", marks: [{ type: "bold" }] });
  });

  it("envía los cambios locales y no genera ecos al volver a sincronizar", async () => {
    const c = await card("Issue abierto existente");
    await pm.patch(`/cards/${c.id}`, { title: "Título editado en Tableros", priority: "urgent" });
    const remote = gh.issues.get(1)!;
    expect(remote.title).toBe("Título editado en Tableros");
    expect(remote.labels).toEqual(expect.arrayContaining(["bug", "prioridad: urgente"]));
    const patches = gh.patches;
    expect((await pm.post(`/boards/${s.boardId}/repo/sync`, {})).status).toBe(200);
    expect(gh.patches).toBe(patches);
    expect((await card("Título editado en Tableros")).title).toBe("Título editado en Tableros");
  });

  it("aplica cambios remotos", async () => {
    Object.assign(gh.issues.get(1)!, { title: "Cambiado en GitHub", updated_at: gh.now() });
    await pm.post(`/boards/${s.boardId}/repo/sync`, {});
    expect(await card("Cambiado en GitHub")).toBeTruthy();
  });

  it("detecta conflictos cuando ambos lados cambian y permite resolverlos", async () => {
    const c = await card("Cambiado en GitHub");
    await withSystem((tx) => tx.update(boardRepos).set({ settings: { autoPush: false } }).where(eq(boardRepos.id, boardRepoId)));
    await pm.patch(`/cards/${c.id}`, { title: "Versión local" });
    Object.assign(gh.issues.get(1)!, { title: "Versión remota", updated_at: gh.now() });
    await pm.post(`/boards/${s.boardId}/repo/sync`, {});
    const dev = (await pm.get(`/cards/${c.id}/dev`)).body;
    expect(dev.issue.conflict.remote.title).toBe("Versión remota");
    expect((await card("Versión local")).syncAttention).toBe(true);

    expect((await pm.post(`/cards/${c.id}/issue/resolve`, { keep: "local" })).status).toBe(200);
    expect(gh.issues.get(1)!.title).toBe("Versión local");
    expect((await pm.get(`/cards/${c.id}/dev`)).body.issue.conflict).toBeNull();
    await pm.patch(`/boards/${s.boardId}/repo/settings`, { autoPush: true, importNew: true, inboxListId: s.lists[0]!.id, doneListId: s.lists[2]!.id });
  });

  it("crea un issue desde una tarjeta", async () => {
    const id = (await pm.post(`/lists/${s.listId}/cards`, { title: "Nueva desde el tablero" })).body.id;
    const r = await pm.post(`/cards/${id}/issue`);
    expect(r.status).toBe(201);
    expect(gh.issues.get(r.body.number)!.title).toBe("Nueva desde el tablero");
    expect((await pm.post(`/cards/${id}/issue`)).status).toBe(409);
  });

  it("mover a la lista de terminado cierra el issue; cerrarlo en GitHub no completa la tarjeta", async () => {
    const c = await card("Nueva desde el tablero");
    await pm.post(`/cards/${c.id}/move`, { listId: s.lists[2]!.id, afterCardId: null });
    expect(gh.issues.get(c.issueNumber)!.state).toBe("closed");

    await pm.patch(`/boards/${s.boardId}/repo/settings`, { reviewListId: s.lists[1]!.id });
    const other = await card("Versión local");
    Object.assign(gh.issues.get(other.issueNumber)!, { state: "closed", updated_at: gh.now() });
    await pm.post(`/boards/${s.boardId}/repo/sync`, {});
    const after = await card("Versión local");
    expect(after.listId).toBe(s.lists[1]!.id);
    expect(after.completedAt).toBeNull();
  });

  it("vincula PRs que mencionan el issue con su estado de checks y revisión", async () => {
    const c = await card("Versión local");
    gh.pulls = [
      {
        id: 9, number: 7, title: `Arreglo #${c.issueNumber}`, body: "", state: "open", merged_at: null, draft: false,
        html_url: "https://github.com/acme/app/pull/7", user: { login: "dev1" }, head: { ref: "fix-login", sha: "abc123" }, updated_at: gh.now(),
      },
    ];
    await pm.post(`/boards/${s.boardId}/repo/sync`, {});
    const dev = (await pm.get(`/cards/${c.id}/dev`)).body;
    expect(dev.pulls[0]).toMatchObject({ number: 7, state: "open", checks: "failure", review: "approved", author: "dev1" });
  });

  it("valida la firma del webhook y descarta entregas repetidas", async () => {
    const [repo] = await withSystem((tx) => tx.select().from(boardRepos).where(eq(boardRepos.id, boardRepoId)));
    const secret = decrypt(repo!.webhookSecretEnc!);
    const issue = gh.add("Creado por webhook");
    const payload = JSON.stringify({ action: "opened", issue: { number: issue.number } });
    const sign = (b: string) => `sha256=${createHmac("sha256", secret).update(b).digest("hex")}`;
    const hook = new Client();
    const send = (sig: string, delivery: string) =>
      hook.req("POST", `/webhooks/github/${boardRepoId}`, undefined, {
        origin: null,
        headers: { "content-type": "application/json", "x-hub-signature-256": sig, "x-github-delivery": delivery, "x-github-event": "issues" },
        rawBody: payload,
      });
    expect((await send("sha256=deadbeef", "d-1")).status).toBe(401);
    const ok = await send(sign(payload), "d-2");
    expect(ok.status).toBe(200);
    expect(await card("Creado por webhook")).toBeTruthy();
    expect((await send(sign(payload), "d-2")).body.duplicate).toBe(true);
  });

  it("otra organización no puede ver ni tocar la integración", async () => {
    const intruder = await newUser("Intruso");
    expect((await intruder.get(`/boards/${s.boardId}/repo`)).status).toBe(404);
    expect((await intruder.get(`/orgs/${s.orgId}/vcs/connections`)).status).toBe(404);
    expect((await intruder.post(`/boards/${s.boardId}/repo/sync`, {})).status).toBe(404);
  });

  it("desvincular deja las tarjetas como locales", async () => {
    const before = (await pm.get(`/boards/${s.boardId}`)).body.cards.length;
    expect((await pm.del(`/boards/${s.boardId}/repo`)).status).toBe(204);
    const after = (await pm.get(`/boards/${s.boardId}`)).body;
    expect(after.cards.length).toBe(before);
    expect(after.cards.every((c: { issueNumber: number | null }) => c.issueNumber === null)).toBe(true);
  });
});
