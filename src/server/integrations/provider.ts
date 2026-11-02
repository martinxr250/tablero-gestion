// Contrato común para proveedores de código. GitHub ya implementado; GitLab se suma con otro cliente.
export type RemoteIssue = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  milestone: string | null;
  htmlUrl: string;
  updatedAt: string;
};

export type RemotePull = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  htmlUrl: string;
  author: string | null;
  branch: string;
  headSha: string;
  /** Commit resultante del merge (solo si está fusionado). */
  mergeSha: string | null;
  updatedAt: string;
};

export type RemoteDeployment = {
  id: number;
  sha: string;
  ref: string | null;
  environment: string;
  production: boolean | null;
  transient: boolean | null;
  createdAt: string;
};

export type RemoteDeploymentStatus = { state: string; url: string | null; createdAt: string } | null;

export type RemoteRepo = { id: number; fullName: string; htmlUrl: string; private: boolean; canPush: boolean };

export type IssueInput = { title?: string; body?: string; state?: "open" | "closed"; labels?: string[]; assignees?: string[] };

export interface VcsClient {
  viewer(): Promise<{ login: string }>;
  listRepos(page: number): Promise<{ repos: RemoteRepo[]; hasMore: boolean }>;
  getRepo(fullName: string): Promise<RemoteRepo>;
  listIssues(repo: string, opts: { since?: string; page: number }): Promise<{ issues: RemoteIssue[]; hasMore: boolean }>;
  getIssue(repo: string, number: number): Promise<RemoteIssue>;
  createIssue(repo: string, input: Required<Pick<IssueInput, "title">> & IssueInput): Promise<RemoteIssue>;
  updateIssue(repo: string, number: number, input: IssueInput): Promise<RemoteIssue>;
  listPulls(repo: string, page: number): Promise<{ pulls: RemotePull[]; hasMore: boolean }>;
  getPull(repo: string, number: number): Promise<RemotePull>;
  listDeployments(repo: string, perPage: number): Promise<RemoteDeployment[]>;
  latestDeploymentStatus(repo: string, id: number): Promise<RemoteDeploymentStatus>;
  /** true si el commit `base` está incluido en `head` (comparación de GitHub). */
  commitIncluded(repo: string, base: string, head: string): Promise<boolean>;
  updateWebhookEvents(repo: string, id: number): Promise<void>;
  checksStatus(repo: string, sha: string): Promise<"success" | "failure" | "pending" | null>;
  reviewStatus(repo: string, number: number): Promise<"approved" | "changes_requested" | "commented" | null>;
  createWebhook(repo: string, url: string, secret: string): Promise<number>;
  deleteWebhook(repo: string, id: number): Promise<void>;
}

/** Referencias a issues en un PR: "#12" en título/cuerpo o rama "12-algo". */
export function referencedIssues(pull: Pick<RemotePull, "title" | "body" | "branch">): number[] {
  const nums = new Set<number>();
  for (const m of `${pull.title}\n${pull.body}`.matchAll(/(?:^|[^\w&])#(\d{1,7})\b/g)) nums.add(Number(m[1]));
  const branch = pull.branch.match(/^(?:[a-z]+\/)?(\d{1,7})[-_]/i);
  if (branch) nums.add(Number(branch[1]));
  return [...nums];
}
