"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, Sparkles, CircleX, Clock, GitPullRequest, Loader, ShieldCheck } from "lucide-react";
import { Button, ErrorState, Skeleton, Spinner } from "@/components/ui/primitives";
import { useAiEnabled } from "@/lib/ai";
import { Avatar } from "@/components/ui/user-avatar";
import { api } from "@/lib/api";
import { ago, fmtShort } from "@/lib/format";
import { cn } from "@/lib/utils";

type Insights = {
  workload: { userId: string; name: string; hasAvatar: boolean; open: number; points: number; overdue: number; done30d: number; avgHours: number | null }[];
  resolution: { avgHours: number | null; completed: number };
  reviews: { cardId: string; cardTitle: string; number: number; title: string; url: string; author: string | null; review: string | null; checks: string | null; updatedAt: string | null }[];
  blocked: { id: string; title: string; blockers: string[] }[];
  qa: { id: string; title: string; status: string; note: string | null }[];
  sprint: { id: string; name: string; endsOn: string; capacityPoints: number | null; totalPoints: number; donePoints: number; cards: number; cardsDone: number } | null;
  summary: { total: number; done: number; overdue: number; blocked: number; pendingDelivery: number; openReviews: number; sprintsAtRisk: number };
  health: {
    withOpenPr: number; waitingReview: number; checksFailing: number; merged: number; readyForQa: number; approved: number; completed30d: number;
    pendingDeploy: number; deploying: number; deployed: number; deployFailed: number; readyDelivery: number; blockedDelivery: number;
  };
  deploys: { id: string; title: string; status: "pending" | "in_progress" | "failed" }[];
  dependencies: { chains: { id: string; title: string; depth: number }[]; critical: { id: string; title: string; dependents: number }[]; cycles: { id: string; title: string }[] };
  sprints: { id: string; name: string; status: string; endsOn: string; level: "low" | "medium" | "high" | "insufficient"; reasons: string[]; remainingPoints: number; daysLeft: number }[];
  people: { userId: string; name: string; points: number; unestimated: number; capacity: number | null; status: "ok" | "near" | "over" | "unknown" }[];
  risks: { severity: 1 | 2 | 3; problem: string; project: string; tasks: { id: string; title: string }[]; cause: string; impact: string; action: string }[];
};

const LEVEL = {
  low: { label: "Riesgo bajo", cls: "bg-success/15 text-success" },
  medium: { label: "Riesgo medio", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200" },
  high: { label: "Riesgo alto", cls: "bg-destructive/15 text-destructive" },
  insufficient: { label: "Información insuficiente", cls: "bg-muted text-muted-foreground" },
} as const;

function CapacityInput({ boardId, person }: { boardId: string; person: Insights["people"][number] }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (points: number | null) => api(`/boards/${boardId}/capacity/${person.userId}`, { method: "PUT", body: { points } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["insights", boardId] }),
  });
  return (
    <input
      type="number"
      min={0}
      max={10000}
      step={0.5}
      placeholder="cap."
      aria-label={`Capacidad de ${person.name} (puntos por etapa)`}
      title="Capacidad por etapa (puntos)"
      defaultValue={person.capacity ?? ""}
      key={String(person.capacity)}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const v = raw === "" ? null : Number(raw);
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 10000)) {
          e.target.value = person.capacity?.toString() ?? "";
          return;
        }
        if (v !== person.capacity) save.mutate(v);
      }}
      className="h-8 w-16 rounded-full border bg-card px-2 text-center text-xs tabular-nums"
    />
  );
}

/** Duración legible: horas si es menos de dos días, si no días. */
function duration(hours: number | null) {
  if (hours === null) return { value: "—", unit: "" };
  if (hours < 48) return { value: hours.toFixed(hours < 10 ? 1 : 0).replace(".", ","), unit: "h" };
  return { value: (hours / 24).toFixed(1).replace(".", ","), unit: "días" };
}

function Kpi({ label, value, unit, tone }: { label: string; value: string | number; unit?: string; tone?: string }) {
  return (
    <div className="rounded-[2rem] border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("display-figure mt-3 text-5xl", tone)}>
        {value}
        {unit && <span className="dim text-2xl"> {unit}</span>}
      </p>
    </div>
  );
}

