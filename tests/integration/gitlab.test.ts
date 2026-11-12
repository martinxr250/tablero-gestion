import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decrypt } from "@/server/core/crypto";
import { withSystem } from "@/server/db/client";
import { boardRepos } from "@/server/db/schema";
import { gitlabApiBase } from "@/server/integrations/sync";
import { Client, newUser, seedBoard } from "../helpers";

// GitLab simulado: un proyecto privado en un subgrupo. Sin el token correcto responde 401, y los
// proyectos sin acceso responden 404 (como hace GitLab con los privados).
const TOKEN = "glpat-" + "x".repeat(30);
const PROJECT = "acme/backend/app";
const ENC = encodeURIComponent(PROJECT);
type Issue = { id: number; iid: number; title: string; description: string; state: "opened" | "closed"; labels: string[]; assignees: { username: string }[]; updated_at: string };
const gl = {
  issues: new Map<number, Issue>(),
  mrs: [] as Record<string, unknown>[],
  pipelines: new Map<string, string>(),
  approvals: new Map<number, string[]>(),
  deployments: [] as Record<string, unknown>[],
  users: new Map([["ana.dev", 501]]),
  puts: [] as Record<string, unknown>[],
  next: 1,
  tick: Date.now(),
  now() {
    this.tick += 1000;
    return new Date(this.tick).toISOString();
  },
  add(title: string, extra: Partial<Issue> = {}) {
    const iid = this.next++;
    const i: Issue = { id: 7000 + iid, iid, title, description: "", state: "opened", labels: [], assignees: [], updated_at: this.now(), ...extra };
    this.issues.set(iid, i);
    return i;
  },
};
const api = (i: Issue) => ({ ...i, web_url: `https://gitlab.com/${PROJECT}/-/issues/${i.iid}`, milestone: null });
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "x-next-page": "", ...headers } });

function applyIssue(i: Issue, body: Record<string, unknown>) {
  if (typeof body.title === "string") i.title = body.title;
  if (typeof body.description === "string") i.description = body.description;
  if (typeof body.labels === "string") i.labels = body.labels.split(",").filter(Boolean);
  if (body.state_event === "close") i.state = "closed";
  if (body.state_event === "reopen") i.state = "opened";
  if (Array.isArray(body.assignee_ids)) {
    const byId = new Map([...gl.users].map(([u, id]) => [id, u]));
    i.assignees = (body.assignee_ids as number[]).map((id) => ({ username: byId.get(id)! }));
  }
  i.updated_at = gl.now();
}

function fakeGitLab(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(typeof input === "string" ? input : input.toString());
  if (url.host !== "gitlab.com") return json({ message: `Host inesperado: ${url.host}` }, 500);
  const headers = new Headers(init?.headers);
  if (headers.get("private-token") !== TOKEN) return json({ message: "401 Unauthorized" }, 401);
  const method = init?.method ?? "GET";
  const path = url.pathname.replace(/^\/api\/v4/, "");
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const P = `/projects/${ENC}`;

  if (path === "/user") return json({ id: 900, username: "octo-gl" });
  if (path === "/users") {
    const name = url.searchParams.get("username")!;
    return json(gl.users.has(name) ? [{ id: gl.users.get(name), username: name }] : []);
  }
  if (path === "/projects") return json([{ id: 77, path_with_namespace: PROJECT, web_url: `https://gitlab.com/${PROJECT}`, visibility: "private" }]);
  // Acceso heredado del grupo: el proyecto no informa permisos y se consulta la membresía efectiva.
  if (path === P) return json({ id: 77, path_with_namespace: PROJECT, web_url: `https://gitlab.com/${PROJECT}`, visibility: "private", permissions: { project_access: null, group_access: null } });
  if (path === "/projects/77/members/all/900") return json({ access_level: 30 });
  if (path === `${P}/issues` && method === "GET") {
    const after = url.searchParams.get("updated_after");
    return json([...gl.issues.values()].filter((i) => !after || i.updated_at >= after).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map(api));
  }
  if (path === `${P}/issues` && method === "POST") {
    const i = gl.add(String(body.title));
    applyIssue(i, body);
    return json(api(i), 201);
  }
  let m = path.match(new RegExp(`^${P.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/issues/(\\d+)$`));
  if (m) {
    const i = gl.issues.get(Number(m[1]));
    if (!i) return json({ message: "404 Not found" }, 404);
    if (method === "PUT") {
      gl.puts.push(body);
      applyIssue(i, body);
    }
    return json(api(i));
  }
  if (path === `${P}/merge_requests`) return json(gl.mrs);
  m = path.match(/\/merge_requests\/(\d+)(\/\w+)?$/);
  if (m && path.startsWith(P)) {
    const mr = gl.mrs.find((x) => x.iid === Number(m![1]));
    if (!mr) return json({ message: "404 Not found" }, 404);
    if (m[2] === "/approvals") return json({ approved_by: (gl.approvals.get(Number(m[1])) ?? []).map((u) => ({ user: { username: u } })) });
    if (m[2] === "/reviewers") return json([]);
    return json(mr);
  }
  if (path === `${P}/pipelines`) {
    const st = gl.pipelines.get(url.searchParams.get("sha")!);
    return json(st ? [{ status: st }] : []);
  }
  if (path === `${P}/deployments`) return json(gl.deployments);
  m = path.match(/\/deployments\/(\d+)$/);
  if (m) return json(gl.deployments.find((d) => d.id === Number(m![1])) ?? { message: "404" }, gl.deployments.some((d) => d.id === Number(m![1])) ? 200 : 404);
  return json({ message: "404 Project Not Found" }, 404);
}

