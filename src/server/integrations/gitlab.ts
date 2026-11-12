import "server-only";
import { AppError } from "../core/errors";
import type { IssueInput, RemoteDeployment, RemoteIssue, RemotePull, RemotePullFile, RemoteRepo, VcsClient } from "./provider";

// Cliente de GitLab (API v4). Traduce todo al vocabulario común del proveedor (el mismo que usa
// GitHub): así la sincronización, las reglas de cierre, los despliegues y la IA no cambian.
// Los proyectos privados funcionan con un token que tenga acceso a ellos (alcance "api").

export const GITLAB_API = "https://gitlab.com/api/v4";
/** "grupo/subgrupo/proyecto": GitLab admite varios niveles de subgrupos. */
const PROJECT_RE = /^[\w.-]{1,255}(\/[\w.-]{1,255}){1,20}$/;
/** Developer o más: puede crear y editar issues. */
const DEVELOPER = 30;

type GlIssue = {
  id: number; iid: number; title: string; description: string | null; state: "opened" | "closed"; web_url: string; updated_at: string;
  labels: string[]; assignees?: { username: string }[] | null; milestone?: { title: string } | null;
};
type GlMr = {
  id: number; iid: number; title: string; description: string | null; state: "opened" | "closed" | "merged" | "locked"; draft?: boolean;
  work_in_progress?: boolean; web_url: string; author: { username: string } | null; source_branch: string; sha: string; updated_at: string;
  merge_commit_sha?: string | null; squash_commit_sha?: string | null;
};
type GlProject = {
  id: number; path_with_namespace: string; web_url: string; visibility: "private" | "internal" | "public";
  permissions?: { project_access?: { access_level: number } | null; group_access?: { access_level: number } | null } | null;
};
type GlDeployment = {
  id: number; sha: string; ref: string | null; status: string; created_at: string; updated_at: string;
  environment: { name: string; tier?: string | null; external_url?: string | null };
};
type GlDiff = { old_path: string; new_path: string; new_file: boolean; renamed_file: boolean; deleted_file: boolean; diff: string; too_large?: boolean; collapsed?: boolean };

const HOOK_EVENTS = { issues_events: true, merge_requests_events: true, pipeline_events: true, deployment_events: true, push_events: false, enable_ssl_verification: true };

const toIssue = (i: GlIssue): RemoteIssue => ({
  id: i.id,
  number: i.iid,
  title: i.title,
  body: i.description ?? "",
  state: i.state === "opened" ? "open" : "closed",
  labels: i.labels ?? [],
  assignees: (i.assignees ?? []).map((a) => a.username),
  milestone: i.milestone?.title ?? null,
  htmlUrl: i.web_url,
  updatedAt: i.updated_at,
});

function toPull(m: GlMr): RemotePull {
  const merged = m.state === "merged";
  return {
    id: m.id,
    number: m.iid,
    title: m.title,
    body: m.description ?? "",
    state: m.state === "opened" ? "open" : "closed",
    merged,
    draft: !!(m.draft ?? m.work_in_progress),
    htmlUrl: m.web_url,
    author: m.author?.username ?? null,
    branch: m.source_branch,
    headSha: m.sha,
    // Fast-forward: no hay commit de merge y el propio commit queda en la rama destino.
    mergeSha: merged ? (m.merge_commit_sha ?? m.squash_commit_sha ?? m.sha) : null,
    updatedAt: m.updated_at,
  };
}

/** Estado de despliegue de GitLab en el vocabulario común (ver normalizeDeployState). */
export function gitlabDeployState(status: string): string {
  switch (status) {
    case "created":
    case "blocked":
      return "queued";
    case "running":
      return "in_progress";
    case "success":
      return "success";
    case "failed":
      return "failure";
    case "canceled":
    case "skipped":
      return "canceled";
    default:
      return status;
  }
}

