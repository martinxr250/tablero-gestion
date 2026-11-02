import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt } from "@/server/core/crypto";
import { withSystem } from "@/server/db/client";
import { boardRepos } from "@/server/db/schema";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

// GitHub simulado: PRs, despliegues (como los que crea Vercel), sus estados y comparaciones de commits.
type Pull = { number: number; title: string; state: "open" | "closed"; merged_at: string | null; merge_commit_sha: string | null; head: { ref: string; sha: string }; updated_at: string };
type Dep = { id: number; sha: string; ref: string; environment: string; production_environment?: boolean; transient_environment?: boolean; created_at: string };
const gh = {
  pulls: new Map<number, Pull>(),
  deployments: [] as Dep[],
  statuses: new Map<number, { state: string; environment_url: string; created_at: string }>(),
  compare: new Map<string, string>(),
  tick: Date.now(),
  now() {
    this.tick += 1000;
    return new Date(this.tick).toISOString();
  },
};
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
const apiPull = (p: Pull) => ({ id: 7000 + p.number, body: "", draft: false, html_url: `https://github.com/acme/web/pull/${p.number}`, user: { login: "dev" }, ...p });

function fakeGitHub(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const path = url.pathname;
  const method = init?.method ?? "GET";
  if (path === "/user") return json({ login: "octo" });
  if (path === "/repos/acme/web") return json({ id: 77, full_name: "acme/web", html_url: "https://github.com/acme/web", private: true, permissions: { push: true } });
  if (path === "/repos/acme/web/issues") return json([]);
  if (path === "/repos/acme/web/pulls") return json([...gh.pulls.values()].map(apiPull));
  let m = path.match(/^\/repos\/acme\/web\/pulls\/(\d+)$/);
  if (m) return gh.pulls.has(Number(m[1])) ? json(apiPull(gh.pulls.get(Number(m[1]))!)) : json({ message: "Not Found" }, 404);
  if (/\/reviews$/.test(path)) return json([{ state: "APPROVED" }]);
  if (/\/check-runs$/.test(path)) return json({ check_runs: [{ status: "completed", conclusion: "success" }] });
  if (path === "/repos/acme/web/deployments") return json(gh.deployments);
  m = path.match(/^\/repos\/acme\/web\/deployments\/(\d+)\/statuses$/);
  if (m) return json(gh.statuses.has(Number(m[1])) ? [gh.statuses.get(Number(m[1]))] : []);
  m = path.match(/^\/repos\/acme\/web\/compare\/([^.]+)\.\.\.(.+)$/);
  if (m) return json({ status: gh.compare.get(`${m[1]}...${m[2]}`) ?? "diverged" });
  if (/\/hooks\/\d+$/.test(path) && method === "PATCH") return json({});
  return json({ message: `Ruta simulada inexistente: ${method} ${path}` }, 404);
}

