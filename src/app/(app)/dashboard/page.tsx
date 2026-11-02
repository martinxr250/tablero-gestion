"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarDays, CheckCircle2, Flame, Plus, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { usePrefetchBoard } from "@/lib/prefetch";
import { useState, type ReactNode } from "react";
import { useOrg } from "@/components/shell/org-context";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/user-avatar";
import { describeActivity } from "@/lib/activity";
import { api } from "@/lib/api";
import { PRIORITY } from "@/lib/colors";
import { ago, dueState, fmtShort } from "@/lib/format";
import { cn } from "@/lib/utils";

type Dashboard = {
  stats: { pending: number; overdue: number; completed: number; dueSoon: number };
  myTasks: { id: string; title: string; boardId: string; boardName: string; listName: string; priority: string; dueAt: string | null }[];
  boards: { id: string; name: string; color: string; openCards: number; lastActivity: string | null }[];
  activity: { id: number; action: string; boardId: string; boardName: string; cardId: string | null; actorName: string | null; data: Record<string, unknown>; createdAt: string }[];
  weekly: { week: string; completed: number; created: number }[];
};

// Franjas de la barra de tableros: misma paleta violeta/rosa con ámbar y un tramo rayado.
const SEGMENTS = [
  "bg-primary text-primary-foreground",
  "bg-chart-2 text-primary-foreground",
  "hatched bg-muted text-foreground",
  "bg-brand text-brand-foreground",
];

