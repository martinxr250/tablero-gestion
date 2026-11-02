"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, CheckCircle2, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/overlay";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { fmtShort } from "@/lib/format";
import type { BoardData, CardSummary, Sprint } from "@/lib/types";
import { cn } from "@/lib/utils";

type Draft = { id?: string; name: string; goal: string; startsOn: string; endsOn: string; capacityPoints: string };

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const points = (cards: CardSummary[]) => cards.reduce((n, c) => n + (c.estimatePoints ?? 0), 0);

/** Etapas de trabajo: pendientes sin etapa, etapa en curso y planificadas, con capacidad y avance. */
export function SprintsView({ data, canEdit, onOpenCard }: { data: BoardData; canEdit: boolean; onOpenCard: (id: string) => void }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["board", data.board.id] });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [closing, setClosing] = useState<Sprint | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const assign = useMutation({
    mutationFn: (v: { cardId: string; sprintId: string | null }) => api(`/cards/${v.cardId}`, { method: "PATCH", body: { sprintId: v.sprintId } }),
    onSettled: refresh,
  });
  const estimate = useMutation({
    mutationFn: (v: { cardId: string; value: number | null }) => api(`/cards/${v.cardId}`, { method: "PATCH", body: { estimatePoints: v.value } }),
    onSettled: refresh,
  });
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = { name: d.name, goal: d.goal || null, startsOn: d.startsOn, endsOn: d.endsOn, capacityPoints: d.capacityPoints ? Number(d.capacityPoints) : null };
      return d.id ? api(`/sprints/${d.id}`, { method: "PATCH", body }) : api(`/boards/${data.board.id}/sprints`, { method: "POST", body });
    },
    onSuccess: () => setDraft(null),
    onSettled: refresh,
  });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "active" | "closed"; moveOpenTo?: string | null }) => api(`/sprints/${v.id}`, { method: "PATCH", body: { status: v.status, moveOpenTo: v.moveOpenTo } }),
    onSuccess: (_d, v) => {
      toast.success(v.status === "active" ? "Etapa iniciada" : "Etapa cerrada");
      setClosing(null);
    },
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/sprints/${id}`, { method: "DELETE" }), onSettled: refresh });

  const open = data.cards.filter((c) => !c.completedAt);
  const backlog = open.filter((c) => !c.sprintId);
  const visibleSprints = data.sprints.filter((s) => s.status !== "closed");
  const closed = data.sprints.filter((s) => s.status === "closed");
  const activeExists = data.sprints.some((s) => s.status === "active");

  const newDraft = (): Draft => {
    const last = [...data.sprints].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
    const start = last ? new Date(`${last.endsOn}T12:00:00`) : new Date();
    if (last) start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 13);
    return { name: `Etapa ${data.sprints.length + 1}`, goal: "", startsOn: isoDate(start), endsOn: isoDate(end), capacityPoints: "" };
  };

  const CardRow = ({ c }: { c: CardSummary }) => (
    <li className="flex items-center gap-3 rounded-2xl border bg-background/50 px-3 py-2 text-sm">
      {c.completedAt ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Square className="size-4 shrink-0 text-muted-foreground" />}
      <button className={cn("min-w-0 flex-1 truncate text-left hover:text-primary", c.completedAt && "text-muted-foreground line-through")} onClick={() => onOpenCard(c.id)}>
        {c.title}
      </button>
      <input
        type="number"
        min={0}
        max={1000}
        step={0.5}
        aria-label={`Puntos de ${c.title}`}
        placeholder="pts"
        disabled={!canEdit}
        defaultValue={c.estimatePoints ?? ""}
        key={`${c.id}-${c.estimatePoints}`}
        onBlur={(e) => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          if (v !== c.estimatePoints) estimate.mutate({ cardId: c.id, value: v });
        }}
        className="h-8 w-16 rounded-full border bg-card px-2 text-center text-xs tabular-nums"
      />
      {canEdit && (
        <select
          aria-label={`Etapa de ${c.title}`}
          value={c.sprintId ?? ""}
          onChange={(e) => assign.mutate({ cardId: c.id, sprintId: e.target.value || null })}
          className="h-8 max-w-36 rounded-full border bg-card px-2 text-xs"
        >
          <option value="">Pendientes</option>
          {visibleSprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </li>
  );

  return (
    <div className="h-full overflow-y-auto px-4 pb-8 scroll-thin sm:px-6">
      <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <section className="rounded-[2rem] border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-lg">Pendientes</h2>
            <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{backlog.length}</span>
            <span className="ml-auto text-xs text-muted-foreground">{points(backlog)} pts sin etapa</span>
          </div>
          <ul className="space-y-2">
            {backlog.map((c) => (
              <CardRow key={c.id} c={c} />
            ))}
            {backlog.length === 0 && <li className="py-8 text-center text-sm text-muted-foreground">Todas las tareas abiertas tienen etapa.</li>}
          </ul>
        </section>

        <section className="space-y-5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg">Etapas</h2>
            {canEdit && (
              <Button size="sm" className="ml-auto" onClick={() => setDraft(newDraft())}>
                <Plus /> Nueva etapa
              </Button>
            )}
          </div>
          {visibleSprints.length === 0 && (
            <div className="hatched rounded-[2rem] border p-8 text-center text-sm text-muted-foreground">Todavía no hay etapas. Creá una para planificar el trabajo de las próximas semanas.</div>
          )}
          {visibleSprints.map((s) => {
            const items = data.cards.filter((c) => c.sprintId === s.id);
            const total = points(items);
            const done = points(items.filter((c) => c.completedAt));
            const pct = total ? Math.round((done / total) * 100) : 0;
            const over = s.capacityPoints !== null && total > s.capacityPoints;
            return (
              <article key={s.id} className={cn("rounded-[2rem] border bg-card p-5", s.status === "active" && "border-primary/50")}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="display-title text-2xl">{s.name}</h3>
                      {s.status === "active" && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">En curso</span>}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarRange className="size-3.5" /> {fmtShort(`${s.startsOn}T12:00:00`)} – {fmtShort(`${s.endsOn}T12:00:00`)}
                    </p>
                    {s.goal && <p className="mt-2 text-sm text-muted-foreground">{s.goal}</p>}
                  </div>
                  <div className="text-right">
                    <p className="display-figure text-4xl">
                      {done}
                      <span className="dim">/{total}</span>
                    </p>
                    <p className={cn("text-xs", over ? "text-brand" : "text-muted-foreground")}>
                      {s.capacityPoints !== null ? `capacidad ${s.capacityPoints} pts${over ? " · excedida" : ""}` : "puntos completados"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Avance de ${s.name}`}>
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <ul className="mt-4 space-y-2">
                  {items.map((c) => (
                    <CardRow key={c.id} c={c} />
                  ))}
                  {items.length === 0 && <li className="text-sm text-muted-foreground">Asigná tareas desde Pendientes.</li>}
                </ul>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {s.status === "planned" && (
                      <Button size="sm" disabled={activeExists} title={activeExists ? "Cerrá la etapa en curso primero" : undefined} onClick={() => setStatus.mutate({ id: s.id, status: "active" })}>
                        <Play /> Iniciar
                      </Button>
                    )}
                    {s.status === "active" && (
                      <Button size="sm" variant="secondary" onClick={() => setClosing(s)}>
                        <CheckCircle2 /> Cerrar etapa
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ id: s.id, name: s.name, goal: s.goal ?? "", startsOn: s.startsOn, endsOn: s.endsOn, capacityPoints: s.capacityPoints?.toString() ?? "" })}>
                      <Pencil /> Editar
                    </Button>
                    {data.role === "admin" && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm("¿Eliminar la etapa? Sus tareas vuelven a Pendientes.") && remove.mutate(s.id)}>
                        <Trash2 /> Eliminar
                      </Button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {closed.length > 0 && (
            <details className="rounded-[2rem] border bg-card p-5">
              <summary className="cursor-pointer text-sm text-muted-foreground">Etapas cerradas ({closed.length})</summary>
              <ul className="mt-3 space-y-1 text-sm">
                {closed.map((s) => (
                  <li key={s.id} className="flex justify-between">
                    <span>{s.name}</span>
                    <span className="text-muted-foreground">
                      {fmtShort(`${s.startsOn}T12:00:00`)} – {fmtShort(`${s.endsOn}T12:00:00`)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)} title={draft?.id ? "Editar etapa" : "Nueva etapa"}>
        {draft && (
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save.mutate(draft);
            }}
          >
            <Field label="Nombre" htmlFor="sp-name">
              <Input id="sp-name" required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Objetivo" htmlFor="sp-goal">
              <Textarea id="sp-goal" rows={2} maxLength={500} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Inicio" htmlFor="sp-start">
                <Input id="sp-start" type="date" required value={draft.startsOn} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} />
              </Field>
              <Field label="Fin" htmlFor="sp-end">
                <Input id="sp-end" type="date" required value={draft.endsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} />
              </Field>
            </div>
            <Field label="Capacidad del equipo (puntos)" htmlFor="sp-cap" hint="Cuántos puntos puede completar el equipo en esta etapa.">
              <Input id="sp-cap" type="number" min={0} step={0.5} value={draft.capacityPoints} onChange={(e) => setDraft({ ...draft, capacityPoints: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={save.isPending}>
                Guardar
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)} title={`Cerrar ${closing?.name ?? ""}`} description="Las tareas sin terminar pasan a otra etapa o vuelven a Pendientes.">
        <div className="space-y-4">
          <Select aria-label="Destino de las tareas pendientes" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Volver a Pendientes</option>
            {data.sprints
              .filter((s) => s.status === "planned")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  Pasar a {s.name}
                </option>
              ))}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setClosing(null)}>
              Cancelar
            </Button>
            <Button loading={setStatus.isPending} onClick={() => closing && setStatus.mutate({ id: closing.id, status: "closed", moveOpenTo: moveTo || null })}>
              Cerrar etapa
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