/** Panel del líder: carga por persona, revisiones de código, bloqueos, calidad y tiempos. */
export function InsightsView({ boardId, canManage, canEdit, onOpenCard }: { boardId: string; canManage: boolean; canEdit: boolean; onOpenCard: (id: string) => void }) {
  const q = useQuery({ queryKey: ["insights", boardId], queryFn: () => api<Insights>(`/boards/${boardId}/insights`), refetchInterval: 60_000 });
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!q.data) return <Skeleton className="mx-6 h-96" />;
  const d = q.data;
  const maxOpen = Math.max(1, ...d.workload.map((w) => w.open));
  const avg = duration(d.resolution.avgHours);
  const sprintPct = d.sprint && d.sprint.totalPoints ? Math.round((d.sprint.donePoints / d.sprint.totalPoints) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto px-4 pb-8 scroll-thin sm:px-6">
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Tareas totales" value={d.summary.total} />
        <Kpi label="Terminadas" value={d.summary.done} />
        <Kpi label="Vencidas" value={d.summary.overdue} tone={d.summary.overdue ? "text-brand" : undefined} />
        <Kpi label="Bloqueadas" value={d.summary.blocked} tone={d.summary.blocked ? "text-brand" : undefined} />
        <Kpi label="Entregas pendientes" value={d.summary.pendingDelivery} />
        <Kpi label="Revisiones de código abiertas" value={d.summary.openReviews} />
        <Kpi label="Etapas en riesgo" value={d.summary.sprintsAtRisk} tone={d.summary.sprintsAtRisk ? "text-brand" : undefined} />
      </div>

      {canEdit && <AiBriefing boardId={boardId} />}

      <section className="mb-6 rounded-[2rem] border bg-card p-6">
        <h2 className="mb-1 text-lg">Riesgos</h2>
        <p className="mb-4 text-xs text-muted-foreground">Calculados con datos reales del tablero. Son señales para decidir, no predicciones exactas.</p>
        {d.risks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No se detectaron riesgos.</p>
        ) : (
          <ol className="space-y-3">
            {d.risks.map((r, i) => (
              <li key={i} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", r.severity === 3 ? LEVEL.high.cls : r.severity === 2 ? LEVEL.medium.cls : LEVEL.low.cls)}>
                    {r.severity === 3 ? "Alta" : r.severity === 2 ? "Media" : "Baja"}
                  </span>
                  <p className="font-medium">{r.problem}</p>
                  <span className="text-xs text-muted-foreground">· {r.project}</span>
                </div>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">Causa</dt><dd>{r.cause}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Impacto</dt><dd>{r.impact}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Acción recomendada</dt><dd>{r.action}</dd></div>
                </dl>
                {r.tasks.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {r.tasks.map((t) => (
                      <li key={t.id + t.title}>
                        <button className="rounded-full bg-muted px-2.5 py-0.5 text-xs hover:text-primary" onClick={() => onOpenCard(t.id)}>
                          {t.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-4 text-lg">Salud de las entregas</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {(
              [
                ["Con PR abierto", d.health.withOpenPr],
                ["Esperando revisión", d.health.waitingReview],
                ["CI fallida", d.health.checksFailing],
                ["Código fusionado", d.health.merged],
                ["Listas para QA", d.health.readyForQa],
                ["Aprobadas", d.health.approved],
                ["Completadas (30 d)", d.health.completed30d],
                ["Pendientes de despliegue", d.health.pendingDeploy],
                ["Desplegadas", d.health.deployed],
                ["Despliegue fallido", d.health.deployFailed],
                ["Entregas listas", d.health.readyDelivery],
                ["Entregas bloqueadas", d.health.blockedDelivery],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-muted/60 p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="display-figure mt-1 text-3xl">{value}</dd>
              </div>
            ))}
          </dl>
          {d.deploys.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {d.deploys.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className={cn("w-28 shrink-0 text-xs", t.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                    {t.status === "failed" ? "Despliegue fallido" : t.status === "in_progress" ? "Desplegando" : "Sin desplegar"}
                  </span>
                  <button className="truncate text-left hover:text-primary" onClick={() => onOpenCard(t.id)}>
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Código fusionado no significa desplegado: solo cuenta como desplegado cuando hay un despliegue a producción confirmado que incluye ese código.</p>
        </section>

        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-4 text-lg">Etapas</h2>
          {d.sprints.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay etapas planificadas ni en curso.</p>
          ) : (
            <ul className="space-y-3">
              {d.sprints.map((sp) => (
                <li key={sp.id} className="rounded-2xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{sp.name}</p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", LEVEL[sp.level].cls)}>{LEVEL[sp.level].label}</span>
                    <span className="text-xs text-muted-foreground">
                      {sp.status === "active" ? "en curso" : "planificada"} · termina el {fmtShort(`${sp.endsOn}T12:00:00`)}
                    </span>
                  </div>
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {sp.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <DeploymentHistory boardId={boardId} canSync={canManage} onOpenCard={onOpenCard} />

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-1 text-lg">Carga contra capacidad</h2>
          <p className="mb-4 text-xs text-muted-foreground">Puntos asignados como responsable en la etapa en curso (o en todo el tablero si no hay). Las tareas sin estimación se muestran aparte.</p>
          <ul className="space-y-3">
            {d.people.map((p) => {
              const pct = p.capacity ? Math.min(100, (p.points / p.capacity) * 100) : 0;
              return (
                <li key={p.userId} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr_auto_auto]">
                  <span className="truncate text-sm">{p.name}</span>
                  <div className="col-span-2 h-2.5 overflow-hidden rounded-full bg-muted sm:col-span-1" aria-hidden>
                    <div className={cn("h-full rounded-full", p.status === "over" ? "bg-destructive" : p.status === "near" ? "bg-amber-500" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.points} pts{p.capacity !== null ? ` / ${p.capacity}` : " · sin capacidad"}
                    {p.unestimated ? ` · ${p.unestimated} sin estimar` : ""}
                  </span>
                  {canManage ? <CapacityInput boardId={boardId} person={p} /> : <span />}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-4 text-lg">Dependencias</h2>
          {d.dependencies.cycles.length > 0 && (
            <p className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">Hay dependencias circulares: {d.dependencies.cycles.map((c) => c.title).join(", ")}.</p>
          )}
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Tareas críticas (bloquean a 2 o más)</h3>
          <ul className="mb-4 space-y-1 text-sm">
            {d.dependencies.critical.map((c) => (
              <li key={c.id}>
                <button className="text-left hover:text-primary" onClick={() => onOpenCard(c.id)}>
                  {c.title} <span className="text-xs text-muted-foreground">· bloquea a {c.dependents}</span>
                </button>
              </li>
            ))}
            {d.dependencies.critical.length === 0 && <li className="text-muted-foreground">Ninguna.</li>}
          </ul>
          <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Bloqueos en cadena</h3>
          <ul className="space-y-1 text-sm">
            {d.dependencies.chains.map((c) => (
              <li key={c.id}>
                <button className="text-left hover:text-primary" onClick={() => onOpenCard(c.id)}>
                  {c.title} <span className="text-xs text-muted-foreground">· espera una cadena de {c.depth} tareas</span>
                </button>
              </li>
            ))}
            {d.dependencies.chains.length === 0 && <li className="text-muted-foreground">Ninguno.</li>}
          </ul>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Tiempo promedio de resolución (90 días)" value={avg.value} unit={avg.unit} />
        <Kpi label="Completadas en 90 días" value={d.resolution.completed} />
        <Kpi label="Cambios de código esperando revisión" value={d.reviews.length} />
        <Kpi label="Tareas bloqueadas" value={d.blocked.length} tone={d.blocked.length ? "text-brand" : undefined} />
        <Kpi label="En control de calidad" value={d.qa.length} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-1 text-lg">Carga por persona</h2>
          <p className="mb-5 text-xs text-muted-foreground">Tareas abiertas donde es responsable o colabora. No mide productividad individual.</p>
          <ul className="space-y-4">
            {d.workload.map((w) => {
              const avgW = duration(w.avgHours);
              return (
                <li key={w.userId} className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[auto_10rem_1fr_auto]">
                  <Avatar user={w} size={34} />
                  <span className="truncate text-sm">{w.name}</span>
                  <div className="col-span-2 h-3 overflow-hidden rounded-full bg-muted sm:col-span-1" aria-hidden>
                    <div className={cn("h-full rounded-full", w.overdue ? "bg-brand" : "bg-primary")} style={{ width: `${(w.open / maxOpen) * 100}%` }} />
                  </div>
                  <span className="col-span-2 text-xs text-muted-foreground tabular-nums sm:col-span-1 sm:text-right">
                    {w.open} abiertas · {w.points} pts{w.overdue ? ` · ${w.overdue} vencidas` : ""} · {w.done30d} hechas (30 d) · {avgW.value}
                    {avgW.unit && ` ${avgW.unit}`} prom.
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-4 text-lg">Etapa en curso</h2>
          {d.sprint ? (
            <>
              <p className="display-title text-2xl">{d.sprint.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">Termina el {fmtShort(`${d.sprint.endsOn}T12:00:00`)}</p>
              <p className="display-figure mt-5 text-6xl">
                {sprintPct}
                <span className="dim">%</span>
              </p>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${sprintPct}%` }} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {d.sprint.donePoints} de {d.sprint.totalPoints} pts · {d.sprint.cardsDone} de {d.sprint.cards} tareas
                {d.sprint.capacityPoints !== null && ` · capacidad ${d.sprint.capacityPoints} pts`}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No hay una etapa en curso.</p>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg">
            <GitPullRequest className="size-4 text-muted-foreground" /> Esperando revisión
          </h2>
          <ul className="space-y-3 text-sm">
            {d.reviews.map((r) => (
              <li key={`${r.cardId}-${r.number}`}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary">
                  #{r.number} {r.title}
                </a>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {r.checks === "failure" && <CircleX className="size-3.5 text-destructive" />}
                  {r.checks === "success" && <CircleCheck className="size-3.5 text-success" />}
                  {r.checks === "pending" && <Loader className="size-3.5" />}
                  <button className="truncate hover:underline" onClick={() => onOpenCard(r.cardId)}>
                    {r.cardTitle}
                  </button>
                  {r.updatedAt && <span className="shrink-0">· {ago(r.updatedAt)}</span>}
                </p>
              </li>
            ))}
            {d.reviews.length === 0 && <li className="text-muted-foreground">Nada esperando revisión.</li>}
          </ul>
        </section>

        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg">
            <Ban className="size-4 text-muted-foreground" /> Bloqueadas
          </h2>
          <ul className="space-y-3 text-sm">
            {d.blocked.map((b) => (
              <li key={b.id}>
                <button className="text-left font-medium hover:text-primary" onClick={() => onOpenCard(b.id)}>
                  {b.title}
                </button>
                <p className="text-xs text-muted-foreground">Espera: {b.blockers.join(", ")}</p>
              </li>
            ))}
            {d.blocked.length === 0 && <li className="text-muted-foreground">Ninguna tarea bloqueada.</li>}
          </ul>
        </section>

        <section className="rounded-[2rem] border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg">
            <ShieldCheck className="size-4 text-muted-foreground" /> Control de calidad
          </h2>
          <ul className="space-y-3 text-sm">
            {d.qa.map((t) => (
              <li key={t.id}>
                <button className="text-left font-medium hover:text-primary" onClick={() => onOpenCard(t.id)}>
                  {t.title}
                </button>
                <p className={cn("flex items-center gap-1 text-xs", t.status === "rejected" ? "text-brand" : "text-muted-foreground")}>
                  <Clock className="size-3" /> {t.status === "rejected" ? `Rechazada: ${t.note ?? ""}` : "Esperando aprobación"}
                </p>
              </li>
            ))}
            {d.qa.length === 0 && <li className="text-muted-foreground">Nada pendiente de aprobación.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

type DeployRow = {
  id: string; sha: string; ref: string | null; environment: string; envKind: string; state: string; url: string | null;
  startedAt: string | null; finishedAt: string | null; repo: string; cards: { id: string; title: string }[];
};
const DEPLOY_STATE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "bg-muted text-muted-foreground" },
  building: { label: "En construcción", cls: LEVEL.medium.cls },
  deploying: { label: "Desplegando", cls: LEVEL.medium.cls },
  deployed: { label: "Desplegado", cls: LEVEL.low.cls },
  failed: { label: "Falló", cls: LEVEL.high.cls },
  canceled: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
  unknown: { label: "Desconocido", cls: "bg-muted text-muted-foreground" },
};
const ENV_LABEL: Record<string, string> = { production: "Producción", staging: "Staging", preview: "Preview", other: "Otro" };

/** Historial de despliegues del repositorio del tablero (solo si hay alguno registrado). */
function DeploymentHistory({ boardId, canSync, onOpenCard }: { boardId: string; canSync: boolean; onOpenCard: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["deployments", boardId], queryFn: () => api<{ deployments: DeployRow[] }>(`/boards/${boardId}/deployments`) });
  const sync = useMutation({
    mutationFn: () => api<{ synced: number }>(`/boards/${boardId}/repo/deployments/sync`, { method: "POST" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["deployments", boardId] });
      qc.invalidateQueries({ queryKey: ["insights", boardId] });
    },
  });
  if (!q.data) return null;
  return (
    <section className="mb-6 rounded-[2rem] border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-lg">Despliegues</h2>
        {canSync && (
          <Button size="sm" variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
            Conciliar con GitHub
          </Button>
        )}
      </div>
      {q.data.deployments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Sin despliegues registrados. Llegan desde GitHub Deployments (por ejemplo, la integración de Vercel con GitHub) cuando el tablero tiene un repositorio vinculado.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Entorno</th>
                <th className="py-2 pr-3 font-medium">Estado</th>
                <th className="py-2 pr-3 font-medium">Commit</th>
                <th className="py-2 pr-3 font-medium">Inicio</th>
                <th className="py-2 pr-3 font-medium">Fin</th>
                <th className="py-2 font-medium">Tarjetas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.data.deployments.map((d) => {
                const st = DEPLOY_STATE[d.state] ?? DEPLOY_STATE.unknown!;
                return (
                  <tr key={d.id}>
                    <td className="py-2 pr-3">{ENV_LABEL[d.envKind] ?? d.environment}</td>
                    <td className="py-2 pr-3">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st.cls)}>{st.label}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="font-mono text-xs hover:text-primary">
                          {d.sha.slice(0, 7)}
                        </a>
                      ) : (
                        <code className="text-xs">{d.sha.slice(0, 7)}</code>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{d.startedAt ? ago(d.startedAt) : "—"}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{d.finishedAt ? ago(d.finishedAt) : "—"}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {d.cards.map((c) => (
                          <button key={c.id} className="max-w-48 truncate rounded-full bg-muted px-2 py-0.5 text-xs hover:text-primary" onClick={() => onOpenCard(c.id)}>
                            {c.title}
                          </button>
                        ))}
                        {d.cards.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Briefing = { headline: string; highlights: string[]; risks: string[]; nextActions: string[]; generatedAt: string };

/** Resumen ejecutivo redactado por IA a partir de los indicadores de este panel (no inventa datos). */
function AiBriefing({ boardId }: { boardId: string }) {
  const enabled = useAiEnabled();
  const run = useMutation({ mutationFn: () => api<Briefing>(`/boards/${boardId}/ai/briefing`, { method: "POST" }) });
  if (!enabled) return null;
  const b = run.data;
  return (
    <section className="mb-6 rounded-[2rem] border border-primary/30 bg-card p-6" aria-label="Resumen con IA">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex flex-1 items-center gap-2 text-lg">
          <Sparkles className="size-4 text-primary" /> Resumen con IA
        </h2>
        <Button size="sm" variant={b ? "secondary" : "primary"} loading={run.isPending} onClick={() => run.mutate()}>
          {b ? "Actualizar" : "Generar resumen"}
        </Button>
      </div>
      {!b && !run.isPending && (
        <p className="mt-2 text-sm text-muted-foreground">Claude redacta el estado del tablero a partir de los indicadores de este panel: sin descripciones ni comentarios, y sin inventar datos.</p>
      )}
      {run.isPending && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner className="size-4" /> Analizando los indicadores…
        </p>
      )}
      {run.error && <p className="mt-3 text-sm text-destructive">{(run.error as Error).message}</p>}
      {b && (
        <div className="mt-4 space-y-4">
          <p className="display-title text-2xl">{b.headline}</p>
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                ["Lo más importante", b.highlights],
                ["Riesgos", b.risks],
                ["Próximas acciones", b.nextActions],
              ] as const
            ).map(([title, items]) => (
              <div key={title}>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{title}</h3>
                <ul className="list-disc space-y-1 pl-4 text-sm">
                  {items.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                  {items.length === 0 && <li className="list-none text-muted-foreground">—</li>}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Generado {ago(b.generatedAt)} · revisalo antes de compartirlo.</p>
        </div>
      )}
    </section>
  );
}
