import "server-only";
import { AppError } from "../core/errors";
import type { IssueInput, RemoteIssue, RemotePull, RemoteRepo, VcsClient } from "./provider";

// URL fija: no se aceptan hosts ingresados por el usuario (sin riesgo de SSRF).
export const GITHUB_API = "https://api.github.com";
const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

type GhIssue = {
  id: number; number: number; title: string; body: string | null; state: "open" | "closed"; html_url: string; updated_at: string;
  labels: (string | { name?: string })[]; assignees?: { login: string }[] | null; milestone?: { title: string } | null; pull_request?: unknown;
};
type GhPull = {
  id: number; number: number; title: string; body: string | null; state: "open" | "closed"; merged_at: string | null; draft?: boolean;
  html_url: string; user: { login: string } | null; head: { ref: string; sha: string }; updated_at: string;
};

const toIssue = (i: GhIssue): RemoteIssue => ({
  id: i.id,
  number: i.number,
  title: i.title,
  body: i.body ?? "",
  state: i.state,
  labels: i.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
  assignees: (i.assignees ?? []).map((a) => a.login),
  milestone: i.milestone?.title ?? null,
  htmlUrl: i.html_url,
  updatedAt: i.updated_at,
});

export class GitHubClient implements VcsClient {
  constructor(private token: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<{ data: T; hasMore: boolean }> {
    const res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "tableros-app",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) return { data: undefined as T, hasMore: false };
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.status === 401) throw new AppError(502, "provider_auth", "GitHub rechazó el token. Revisá que siga vigente.");
      if (res.status === 403 || res.status === 404) {
        const hint = /not accessible by personal access token/i.test(detail?.message ?? "")
          ? "Al token le falta un permiso: revisá que tenga Issues en lectura y escritura."
          : "Revisá los permisos del token.";
        throw new AppError(502, "provider_forbidden", `GitHub no permite esta operación (${res.status}: ${detail?.message ?? "sin detalle"}). ${hint}`);
      }
      if (res.status === 422) throw new AppError(502, "provider_invalid", `GitHub rechazó los datos: ${detail?.message ?? "inválidos"}`);
      throw new AppError(502, "provider_error", `GitHub respondió ${res.status}`);
    }
    const hasMore = /rel="next"/.test(res.headers.get("link") ?? "");
    return { data: (await res.json()) as T, hasMore };
  }

  private repo(fullName: string) {
    if (!REPO_RE.test(fullName)) throw new AppError(400, "bad_request", "Repositorio inválido");
    return fullName;
  }

  async viewer() {
    return { login: (await this.req<{ login: string }>("GET", "/user")).data.login };
  }

  async listRepos(page: number) {
    const r = await this.req<{ id: number; full_name: string; html_url: string; private: boolean; permissions?: { push?: boolean } }[]>(
      "GET",
      `/user/repos?per_page=100&sort=updated&page=${page}`,
    );
    return {
      repos: r.data.map((x) => ({ id: x.id, fullName: x.full_name, htmlUrl: x.html_url, private: x.private, canPush: !!x.permissions?.push })),
      hasMore: r.hasMore,
    };
  }

  async getRepo(fullName: string): Promise<RemoteRepo> {
    const x = (await this.req<{ id: number; full_name: string; html_url: string; private: boolean; permissions?: { push?: boolean } }>("GET", `/repos/${this.repo(fullName)}`)).data;
    return { id: x.id, fullName: x.full_name, htmlUrl: x.html_url, private: x.private, canPush: !!x.permissions?.push };
  }

  async listIssues(repo: string, opts: { since?: string; page: number }) {
    const since = opts.since ? `&since=${encodeURIComponent(opts.since)}` : "";
    const r = await this.req<GhIssue[]>("GET", `/repos/${this.repo(repo)}/issues?state=all&per_page=100&sort=updated&direction=asc&page=${opts.page}${since}`);
    // La API de issues también devuelve PRs: se excluyen.
    return { issues: r.data.filter((i) => !i.pull_request).map(toIssue), hasMore: r.hasMore };
  }

  async getIssue(repo: string, number: number) {
    return toIssue((await this.req<GhIssue>("GET", `/repos/${this.repo(repo)}/issues/${number}`)).data);
  }

  async createIssue(repo: string, input: { title: string } & IssueInput) {
    return toIssue((await this.req<GhIssue>("POST", `/repos/${this.repo(repo)}/issues`, input)).data);
  }

  async updateIssue(repo: string, number: number, input: IssueInput) {
    return toIssue((await this.req<GhIssue>("PATCH", `/repos/${this.repo(repo)}/issues/${number}`, input)).data);
  }

  async listPulls(repo: string, page: number) {
    const r = await this.req<GhPull[]>("GET", `/repos/${this.repo(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=50&page=${page}`);
    return { pulls: r.data.map(toPull), hasMore: r.hasMore };
  }

  async getPull(repo: string, number: number) {
    return toPull((await this.req<GhPull>("GET", `/repos/${this.repo(repo)}/pulls/${number}`)).data);
  }

  async checksStatus(repo: string, sha: string) {
    const r = await this.req<{ check_runs: { status: string; conclusion: string | null }[] }>("GET", `/repos/${this.repo(repo)}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`);
    const runs = r.data.check_runs;
    if (runs.length === 0) return null;
    if (runs.some((c) => c.status !== "completed")) return "pending" as const;
    return runs.every((c) => ["success", "neutral", "skipped"].includes(c.conclusion ?? "")) ? ("success" as const) : ("failure" as const);
  }

  async reviewStatus(repo: string, number: number) {
    const r = await this.req<{ state: string }[]>("GET", `/repos/${this.repo(repo)}/pulls/${number}/reviews?per_page=100`);
    const states = r.data.map((x) => x.state);
    if (states.length === 0) return null;
    const last = [...states].reverse().find((s) => s === "APPROVED" || s === "CHANGES_REQUESTED");
    if (last === "APPROVED") return "approved" as const;
    if (last === "CHANGES_REQUESTED") return "changes_requested" as const;
    return "commented" as const;
  }

  async createWebhook(repo: string, url: string, secret: string) {
    const r = await this.req<{ id: number }>("POST", `/repos/${this.repo(repo)}/hooks`, {
      name: "web",
      active: true,
      events: ["issues", "pull_request", "pull_request_review", "check_suite"],
      config: { url, content_type: "json", secret, insecure_ssl: "0" },
    });
    return r.data.id;
  }

  async deleteWebhook(repo: string, id: number) {
    await this.req("DELETE", `/repos/${this.repo(repo)}/hooks/${id}`);
  }
}

function toPull(p: GhPull): RemotePull {
  return {
    id: p.id,
    number: p.number,
    title: p.title,
    body: p.body ?? "",
    state: p.state,
    merged: !!p.merged_at,
    draft: !!p.draft,
    htmlUrl: p.html_url,
    author: p.user?.login ?? null,
    branch: p.head.ref,
    headSha: p.head.sha,
    updatedAt: p.updated_at,
  };
}
