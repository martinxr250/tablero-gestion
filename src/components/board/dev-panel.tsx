"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, CircleDot, CircleX, Clock, ExternalLink, GitMerge, GitPullRequest, Link2Off, Loader } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

type Dev = {
  repo: { id: string; provider: string; fullName: string } | null;
  issue: {
    number: number;
    url: string;
    state: "open" | "closed";
    syncedAt: string | null;
    pending: boolean;
    error: string | null;
    conflict: { remote: { title: string; body: string; state: string; labels: string[] }; detectedAt: string } | null;
  } | null;
  pulls: { number: number; title: string; state: string; url: string; author: string | null; branch: string | null; draft: boolean; checks: string | null; review: string | null; updatedAt: string | null }[];
};

const CHECKS: Record<string, { label: string; icon: typeof CircleCheck; cls: string }> = {
  success: { label: "Checks OK", icon: CircleCheck, cls: "text-success" },
  failure: { label: "Checks fallidos", icon: CircleX, cls: "text-destructive" },
  pending: { label: "Checks en curso", icon: Loader, cls: "text-amber-600 dark:text-amber-300" },
};
const REVIEW: Record<string, string> = { approved: "Aprobado", changes_requested: "Cambios pedidos", commented: "Con comentarios" };

/** Sección de la tarjeta con el issue vinculado y la actividad de desarrollo (solo lectura del proveedor). */
export function DevPanel({ cardId, boardId, canEdit }: { cardId: string; boardId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["card-dev", cardId], queryFn: () => api<Dev>(`/cards/${cardId}/dev`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["card-dev", cardId] });
    qc.invalidateQueries({ queryKey: ["card", cardId] });
    qc.invalidateQueries({ queryKey: ["board", boardId] });
  };
  const create = useMutation({
    mutationFn: () => api<{ number: number }>(`/cards/${cardId}/issue`, { method: "POST" }),
    onSuccess: (r) => toast.success(`Issue #${r.number} creado`),
    onSettled: refresh,
  });
  const resolve = useMutation({
    mutationFn: (keep: "local" | "remote") => api(`/cards/${cardId}/issue/resolve`, { method: "POST", body: { keep } }),
    onSuccess: () => toast.success("Conflicto resuelto"),
    onSettled: refresh,
  });
  const unlink = useMutation({ mutationFn: () => api(`/cards/${cardId}/issue`, { method: "DELETE" }), onSettled: refresh });

  const data = q.data;
  if (!data?.repo) return null;
  const { issue } = data;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <GitPullRequest className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-sm font-semibold">Desarrollo</h3>
        <span className="text-xs text-muted-foreground">{data.repo.fullName}</span>
      </div>
      {!issue ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-3 py-3 text-sm">
          <span className="text-muted-foreground">Esta tarjeta no tiene issue.</span>
          {canEdit && (
            <Button size="sm" variant="soft" loading={create.isPending} onClick={() => create.mutate()}>
              <CircleDot /> Crear issue en GitHub
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm">
            <CircleDot className={cn("size-4", issue.state === "open" ? "text-success" : "text-violet-500")} />
            <a href={issue.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-primary">
              Issue #{issue.number} <ExternalLink className="size-3.5" />
            </a>
            <Badge className={issue.state === "open" ? "bg-success/10 text-success" : "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"}>
              {issue.state === "open" ? "Abierto" : "Cerrado en GitHub"}
            </Badge>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              {issue.pending ? <Clock className="size-3.5 text-amber-500" /> : null}
              {issue.pending ? "Pendiente de envío" : issue.syncedAt ? `Sincronizado ${ago(issue.syncedAt)}` : "Sin sincronizar"}
            </span>
            {canEdit && (
              <button className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Desvincular issue" title="Desvincular (el issue no se borra)" onClick={() => confirm("¿Desvincular la tarjeta del issue? El issue sigue existiendo en GitHub.") && unlink.mutate()}>
                <Link2Off className="size-3.5" />
              </button>
            )}
          </div>
          {issue.error && <p className="text-xs text-destructive">Último error al enviar: {issue.error}</p>}
          {issue.conflict && (
            <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-200">
                <AlertTriangle className="size-4" /> La tarjeta y el issue cambiaron a la vez
              </p>
              <p className="text-amber-900/80 dark:text-amber-100/80">
                En GitHub: <strong>{issue.conflict.remote.title}</strong> ({issue.conflict.remote.state === "open" ? "abierto" : "cerrado"})
              </p>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={resolve.isPending && resolve.variables === "local"} onClick={() => resolve.mutate("local")}>
                    Quedarme con la tarjeta
                  </Button>
                  <Button size="sm" variant="secondary" loading={resolve.isPending && resolve.variables === "remote"} onClick={() => resolve.mutate("remote")}>
                    Usar lo de GitHub
                  </Button>
                </div>
              )}
            </div>
          )}
          {data.pulls.length > 0 && (
            <ul className="space-y-1.5">
              {data.pulls.map((p) => {
                const checks = p.checks ? CHECKS[p.checks] : null;
                return (
                  <li key={p.number} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                    {p.state === "merged" ? <GitMerge className="size-4 text-violet-500" /> : <GitPullRequest className={cn("size-4", p.state === "open" ? "text-success" : "text-muted-foreground")} />}
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium hover:text-primary">
                      #{p.number} {p.title}
                    </a>
                    {p.draft && <Badge className="bg-card text-muted-foreground">Borrador</Badge>}
                    {p.review && <Badge className="bg-card">{REVIEW[p.review] ?? p.review}</Badge>}
                    {checks && (
                      <span className={cn("inline-flex items-center gap-1 text-xs font-medium", checks.cls)}>
                        <checks.icon className="size-3.5" /> {checks.label}
                      </span>
                    )}
                    <span className="w-full text-xs text-muted-foreground">
                      {p.state === "merged" ? "Fusionado" : p.state === "open" ? "Abierto" : "Cerrado"} · {p.branch} {p.author && `· ${p.author}`} {p.updatedAt && `· ${ago(p.updatedAt)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {data.pulls.length === 0 && <p className="text-xs text-muted-foreground">Los PRs que mencionen #{issue.number} (en el título, la descripción o la rama) aparecen acá.</p>}
        </div>
      )}
    </section>
  );
}