describe("integración con GitLab (proyecto privado)", () => {
  let pm: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let boardRepoId: string;
  const card = async (title: string) => (await pm.get(`/boards/${s.boardId}`)).body.cards.find((c: { title: string }) => c.title === title);

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeGitLab));
    gl.add("Login con SSO", { description: "Texto **importante**", labels: ["backend", "prioridad: alta"] });
    gl.add("Ya resuelto", { state: "closed" });
    pm = await newUser("PM");
    s = await seedBoard(pm);
  });
  afterAll(() => vi.unstubAllGlobals());

  it("solo habla con gitlab.com o con hosts habilitados, siempre por HTTPS", async () => {
    expect(gitlabApiBase()).toBe("https://gitlab.com/api/v4");
    expect(gitlabApiBase("gitlab.com")).toBe("https://gitlab.com/api/v4");
    expect(() => gitlabApiBase("http://gitlab.com")).toThrow();
    expect(() => gitlabApiBase("https://169.254.169.254")).toThrow();
    expect(() => gitlabApiBase("https://gitlab.com:8443")).toThrow();
    const r = await pm.post(`/orgs/${s.orgId}/vcs/connections`, { provider: "gitlab", token: TOKEN, baseUrl: "https://gitlab.interno.local" });
    expect(r.status).toBe(400);
  });

  it("conecta la cuenta sin exponer el token y rechaza tokens inválidos", async () => {
    expect((await pm.post(`/orgs/${s.orgId}/vcs/connections`, { provider: "gitlab", token: "glpat-" + "y".repeat(30) })).status).toBe(502);
    const r = await pm.post(`/orgs/${s.orgId}/vcs/connections`, { provider: "gitlab", token: TOKEN });
    expect(r.status).toBe(201);
    expect(r.body.accountLogin).toBe("octo-gl");
    const list = await pm.get(`/orgs/${s.orgId}/vcs/connections`);
    expect(list.body.connections[0]).toMatchObject({ provider: "gitlab", apiBaseUrl: "https://gitlab.com/api/v4" });
    expect(JSON.stringify(list.body)).not.toContain("glpat-");
  });

  it("lista el proyecto privado y lo vincula con acceso heredado del grupo", async () => {
    const conn = (await pm.get(`/orgs/${s.orgId}/vcs/connections`)).body.connections[0].id;
    const repos = (await pm.get(`/vcs/connections/${conn}/repos`)).body.repos;
    expect(repos).toEqual([expect.objectContaining({ fullName: PROJECT, private: true, canPush: true })]);
    // Un proyecto privado sin acceso: GitLab responde 404 y el mensaje lo explica.
    const denied = await pm.put(`/boards/${s.boardId}/repo`, { connectionId: conn, repoFullName: "acme/secreto" });
    expect(denied.status).toBe(502);
    expect(denied.body.error.message).toContain("privado");

    const r = await pm.put(`/boards/${s.boardId}/repo`, { connectionId: conn, repoFullName: PROJECT });
    expect(r.status).toBe(200);
    boardRepoId = r.body.id;
    const imported = await card("Login con SSO");
    expect(imported).toMatchObject({ issueNumber: 1, priority: "high" });
    expect(await card("Ya resuelto")).toBeUndefined();
    const detail = (await pm.get(`/cards/${imported.id}`)).body.card;
    expect(detail.description.content[0].content[1]).toMatchObject({ text: "importante", marks: [{ type: "bold" }] });
  });

  it("envía título, etiquetas y responsable con los formatos de GitLab", async () => {
    await pm.put(`/orgs/${s.orgId}/vcs/users/${pm.id}`, { provider: "gitlab", login: "ana.dev" });
    const c = await card("Login con SSO");
    await pm.patch(`/cards/${c.id}`, { title: "Login con SSO y 2FA", priority: "urgent", ownerId: pm.id });
    const remote = gl.issues.get(1)!;
    expect(remote.title).toBe("Login con SSO y 2FA");
    expect(remote.labels).toEqual(expect.arrayContaining(["backend", "prioridad: urgente"]));
    expect(remote.assignees).toEqual([{ username: "ana.dev" }]);
    expect(typeof gl.puts.at(-1)!.labels).toBe("string"); // GitLab recibe las etiquetas separadas por coma
  });

  it("mover a terminado cierra el issue con state_event", async () => {
    const c = await card("Login con SSO y 2FA");
    await pm.post(`/cards/${c.id}/move`, { listId: s.lists[2]!.id, afterCardId: null });
    expect(gl.issues.get(1)!.state).toBe("closed");
    expect(gl.puts.some((p) => p.state_event === "close")).toBe(true);
  });

  it("vincula merge requests que cierran el issue, con pipeline y aprobación", async () => {
    const issue = gl.add("Exportar a PDF");
    await pm.post(`/boards/${s.boardId}/repo/sync`, {});
    gl.mrs = [
      {
        id: 4001, iid: 12, title: "Exportación a PDF", description: `Closes #${issue.iid}`, state: "opened", draft: false,
        web_url: `https://gitlab.com/${PROJECT}/-/merge_requests/12`, author: { username: "dev1" }, source_branch: `${issue.iid}-exportar-pdf`,
        sha: "f00d123", updated_at: gl.now(), merge_commit_sha: null,
      },
    ];
    gl.pipelines.set("f00d123", "failed");
    gl.approvals.set(12, ["lead"]);
    await pm.post(`/boards/${s.boardId}/repo/sync`, {});
    const c = await card("Exportar a PDF");
    const dev = (await pm.get(`/cards/${c.id}/dev`)).body;
    expect(dev.repo.provider).toBe("gitlab");
    expect(dev.pulls[0]).toMatchObject({ number: 12, state: "open", checks: "failure", review: "approved", author: "dev1", branch: `${issue.iid}-exportar-pdf` });
  });

  it("webhook: valida el token secreto, deduplica y no se confunde con el de GitHub", async () => {
    const [repo] = await withSystem((tx) => tx.select().from(boardRepos).where(eq(boardRepos.id, boardRepoId)));
    const secret = decrypt(repo!.webhookSecretEnc!);
    const created = gl.add("Creado en GitLab");
    const payload = JSON.stringify({ object_kind: "issue", object_attributes: { iid: created.iid, action: "open" } });
    const hook = new Client();
    const send = (token: string, uuid: string, path = "gitlab") =>
      hook.req("POST", `/webhooks/${path}/${boardRepoId}`, undefined, {
        origin: null,
        headers: { "content-type": "application/json", "x-gitlab-token": token, "x-gitlab-event": "Issue Hook", "x-gitlab-event-uuid": uuid },
        rawBody: payload,
      });
    expect((await send("otro-secreto", "u-1")).status).toBe(401);
    expect((await send(secret, "u-1", "github")).status).toBe(401);
    expect((await send(secret, "u-2")).status).toBe(200);
    expect(await card("Creado en GitLab")).toBeTruthy();
    expect((await send(secret, "u-2")).body.duplicate).toBe(true);
  });

  it("webhook de despliegue: usa el tier de GitLab para el tipo de entorno", async () => {
    const [repo] = await withSystem((tx) => tx.select().from(boardRepos).where(eq(boardRepos.id, boardRepoId)));
    gl.deployments = [
      { id: 31, sha: "f00d123aaa", ref: "main", status: "success", created_at: gl.now(), updated_at: gl.now(), environment: { name: "live", tier: "production", external_url: "https://app.acme.test" } },
    ];
    const hook = new Client();
    const r = await hook.req("POST", `/webhooks/gitlab/${boardRepoId}`, undefined, {
      origin: null,
      headers: { "content-type": "application/json", "x-gitlab-token": decrypt(repo!.webhookSecretEnc!), "x-gitlab-event": "Deployment Hook", "x-gitlab-event-uuid": "u-dep" },
      rawBody: JSON.stringify({ object_kind: "deployment", deployment_id: 31, status: "success", environment: "live", environment_external_url: "https://app.acme.test", status_changed_at: gl.now() }),
    });
    expect(r.status).toBe(200);
    const deps = (await pm.get(`/boards/${s.boardId}/deployments`)).body.deployments;
    expect(deps[0]).toMatchObject({ environment: "live", envKind: "production", state: "deployed", url: "https://app.acme.test" });
  });

  it("las cuentas de miembros se guardan por proveedor", async () => {
    await pm.put(`/orgs/${s.orgId}/vcs/users/${pm.id}`, { provider: "github", login: "ana-gh" });
    const gh = (await pm.get(`/orgs/${s.orgId}/vcs/users?provider=github`)).body.members.find((m: { userId: string }) => m.userId === pm.id);
    const glab = (await pm.get(`/orgs/${s.orgId}/vcs/users?provider=gitlab`)).body.members.find((m: { userId: string }) => m.userId === pm.id);
    expect(gh.login).toBe("ana-gh");
    expect(glab.login).toBe("ana.dev");
    expect((await pm.put(`/orgs/${s.orgId}/vcs/users/${pm.id}`, { provider: "github", login: "ana.dev" })).status).toBe(400);
  });
});
