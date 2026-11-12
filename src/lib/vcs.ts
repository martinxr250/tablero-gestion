/** Vocabulario de cada proveedor de código para la interfaz. */
export type VcsProvider = "github" | "gitlab";

const TERMS = {
  github: { name: "GitHub", pr: "pull request", prs: "pull requests", prShort: "PR", prsShort: "PRs", ref: "#", checks: "checks", userLabel: "Usuario de GitHub" },
  gitlab: { name: "GitLab", pr: "merge request", prs: "merge requests", prShort: "MR", prsShort: "MRs", ref: "!", checks: "pipeline", userLabel: "Usuario de GitLab" },
} as const;

export const vcs = (provider?: string | null) => TERMS[provider === "gitlab" ? "gitlab" : "github"];