function InfoChip({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: ReactNode }) {
  return (
    <div className="pill-chip">
      <span className="flex size-11 items-center justify-center rounded-full border bg-card">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block text-[0.95rem]">{value}</span>
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const { me, orgId, currentOrg } = useOrg();
  const prefetchBoard = usePrefetchBoard();
  const [slide, setSlide] = useState(0);
  const [tab, setTab] = useState<"mine" | "overdue" | "soon">("mine");
  // Momento de referencia fijo durante el render (los filtros por fecha no cambian entre renders).
  const [now] = useState(() => Date.now());
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", orgId],
    queryFn: () => api<Dashboard>(`/dashboard${orgId ? `?orgId=${orgId}` : ""}`),
    enabled: !!me,
  });

  if (me && me.orgs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <EmptyState
          illustration="projects"
          title={`¡Hola, ${me.user.name.split(" ")[0]}!`}
          description="Para empezar, creá una organización. Vas a poder invitar a tu equipo y armar tus tableros."
          action={
            <Link href="/orgs/new">
              <Button>
                <Plus className="h-4 w-4" /> Crear organización
              </Button>
            </Link>
          }
        />
      </div>
    );
  }
  if (error) return <ErrorState error={error} retry={refetch} />;

  const stats = data?.stats ?? { pending: 0, overdue: 0, completed: 0, dueSoon: 0 };
  const total = stats.pending + stats.completed;
  const boards = (data?.boards ?? []).filter((b) => b.openCards > 0).slice(0, 4);
  const boardTotal = boards.reduce((n, b) => n + b.openCards, 0);

  const tasks = (data?.myTasks ?? []).filter((t) => {
    const st = dueState(t.dueAt, false);
    if (tab === "overdue") return st === "overdue";
    if (tab === "soon") return st === "soon" || (t.dueAt !== null && new Date(t.dueAt).getTime() - now < 7 * 864e5 && st !== "overdue");
    return true;
  });
  const featured = tasks.slice(0, 3);
  const current = featured[Math.min(slide, Math.max(featured.length - 1, 0))];

  const weeks = data?.weekly ?? [];
  const thisWeek = weeks[weeks.length - 1]?.completed ?? 0;
  const lastWeek = weeks[weeks.length - 2]?.completed ?? 0;
  const change = lastWeek === 0 ? (thisWeek > 0 ? 100 : 0) : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

  const dist = [
    { label: "Pendientes", value: Math.max(stats.pending - stats.dueSoon - stats.overdue, 0), cls: "bg-primary" },
    { label: "Por vencer", value: stats.dueSoon, cls: "bg-chart-2" },
    { label: "Vencidas", value: stats.overdue, cls: "bg-brand" },
    { label: "Completadas", value: stats.completed, cls: "bg-success" },
  ];
  const distTotal = dist.reduce((n, d) => n + d.value, 0);
  const today = new Date(now);

  return (
    <div className="dashboard-scene w-full px-4 pt-6 pb-10 sm:px-6 lg:px-8">
      {/* Encabezado: título grande, pastillas de contexto y cifra principal */}
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        <h1 className="display-title text-5xl sm:text-6xl">
          Panorama
          <br />
          del equipo
        </h1>
        <div className="flex flex-wrap items-center gap-6 pb-2">
          <InfoChip icon={CalendarDays} label="Fecha" value={today.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })} />
          <InfoChip icon={Flame} label="Estado" value={stats.overdue > 0 ? `${stats.overdue} vencida${stats.overdue > 1 ? "s" : ""}` : "Al día"} />
          <InfoChip icon={CheckCircle2} label="Completadas" value={`${stats.completed} de ${total}`} />
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs text-muted-foreground">{currentOrg ? `Tareas abiertas en ${currentOrg.name}` : "Tus tareas abiertas"}</p>
          {isLoading ? (
            <Skeleton className="mt-2 ml-auto h-14 w-40" />
          ) : (
            <p className="display-figure text-6xl sm:text-7xl">
              {stats.pending}
              <span className="dim">/{total}</span>
            </p>
          )}
        </div>
      </div>

      {/* Barra segmentada por tablero */}
      <div className="mt-10 flex items-end gap-1.5">
        {isLoading && <Skeleton className="h-12 flex-1 rounded-full" />}
        {!isLoading && boards.length === 0 && (
          <div className="hatched flex h-12 flex-1 items-center rounded-full px-5 text-sm text-muted-foreground">Sin tareas abiertas en tus tableros</div>
        )}
        {boards.map((b, i) => (
          <Link
            key={b.id}
            href={`/b/${b.id}`}
            onMouseEnter={() => prefetchBoard(b.id)}
            className="group min-w-24"
            style={{ flexGrow: Math.max(b.openCards / Math.max(boardTotal, 1), 0.12), flexBasis: 0 }}
          >
            <span className="mb-2 block truncate px-1 text-sm text-muted-foreground group-hover:text-foreground">{b.name}</span>
            <span className={cn("flex h-12 items-center justify-end rounded-full p-1.5 transition-transform group-hover:-translate-y-0.5", SEGMENTS[i % SEGMENTS.length])}>
              <span className="rounded-full bg-black/15 px-3 py-1 text-sm font-medium tabular-nums backdrop-blur-sm dark:bg-black/25">
                {b.openCards} abiertas
              </span>
            </span>
          </Link>
        ))}
        {orgId && (
          <Link
            href={`/o/${orgId}`}
            className="inline-flex h-12 shrink-0 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Ver tableros
          </Link>
        )}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        {/* Tarea destacada */}
        <section className="flex min-h-[26rem] flex-col rounded-[2rem] border bg-card p-3 shadow-card">
          <div className="flex flex-wrap items-center gap-2 p-2">
            {(
              [
                ["mine", "Mis tareas", data?.myTasks.length],
                ["overdue", "Vencidas", stats.overdue],
                ["soon", "Próximas", stats.dueSoon],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => {
                  setTab(key);
                  setSlide(0);
                }}
                aria-pressed={tab === key}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
                  tab === key ? "bg-foreground text-background" : "bg-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {count !== undefined && (
                  <span className={cn("rounded-full px-2 text-xs tabular-nums", tab === key ? "bg-primary text-primary-foreground" : "bg-muted")}>{count}</span>
                )}
              </button>
            ))}
            <Link href="/search?assigneeId=me" className="ml-auto">
              <Button variant="ghost" size="icon" className="rounded-full border" aria-label="Ver todas mis tareas">
                <Plus />
              </Button>
            </Link>
          </div>

          <div className="relative mt-1 flex flex-1 flex-col overflow-hidden rounded-[1.6rem] bg-[radial-gradient(120%_120%_at_100%_100%,var(--primary-soft),transparent_60%)] p-6 sm:p-8">
            <div aria-hidden className="hatched pointer-events-none absolute -right-10 -bottom-10 size-64 rounded-full opacity-40" />
            {isLoading ? (
              <Skeleton className="h-40" />
            ) : !current ? (
              <div className="m-auto text-center">
                <p className="display-title text-3xl">Nada por acá</p>
                <p className="mt-2 text-sm text-muted-foreground">No hay tareas en esta vista.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  {me && <Avatar user={me.user} size={40} />}
                  <div className="leading-tight">
                    <p className="text-sm">{me?.user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {current.boardName} · {current.listName}
                    </p>
                  </div>
                  <Link href={`/b/${current.boardId}?card=${current.id}`} className="ml-auto">
                    <Button variant="ghost" size="icon" className="rounded-full border bg-card/60" aria-label="Abrir tarea">
                      <ArrowUpRight />
                    </Button>
                  </Link>
                </div>
                <div className="mt-auto flex flex-wrap items-end justify-between gap-6 pt-10">
                  <Link href={`/b/${current.boardId}?card=${current.id}`} className="max-w-xl">
                    <span className={cn("mb-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase", PRIORITY[current.priority]?.chip)}>
                      {PRIORITY[current.priority]?.label}
                    </span>
                    <p className="display-title text-4xl hover:text-primary sm:text-5xl">{current.title}</p>
                  </Link>
                  {current.dueAt && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Vence</p>
                      <p className={cn("display-figure text-5xl sm:text-6xl", dueState(current.dueAt, false) === "overdue" && "text-brand")}>
                        {fmtShort(current.dueAt).split(" ")[0]}
                        <span className="dim"> {fmtShort(current.dueAt).split(" ")[1]}</span>
                      </p>
                    </div>
                  )}
                </div>
                <div className="mt-6 flex items-center gap-3">
                  <p className="display-figure text-2xl">
                    {Math.min(slide, featured.length - 1) + 1}
                    <span className="dim text-base">/{featured.length}</span>
                  </p>
                  <div className="flex gap-1.5" role="tablist" aria-label="Tareas destacadas">
                    {featured.map((t, i) => (
                      <button
                        key={t.id}
                        role="tab"
                        aria-selected={i === slide}
                        aria-label={t.title}
                        onClick={() => setSlide(i)}
                        className={cn("h-1.5 rounded-full transition-all", i === slide ? "w-10 bg-foreground" : "w-5 bg-muted-foreground/40")}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {tasks.length > 3 && (
            <ul className="mt-2 divide-y px-2">
              {tasks.slice(3, 8).map((t) => (
                <li key={t.id}>
                  <Link href={`/b/${t.boardId}?card=${t.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                    <span className={cn("size-2 shrink-0 rounded-full", PRIORITY[t.priority]?.dot)} />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.dueAt ? fmtShort(t.dueAt) : t.boardName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-6">
          {/* Ritmo y distribución */}
          <section className="rounded-[2rem] border bg-card p-6 shadow-card">
            <div className="flex items-center gap-2">
              <h2 className="text-lg">Ritmo del equipo</h2>
              <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground tabular-nums">{weeks.length}</span>
            </div>
            <div className="mt-5 flex items-end gap-3">
              <p className="display-figure text-6xl">{thisWeek}</p>
              <p className="pb-2 text-sm text-muted-foreground">completadas esta semana</p>
              <span
                className={cn(
                  "mb-2 ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                  change >= 0 ? "bg-success/15 text-success" : "bg-brand-soft text-brand",
                )}
              >
                {change >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {change >= 0 ? "+" : ""}
                {change}%
              </span>
            </div>
            <div className="mt-6 flex h-3 gap-1" role="img" aria-label="Distribución de tus tareas por estado">
              {distTotal === 0 ? (
                <span className="hatched flex-1 rounded-full" />
              ) : (
                dist
                  .filter((d) => d.value > 0)
                  .map((d) => <span key={d.label} className={cn("rounded-full", d.cls)} style={{ flexGrow: d.value, flexBasis: 0 }} title={`${d.label}: ${d.value}`} />)
              )}
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {dist.map((d) => (
                <li key={d.label} className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", d.cls)} />
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="ml-auto tabular-nums">{d.value}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Actividad reciente */}
          <section className="flex max-h-96 flex-col rounded-[2rem] border bg-card p-6 shadow-card">
            <h2 className="mb-4 text-lg">Actividad reciente</h2>
            {data && data.activity.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Sin actividad todavía.</p>}
            <ul className="-mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2 scroll-thin" tabIndex={0} aria-label="Actividad reciente">
              {data?.activity.map((a) => (
                <li key={a.id} className="text-sm">
                  <Link href={`/b/${a.boardId}${a.cardId ? `?card=${a.cardId}` : ""}`} className="hover:underline">
                    <span className="font-medium">{a.actorName ?? "GitHub"}</span> <span className="text-muted-foreground">{describeActivity(a)}</span>
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {a.boardName} · {ago(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