/** Tipo de entorno a partir del "tier" de GitLab (más confiable que el nombre). */
export function gitlabEnvKind(tier: string | null | undefined): RemoteDeployment["kind"] {
  switch (tier) {
    case "production":
      return "production";
    case "staging":
      return "staging";
    case "development":
    case "testing":
      return "preview";
    case "other":
      return "other";
    default:
      return undefined;
  }
}

/** Resultado del pipeline más reciente de un commit, en el vocabulario de checks. */
export function gitlabPipelineStatus(status: string | undefined): "success" | "failure" | "pending" | null {
  if (!status) return null;
  if (status === "success" || status === "skipped") return "success";
  if (status === "failed" || status === "canceled") return "failure";
  return "pending"; // created, waiting_for_resource, preparing, pending, running, manual, scheduled
}

/** Cuenta líneas agregadas y quitadas de un diff unificado. */
function countLines(diff: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

export class GitLabClient implements VcsClient {
  private userIds = new Map<string, number | null>();
  private me: { id: number; login: string } | null = null;

  constructor(
    private token: string,
    private base: string = GITLAB_API,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<{ data: T; hasMore: boolean }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        "PRIVATE-TOKEN": this.token,
        Accept: "application/json",
        "User-Agent": "tableros-app",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // Nunca seguir redirecciones: el token no debe viajar a otro host.
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) return { data: undefined as T, hasMore: false };
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { message?: unknown; error?: string; error_description?: string } | null;
      const msg = typeof detail?.message === "string" ? detail.message : detail?.error_description ?? detail?.error ?? JSON.stringify(detail?.message ?? "sin detalle");
      if (res.status === 401) throw new AppError(502, "provider_auth", "GitLab rechazó el token. Revisá que siga vigente.");
      if (res.status === 403) {
        const hint = /insufficient_scope|scope/i.test(msg) ? "Al token le falta el alcance «api»." : "El token no tiene el rol necesario (hace falta Developer o más; para webhooks, Maintainer).";
        throw new AppError(502, "provider_forbidden", `GitLab no permite esta operación (403: ${msg}). ${hint}`);
      }
      if (res.status === 404) {
        throw new AppError(502, "provider_forbidden", "GitLab no encontró el recurso. Si el proyecto es privado, revisá que el token tenga acceso a él (GitLab muestra los proyectos sin acceso como inexistentes).");
      }
      if (res.status === 400 || res.status === 422) throw new AppError(502, "provider_invalid", `GitLab rechazó los datos: ${msg}`);
      if (res.status === 429) throw new AppError(429, "provider_busy", "GitLab limitó las consultas. Probá de nuevo en un momento.");
      throw new AppError(502, "provider_error", `GitLab respondió ${res.status}`);
    }
    const hasMore = !!res.headers.get("x-next-page") || /rel="next"/.test(res.headers.get("link") ?? "");
    return { data: (await res.json()) as T, hasMore };
  }

  /** Proyecto como parámetro de la URL (ruta completa codificada). */
  private project(fullName: string) {
    if (!PROJECT_RE.test(fullName)) throw new AppError(400, "bad_request", "Proyecto inválido");
    return `/projects/${encodeURIComponent(fullName)}`;
  }

  private async whoami() {
    if (!this.me) {
      const u = (await this.req<{ id: number; username: string }>("GET", "/user")).data;
      this.me = { id: u.id, login: u.username };
    }
    return this.me;
  }

  /** Usuarios de GitLab: la API asigna por id, la app guarda nombres de usuario. */
  private async userIdsFor(usernames: string[]) {
    const ids: number[] = [];
    for (const name of usernames) {
      if (!this.userIds.has(name)) {
        const r = await this.req<{ id: number; username: string }[]>("GET", `/users?username=${encodeURIComponent(name)}`);
        this.userIds.set(name, r.data.find((u) => u.username.toLowerCase() === name.toLowerCase())?.id ?? null);
      }
      const id = this.userIds.get(name);
      if (id) ids.push(id);
    }
    return ids;
  }

  private issueBody(input: IssueInput) {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.body !== undefined) body.description = input.body;
    if (input.labels !== undefined) body.labels = input.labels.map((l) => l.replace(/,/g, " ")).join(",");
    if (input.state !== undefined) body.state_event = input.state === "closed" ? "close" : "reopen";
    return body;
  }

  async viewer() {
    return { login: (await this.whoami()).login };
  }

  async listRepos(page: number) {
    // Solo proyectos donde puede trabajar (Developer o más), incluidos los privados.
    const r = await this.req<GlProject[]>("GET", `/projects?membership=true&min_access_level=${DEVELOPER}&archived=false&order_by=last_activity_at&per_page=100&page=${page}`);
    return {
      repos: r.data.map((p) => ({ id: p.id, fullName: p.path_with_namespace, htmlUrl: p.web_url, private: p.visibility !== "public", canPush: true })),
      hasMore: r.hasMore,
    };
  }

  async getRepo(fullName: string): Promise<RemoteRepo> {
    const p = (await this.req<GlProject>("GET", this.project(fullName))).data;
    let level = Math.max(p.permissions?.project_access?.access_level ?? 0, p.permissions?.group_access?.access_level ?? 0);
    if (level === 0) {
      // Acceso heredado de un grupo superior (o token de proyecto): se consulta la membresía efectiva.
      const me = await this.whoami();
      level = await this.req<{ access_level: number }>("GET", `/projects/${p.id}/members/all/${me.id}`)
        .then((r) => r.data.access_level)
        .catch(() => 0);
    }
    return { id: p.id, fullName: p.path_with_namespace, htmlUrl: p.web_url, private: p.visibility !== "public", canPush: level >= DEVELOPER };
  }

  async listIssues(repo: string, opts: { since?: string; page: number }) {
    const since = opts.since ? `&updated_after=${encodeURIComponent(opts.since)}` : "";
    const r = await this.req<GlIssue[]>("GET", `${this.project(repo)}/issues?state=all&per_page=100&order_by=updated_at&sort=asc&page=${opts.page}${since}`);
    return { issues: r.data.map(toIssue), hasMore: r.hasMore };
  }

  async getIssue(repo: string, number: number) {
    return toIssue((await this.req<GlIssue>("GET", `${this.project(repo)}/issues/${number}`)).data);
  }

  async createIssue(repo: string, input: { title: string } & IssueInput) {
    const body = this.issueBody({ ...input, state: undefined });
    if (input.assignees?.length) body.assignee_ids = await this.userIdsFor(input.assignees);
    let issue = (await this.req<GlIssue>("POST", `${this.project(repo)}/issues`, body)).data;
    if (input.state === "closed") issue = (await this.req<GlIssue>("PUT", `${this.project(repo)}/issues/${issue.iid}`, { state_event: "close" })).data;
    return toIssue(issue);
  }

  async updateIssue(repo: string, number: number, input: IssueInput) {
    const body = this.issueBody(input);
    if (input.assignees !== undefined) body.assignee_ids = await this.userIdsFor(input.assignees);
    return toIssue((await this.req<GlIssue>("PUT", `${this.project(repo)}/issues/${number}`, body)).data);
  }

  async listPulls(repo: string, page: number) {
    const r = await this.req<GlMr[]>("GET", `${this.project(repo)}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=50&page=${page}`);
    return { pulls: r.data.map(toPull), hasMore: r.hasMore };
  }

  async getPull(repo: string, number: number) {
    return toPull((await this.req<GlMr>("GET", `${this.project(repo)}/merge_requests/${number}`)).data);
  }

  async getPullFiles(repo: string, number: number, max: number) {
    const files: RemotePullFile[] = [];
    const add = (d: GlDiff) => {
      const patch = d.too_large || d.collapsed || !d.diff ? null : d.diff;
      files.push({
        path: d.new_path,
        status: d.new_file ? "added" : d.deleted_file ? "removed" : d.renamed_file ? "renamed" : "modified",
        ...(patch ? countLines(patch) : { additions: 0, deletions: 0 }),
        patch,
      });
    };
    let hasMore = true;
    try {
      for (let page = 1; hasMore && files.length < max; page++) {
        const r = await this.req<GlDiff[]>("GET", `${this.project(repo)}/merge_requests/${number}/diffs?per_page=100&page=${page}`);
        r.data.forEach(add);
        hasMore = r.hasMore;
      }
    } catch (err) {
      // Servidores anteriores a 15.7 no tienen /diffs: se usa /changes (sin paginación).
      if (files.length > 0) throw err;
      const r = await this.req<{ changes: GlDiff[] }>("GET", `${this.project(repo)}/merge_requests/${number}/changes`);
      r.data.changes.forEach(add);
      hasMore = false;
    }
    return { files: files.slice(0, max), hasMore: hasMore || files.length > max };
  }

  async checksStatus(repo: string, sha: string) {
    const r = await this.req<{ status: string }[]>("GET", `${this.project(repo)}/pipelines?sha=${encodeURIComponent(sha)}&order_by=id&sort=desc&per_page=1`);
    return gitlabPipelineStatus(r.data[0]?.status);
  }

  async reviewStatus(repo: string, number: number) {
    // Revisores con estado (GitLab 16+): "cambios pedidos" pesa más que una aprobación anterior.
    const reviewers = await this.req<{ state: string }[]>("GET", `${this.project(repo)}/merge_requests/${number}/reviewers`)
      .then((r) => r.data.map((x) => x.state))
      .catch(() => [] as string[]);
    if (reviewers.includes("requested_changes")) return "changes_requested" as const;
    const approvals = await this.req<{ approved_by?: unknown[] }>("GET", `${this.project(repo)}/merge_requests/${number}/approvals`).catch(() => null);
    if ((approvals?.data.approved_by?.length ?? 0) > 0 || reviewers.includes("approved")) return "approved" as const;
    if (reviewers.includes("reviewed")) return "commented" as const;
    return null;
  }

  async createWebhook(repo: string, url: string, secret: string) {
    const r = await this.req<{ id: number }>("POST", `${this.project(repo)}/hooks`, { url, token: secret, ...HOOK_EVENTS });
    return r.data.id;
  }

  async updateWebhookEvents(repo: string, id: number) {
    await this.req("PUT", `${this.project(repo)}/hooks/${id}`, HOOK_EVENTS);
  }

  async deleteWebhook(repo: string, id: number) {
    await this.req("DELETE", `${this.project(repo)}/hooks/${id}`);
  }

  async listDeployments(repo: string, perPage: number) {
    const r = await this.req<GlDeployment[]>("GET", `${this.project(repo)}/deployments?order_by=created_at&sort=desc&per_page=${Math.min(100, perPage)}`);
    return r.data.map((d) => {
      const kind = gitlabEnvKind(d.environment.tier);
      return {
        id: d.id,
        sha: d.sha,
        ref: d.ref,
        environment: d.environment.name,
        production: kind ? kind === "production" : null,
        transient: kind ? kind === "preview" : null,
        kind,
        createdAt: d.created_at,
      };
    });
  }

  async latestDeploymentStatus(repo: string, id: number) {
    const d = (await this.req<GlDeployment>("GET", `${this.project(repo)}/deployments/${id}`)).data;
    return { state: gitlabDeployState(d.status), url: d.environment.external_url ?? null, createdAt: d.updated_at };
  }

  async commitIncluded(repo: string, base: string, head: string) {
    if (base === head) return true;
    const r = await this.req<{ id: string }>("GET", `${this.project(repo)}/repository/merge_base?refs[]=${encodeURIComponent(base)}&refs[]=${encodeURIComponent(head)}`);
    return r.data.id === base || r.data.id.startsWith(base);
  }
}
