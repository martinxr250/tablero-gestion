"use client";

import { useQuery } from "@tanstack/react-query";
import { Ban, CircleCheck, CircleX, Clock, GitPullRequest, Loader, ShieldCheck } from "lucide-react";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
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
};

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
export function InsightsView({ boardId, onOpenCard }: { boardId: string; onOpenCard: (id: string) => void }) {
  const q = useQuery({ queryKey: ["insights", boardId], queryFn: () => api<Insights>(`/boards/${boardId}/insights`), refetchInterval: 60_000 });
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!q.data) return <Skeleton className="mx-6 h-96" />;
  const d = q.data;
  const maxOpen = Math.max(1, ...d.workload.map((w) => w.open));
  const avg = duration(d.resolution.avgHours);
  const sprintPct = d.sprint && d.sprint.totalPoints ? Math.round((d.sprint.donePoints / d.sprint.totalPoints) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto px-4 pb-8 scroll-thin sm:px-6">
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