describe("detección de despliegues", () => {
  let lead: Client;
  let viewer: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let boardRepoId: string;
  let secret: string;
  let delivery = 0;
  const newCard = async (title: string) => (await lead.post(`/lists/${s.listId}/cards`, { title })).body.id as string;
  const dev = async (card: string) => (await lead.get(`/cards/${card}/dev`)).body;
  const hook = (event: string, body: object, id = `d-${++delivery}`) => {
    const raw = JSON.stringify(body);
    return new Client().req("POST", `/webhooks/github/${boardRepoId}`, undefined, {
      origin: null,
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`, "x-github-delivery": id, "x-github-event": event },
      rawBody: raw,
    });
  };
  const depEvent = (d: Dep, state: string, at = gh.now()) => ({
    action: "created",
    deployment: d,
    deployment_status: { state, environment_url: `https://web-${d.id}.vercel.app`, created_at: at },
  });

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeGitHub));
    lead = await newUser("Líder");
    viewer = await newUser("Lectora");
    s = await seedBoard(lead);
    await inviteAndAccept(lead, viewer, `/boards/${s.boardId}/invitations`, "viewer");
    await lead.post(`/orgs/${s.orgId}/vcs/connections`, { provider: "github", token: "github_pat_" + "y".repeat(40) });
    const conn = (await lead.get(`/orgs/${s.orgId}/vcs/connections`)).body.connections[0].id;
    boardRepoId = (await lead.put(`/boards/${s.boardId}/repo`, { connectionId: conn, repoFullName: "acme/web" })).body.id;
    const [repo] = await withSystem((tx) => tx.select().from(boardRepos).where(eq(boardRepos.id, boardRepoId)));
    secret = decrypt(repo!.webhookSecretEnc!);
  });
  afterAll(() => vi.unstubAllGlobals());

  it("producción: vincula solo si el commit del merge está incluido en el desplegado", async () => {
    const card = await newCard("Checkout nuevo");
    gh.pulls.set(60, { number: 60, title: "Checkout", state: "closed", merged_at: gh.now(), merge_commit_sha: "aaa0060", head: { ref: "checkout", sha: "bbb0060" }, updated_at: gh.now() });
    await lead.post(`/cards/${card}/dev/pulls`, { number: 60 });
    const unrelated = await newCard("Sin relación");
    gh.pulls.set(61, { number: 61, title: "Otro", state: "closed", merged_at: gh.now(), merge_commit_sha: "aaa0061", head: { ref: "otro", sha: "bbb0061" }, updated_at: gh.now() });
    await lead.post(`/cards/${unrelated}/dev/pulls`, { number: 61 });

    const prod: Dep = { id: 1, sha: "ccc1000", ref: "main", environment: "Production", production_environment: true, created_at: gh.now() };
    gh.compare.set("aaa0060...ccc1000", "ahead");
    gh.compare.set("aaa0061...ccc1000", "diverged");
    expect((await hook("deployment_status", depEvent(prod, "in_progress"))).status).toBe(200);
    let d = await dev(card);
    expect(d.deployments).toEqual([expect.objectContaining({ envKind: "production", state: "deploying" })]);
    expect(d.lastProductionDeployAt).toBeNull();

    await hook("deployment_status", depEvent(prod, "success"));
    d = await dev(card);
    expect(d.deployments[0]).toMatchObject({ envKind: "production", state: "deployed", url: "https://web-1.vercel.app" });
    expect(d.lastProductionDeployAt).not.toBeNull();
    expect((await dev(unrelated)).deployments).toEqual([]);
  });

  it("un preview no cuenta como producción", async () => {
    const card = await newCard("Rediseño del menú");
    gh.pulls.set(62, { number: 62, title: "Menú", state: "open", merged_at: null, merge_commit_sha: null, head: { ref: "menu", sha: "ddd0062" }, updated_at: gh.now() });
    await lead.post(`/cards/${card}/dev/pulls`, { number: 62 });
    const preview: Dep = { id: 2, sha: "ddd0062", ref: "menu", environment: "Preview", transient_environment: true, created_at: gh.now() };
    await hook("deployment_status", depEvent(preview, "success"));
    const d = await dev(card);
    expect(d.deployments).toEqual([expect.objectContaining({ envKind: "preview", state: "deployed" })]);
    expect(d.lastProductionDeployAt).toBeNull();
    const ins = (await lead.get(`/boards/${s.boardId}/insights`)).body.health;
    expect(ins.deployed).toBe(1); // solo el de producción
  });

  it("despliegue fallido: se muestra en la tarjeta y como riesgo en el panel", async () => {
    const card = await newCard("Exportar facturas");
    gh.pulls.set(63, { number: 63, title: "Facturas", state: "closed", merged_at: gh.now(), merge_commit_sha: "aaa0063", head: { ref: "fact", sha: "bbb0063" }, updated_at: gh.now() });
    await lead.post(`/cards/${card}/dev/pulls`, { number: 63 });
    const prod: Dep = { id: 3, sha: "aaa0063", ref: "main", environment: "Production", production_environment: true, created_at: gh.now() };
    await hook("deployment_status", depEvent(prod, "failure"));
    expect((await dev(card)).deployments[0]).toMatchObject({ state: "failed" });
    const ins = (await lead.get(`/boards/${s.boardId}/insights`)).body;
    expect(ins.health.deployFailed).toBe(1);
    expect(ins.risks.some((r: { problem: string }) => r.problem.includes("despliegue a producción fallido"))).toBe(true);
  });

  it("eventos duplicados y fuera de orden no pisan el estado", async () => {
    const prod: Dep = { id: 4, sha: "aaa0060", ref: "main", environment: "Production", production_environment: true, created_at: gh.now() };
    const late = gh.now();
    expect((await hook("deployment_status", depEvent(prod, "success", late), "dup-1")).status).toBe(200);
    expect((await hook("deployment_status", depEvent(prod, "success", late), "dup-1")).body.duplicate).toBe(true);
    // Un "in_progress" más viejo que llega después no vuelve atrás.
    await hook("deployment_status", depEvent(prod, "in_progress", new Date(Date.parse(late) - 60_000).toISOString()));
    const hist = (await lead.get(`/boards/${s.boardId}/deployments`)).body.deployments;
    expect(hist.find((d: { externalId: string }) => d.externalId === "4").state).toBe("deployed");
  });

  it("firma inválida: se rechaza sin guardar nada", async () => {
    const raw = JSON.stringify(depEvent({ id: 99, sha: "eee0099", ref: "main", environment: "Production", production_environment: true, created_at: gh.now() }, "success"));
    const r = await new Client().req("POST", `/webhooks/github/${boardRepoId}`, undefined, {
      origin: null,
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "0".repeat(64), "x-github-delivery": "falso", "x-github-event": "deployment_status" },
      rawBody: raw,
    });
    expect(r.status).toBe(401);
    const hist = (await lead.get(`/boards/${s.boardId}/deployments`)).body.deployments;
    expect(hist.some((d: { externalId: string }) => d.externalId === "99")).toBe(false);
  });

  it("conciliación: recupera un despliegue cuyo webhook se perdió", async () => {
    gh.deployments = [{ id: 5, sha: "aaa0063", ref: "main", environment: "Production", production_environment: true, created_at: gh.now() }];
    gh.statuses.set(5, { state: "success", environment_url: "https://web-5.vercel.app", created_at: gh.now() });
    expect((await viewer.post(`/boards/${s.boardId}/repo/deployments/sync`)).status).toBe(403);
    const r = await lead.post(`/boards/${s.boardId}/repo/deployments/sync`);
    expect(r.status).toBe(200);
    expect(r.body.synced).toBe(1);
    const hist = (await lead.get(`/boards/${s.boardId}/deployments`)).body.deployments;
    const d5 = hist.find((d: { externalId: string }) => d.externalId === "5");
    expect(d5).toMatchObject({ state: "deployed", envKind: "production", cards: [expect.objectContaining({ title: "Exportar facturas" })] });
  });

  it("otra organización no ve el historial ni puede conciliar", async () => {
    const intruder = await newUser("Intruso");
    expect((await intruder.get(`/boards/${s.boardId}/deployments`)).status).toBe(404);
    expect((await intruder.post(`/boards/${s.boardId}/repo/deployments/sync`)).status).toBe(404);
  });
});
