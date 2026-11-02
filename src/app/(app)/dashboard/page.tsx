"use client";

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, CircleDashed, Flame, Plus } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BoardTile } from "@/components/boards/board-tile";
import { useOrg } from "@/components/shell/org-context";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/primitives";
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

export default function DashboardPage() {
  const { me, orgId, currentOrg } = useOrg();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", orgId],
    queryFn: () => api<Dashboard>(`/dashboard${orgId ? `?orgId=${orgId}` : ""}`),
    enabled: !!me,
  });

  if (me && me.orgs.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <EmptyState
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

  const tiles = [
    { label: "Pendientes", value: data?.stats.pending, icon: CircleDashed, tone: "text-indigo-500 bg-indigo-500/10", href: "/search?assigneeId=me&status=open" },
    { label: "Vencidas", value: data?.stats.overdue, icon: Flame, tone: "text-red-500 bg-red-500/10", href: "/search?assigneeId=me&status=overdue" },
    { label: "Vencen en 7 días", value: data?.stats.dueSoon, icon: AlarmClock, tone: "text-amber-500 bg-amber-500/10", href: "/search?assigneeId=me&due=week" },
    { label: "Completadas", value: data?.stats.completed, icon: CheckCircle2, tone: "text-emerald-500 bg-emerald-500/10", href: "/search?assigneeId=me&status=completed" },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader title={`Hola, ${me?.user.name.split(" ")[0] ?? ""}`} subtitle={currentOrg ? `Resumen de ${currentOrg.name}` : "Tu resumen"} />
      {error ? (
        <ErrorState error={error} retry={refetch} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {tiles.map((t) => (
              <Link key={t.label} href={t.href}>
                <Card className="p-5 transition hover:border-primary/40">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{t.label}</p>
                    <span className={cn("rounded-lg p-1.5", t.tone)}>
                      <t.icon className="h-4 w-4" />
                    </span>
                  </div>
                  {isLoading ? <Skeleton className="mt-3 h-9 w-16" /> : <p className="mt-3 text-3xl font-semibold tabular-nums">{t.value ?? 0}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Tareas asignadas a vos</p>
                </Card>
              </Link>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold">Mis tareas</h2>
                <Link href="/search?assigneeId=me" className="text-sm text-primary hover:underline">
                  Ver todas
                </Link>
              </div>
              {isLoading && <Skeleton className="h-48" />}
              {data && data.myTasks.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No tenés tareas pendientes.</p>}
              <ul className="divide-y divide-border">
                {data?.myTasks.slice(0, 10).map((t) => {
                  const due = dueState(t.dueAt, false);
                  return (
                    <li key={t.id}>
                      <Link href={`/b/${t.boardId}?card=${t.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", PRIORITY[t.priority]?.dot)} title={PRIORITY[t.priority]?.label} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{t.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.boardName} · {t.listName}
                          </span>
                        </span>
                        {t.dueAt && (
                          <Badge className={cn(due === "overdue" ? "bg-destructive/10 text-destructive" : due === "soon" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "bg-muted text-muted-foreground")}>
                            {fmtShort(t.dueAt)}
                          </Badge>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 font-semibold">Ritmo del equipo</h2>
              {isLoading ? (
                <Skeleton className="h-60" />
              ) : (
                <div className="h-60" role="img" aria-label="Tareas creadas y completadas por semana en las últimas 8 semanas">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data?.weekly.map((w) => ({ ...w, label: fmtShort(w.week) }))} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={28} stroke="var(--muted-foreground)" />
                      <Tooltip contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} cursor={{ fill: "var(--muted)" }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="created" name="Creadas" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="completed" name="Completadas" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <h2 className="mb-3 font-semibold">Tableros activos</h2>
              {isLoading && <Skeleton className="h-32" />}
              {data && data.boards.length === 0 && (
                <EmptyState
                  title="Todavía no hay tableros"
                  description="Creá uno desde un espacio de trabajo."
                  action={
                    orgId && (
                      <Link href={`/o/${orgId}`}>
                        <Button variant="secondary">Ver espacios de trabajo</Button>
                      </Link>
                    )
                  }
                />
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data?.boards.map((b) => (
                  <BoardTile key={b.id} id={b.id} name={b.name} color={b.color} meta={`${b.openCards} abiertas${b.lastActivity ? ` · ${ago(b.lastActivity)}` : ""}`} />
                ))}
              </div>
            </section>
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Actividad reciente</h2>
              {data && data.activity.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Sin actividad todavía.</p>}
              <ul className="space-y-3">
                {data?.activity.map((a) => (
                  <li key={a.id} className="text-sm">
                    <Link href={`/b/${a.boardId}${a.cardId ? `?card=${a.cardId}` : ""}`} className="hover:underline">
                      <strong className="font-medium">{a.actorName ?? "Alguien"}</strong> <span className="text-muted-foreground">{describeActivity(a)}</span>
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {a.boardName} · {ago(a.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
