"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Bell, BellOff, CheckCircle2, Copy, Layers, ListChecks, XCircle, CornerUpLeft, Gauge, ListTree, Milestone, Plus, Repeat, ShieldCheck, Square, X } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/user-avatar";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import type { BoardData, CardDetail, WorkspaceTree } from "@/lib/types";
import { parsePoints } from "@/lib/fields";
import { cn } from "@/lib/utils";

type Patch = (b: Record<string, unknown>) => void;

/** Aviso arriba de la tarjeta cuando otra tarea sin terminar la bloquea, o si es subtarea. */
export function CardBanners({ card, onOpenCard }: { card: CardDetail; onOpenCard: (id: string) => void }) {
  const blockers = card.relations.filter((r) => r.type === "blocks" && r.direction === "in" && !r.completed);
  return (
    <>
      {card.parent && (
        <button onClick={() => onOpenCard(card.parent!.id)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
          <CornerUpLeft className="size-4" /> Subtarea de <strong className="font-medium">{card.parent.title}</strong>
        </button>
      )}
      {blockers.length > 0 && (
        <div role="status" className="flex gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <Ban className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Bloqueada: depende de tareas sin terminar</p>
            <ul className="mt-1 space-y-0.5">
              {blockers.map((b) => (
                <li key={b.cardId}>
                  {b.boardId === card.boardId ? (
                    <button className="text-left hover:underline" onClick={() => onOpenCard(b.cardId)}>
                      {b.title}
                    </button>
                  ) : (
                    <Link className="hover:underline" href={`/boards/${b.boardId}?card=${b.cardId}`}>
                      {b.title} <span className="text-muted-foreground">· {b.boardName}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

const QA_TEXT = { none: "Sin revisar", pending: "Esperando aprobación", approved: "Aprobada", rejected: "Rechazada" } as const;

/** Control de calidad: estado, pedido de revisión y aprobación o rechazo por quienes revisan. */
export function QaPanel({ card, board, canEdit, refresh }: { card: CardDetail; board: BoardData; canEdit: boolean; refresh: () => void }) {
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const decide = useMutation({
    mutationFn: (v: { decision: "approve" | "reject"; note?: string }) => api(`/cards/${card.id}/qa`, { method: "POST", body: v }),
    onSuccess: (_d, v) => {
      toast.success(v.decision === "approve" ? "Tarea aprobada" : "Tarea rechazada");
      setRejecting(false);
      setNote("");
    },
    onSettled: refresh,
  });
  const request = useMutation({
    mutationFn: () => api(`/cards/${card.id}/move`, { method: "POST", body: { listId: board.board.qaListId, afterCardId: null } }),
    onSuccess: () => toast.success("Revisión pedida"),
    onSettled: refresh,
  });
  if (!board.board.qaRequired) return null;
  const qaList = board.lists.find((l) => l.id === board.board.qaListId);
  const inReview = card.listId === board.board.qaListId;
  const status = card.qa.status;

  return (
    <section className="rounded-2xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Control de calidad</h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            status === "approved" && "bg-success/15 text-success",
            status === "pending" && "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
            status === "rejected" && "bg-brand-soft text-brand",
            status === "none" && "bg-muted text-muted-foreground",
          )}
        >
          {QA_TEXT[status]}
        </span>
        {card.qa.by && card.qa.at && (
          <span className="text-xs text-muted-foreground">
            por {card.qa.by} · {ago(card.qa.at)}
          </span>
        )}
      </div>
      {status === "rejected" && card.qa.note && <p className="mt-2 rounded-xl bg-brand-soft/60 px-3 py-2 text-sm">{card.qa.note}</p>}
      {!inReview && status !== "approved" && canEdit && qaList && !card.completedAt && (
        <Button size="sm" variant="secondary" className="mt-3" loading={request.isPending} onClick={() => request.mutate()}>
          Pedir revisión (mover a {qaList.name})
        </Button>
      )}
      {board.canReview && (status === "pending" || (inReview && status !== "approved")) && (
        <div className="mt-3 space-y-2">
          {rejecting ? (
            <form
              className="space-y-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                decide.mutate({ decision: "reject", note });
              }}
            >
              <Textarea rows={2} autoFocus maxLength={500} placeholder="¿Qué hay que corregir?" aria-label="Motivo del rechazo" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="danger" loading={decide.isPending} disabled={!note.trim()}>
                  Rechazar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ decision: "approve" })}>
                <CheckCircle2 /> Aprobar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>
                Rechazar
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Subtareas: lista con avance, marcado rápido y alta. */
export function Subtasks({ card, board, canEdit, refresh, onOpenCard }: { card: CardDetail; board: BoardData; canEdit: boolean; refresh: () => void; onOpenCard: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const add = useMutation({ mutationFn: () => api(`/cards/${card.id}/subtasks`, { method: "POST", body: { title } }), onSuccess: () => setTitle(""), onSettled: refresh });
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => api(`/cards/${v.id}`, { method: "PATCH", body: { completed: v.done } }),
    onSettled: refresh,
  });
  if (card.parent) return null;
  const people = new Map(board.people.map((p) => [p.userId, p]));
  const done = card.subtasks.filter((t) => t.done).length;
  const pct = card.subtasks.length ? Math.round((done / card.subtasks.length) * 100) : 0;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <ListTree className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-sm font-semibold">Subtareas</h3>
        {card.subtasks.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {done}/{card.subtasks.length}
          </span>
        )}
      </div>
      {card.subtasks.length > 0 && (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      <ul className="space-y-1">
        {card.subtasks.map((t) => {
          const owner = t.ownerId ? people.get(t.ownerId) : null;
          return (
            <li key={t.id} className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-muted">
              <button
                aria-label={t.done ? `Reabrir ${t.title}` : `Completar ${t.title}`}
                disabled={!canEdit}
                onClick={() => toggle.mutate({ id: t.id, done: !t.done }, { onError: () => undefined })}
                className="rounded-full text-muted-foreground disabled:opacity-60"
              >
                {t.done ? <CheckCircle2 className="size-4 text-success" /> : <Square className="size-4" />}
              </button>
              <button className={cn("min-w-0 flex-1 truncate text-left text-sm hover:text-primary", t.done && "text-muted-foreground line-through")} onClick={() => onOpenCard(t.id)}>
                {t.title}
              </button>
              {owner && <Avatar user={owner} size={20} />}
              <span className="text-xs text-muted-foreground">{board.lists.find((l) => l.id === t.listId)?.name}</span>
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (title.trim()) add.mutate();
          }}
        >
          <Input className="h-9" placeholder="Agregar una subtarea" aria-label="Nueva subtarea" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary" loading={add.isPending} disabled={!title.trim()} aria-label="Agregar subtarea">
            <Plus />
          </Button>
        </form>
      )}
    </section>
  );
}

/** Campos de planificación en la columna lateral: etapa, estimación, repetición, seguir y duplicar. */
export function PlanningSidebar({ card, board, canEdit, patch, onOpenCard }: { card: CardDetail; board: BoardData; canEdit: boolean; patch: Patch; onOpenCard: (id: string) => void }) {
  const qc = useQueryClient();
  const watch = useMutation({
    mutationFn: (watching: boolean) => api(`/cards/${card.id}/watch`, { method: "PUT", body: { watching } }),
    onSuccess: (_d, watching) => toast.success(watching ? "Vas a recibir avisos de esta tarjeta" : "Dejaste de seguir la tarjeta"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["card", card.id] }),
  });
  const duplicate = useMutation({
    mutationFn: () => api<{ id: string }>(`/cards/${card.id}/duplicate`, { method: "POST" }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["board", board.board.id] });
      toast.success("Tarjeta duplicada");
      onOpenCard(id);
    },
  });
  const sprints = board.sprints.filter((s) => s.status !== "closed" || s.id === card.sprintId);
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor="card-sprint" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Milestone className="h-3.5 w-3.5" /> Etapa
        </label>
        <Select id="card-sprint" className="h-9" disabled={!canEdit} value={card.sprintId ?? ""} onChange={(e) => patch({ sprintId: e.target.value || null })}>
          <option value="">Sin etapa</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.status === "active" ? " (en curso)" : ""}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="card-estimate" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" /> Estimación (puntos)
        </label>
        <div className="flex gap-1">
          <Input
            id="card-estimate"
            type="number"
            min={0}
            max={1000}
            step={0.5}
            className="h-9"
            disabled={!canEdit}
            defaultValue={card.estimatePoints ?? ""}
            key={String(card.estimatePoints)}
            onBlur={(e) => {
              const v = parsePoints(e.target.value);
              if (v === undefined) {
                toast.error("La estimación va de 0 a 1000 puntos");
                e.target.value = card.estimatePoints?.toString() ?? "";
              } else if (v !== card.estimatePoints) patch({ estimatePoints: v });
            }}
          />
          {card.estimatePoints !== null && canEdit && (
            <Button variant="ghost" size="icon" aria-label="Quitar estimación" onClick={() => patch({ estimatePoints: null })}>
              <X />
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="card-recurrence" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Repeat className="h-3.5 w-3.5" /> Repetir
        </label>
        <Select id="card-recurrence" className="h-9" disabled={!canEdit} value={card.recurrence ?? ""} onChange={(e) => patch({ recurrence: e.target.value || null })}>
          <option value="">No se repite</option>
          <option value="weekly">Cada semana</option>
          <option value="monthly">Cada mes</option>
        </Select>
        {card.recurrence && <p className="text-[11px] text-muted-foreground">Al completarla se crea la próxima con la fecha corrida.</p>}
      </div>
      <Button variant={card.watching ? "soft" : "secondary"} className="w-full justify-start" loading={watch.isPending} onClick={() => watch.mutate(!card.watching)}>
        {card.watching ? <BellOff /> : <Bell />}
        {card.watching ? "Dejar de seguir" : "Seguir"}
        {card.watcherCount > 0 && <span className="ml-auto text-xs text-muted-foreground">{card.watcherCount}</span>}
      </Button>
      {canEdit && (
        <Button variant="secondary" className="w-full justify-start" loading={duplicate.isPending} onClick={() => duplicate.mutate()}>
          <Copy /> Duplicar
        </Button>
      )}
      <MirrorControls card={card} board={board} />
    </>
  );
}

/** Espejar la tarjeta en otros tableros de la organización y ver dónde está espejada. */
export function MirrorControls({ card, board }: { card: CardDetail; board: BoardData }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState("");
  const tree = useQuery({ queryKey: ["workspaces", board.board.orgId], queryFn: () => api<WorkspaceTree>(`/orgs/${board.board.orgId}/workspaces`), enabled: open });
  const target = useQuery({ queryKey: ["board", boardId], queryFn: () => api<BoardData>(`/boards/${boardId}`), enabled: !!boardId });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["card", card.id] });
    qc.invalidateQueries({ queryKey: ["board"] });
  };
  const add = useMutation({
    mutationFn: () => api(`/cards/${card.id}/mirrors`, { method: "POST", body: { boardId, listId: listId || undefined } }),
    onSuccess: () => {
      toast.success("Tarjeta espejada");
      setOpen(false);
      setBoardId("");
      setListId("");
    },
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/mirrors/${id}`, { method: "DELETE" }), onSettled: refresh });
  const taken = new Set([card.boardId, ...card.mirrors.map((m) => m.boardId)]);
  const canTarget = target.data && (target.data.role === "editor" || target.data.role === "admin") && !target.data.board.archivedAt;
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Layers className="h-3.5 w-3.5" /> Espejos
      </p>
      {card.mirrors.length > 0 && (
        <ul className="space-y-1">
          {card.mirrors.map((m) => (
            <li key={m.id} className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate" title={`${m.boardName} · ${m.listName}`}>
                {m.boardName} <span className="text-muted-foreground">· {m.listName}</span>
              </span>
              <button aria-label={`Quitar el espejo de ${m.boardName}`} className="rounded p-0.5 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(m.id)}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="secondary" className="w-full justify-start" disabled={!!card.archivedAt}>
            <Copy /> Espejar en otro tablero
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <p className="text-sm font-semibold">Espejar tarjeta</p>
          <p className="text-xs text-muted-foreground">La misma tarea aparece en otro tablero con la información sincronizada. Solo la ven quienes tienen acceso a este tablero.</p>
          <Select
            aria-label="Tablero de destino"
            value={boardId}
            onChange={(e) => {
              setBoardId(e.target.value);
              setListId("");
            }}
          >
            <option value="">Elegí un tablero…</option>
            {tree.data?.workspaces.map((w) => (
              <optgroup key={w.id} label={w.name}>
                {w.boards
                  .filter((b) => !taken.has(b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
          {target.data && (
            <Select aria-label="Lista de destino" value={listId || target.data.lists[0]?.id || ""} onChange={(e) => setListId(e.target.value)}>
              {target.data.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
          {target.data && !canTarget && <p className="text-xs text-destructive">No tenés permiso para agregar tarjetas en ese tablero.</p>}
          <Button className="w-full" size="sm" disabled={!canTarget} loading={add.isPending} onClick={() => add.mutate()}>
            Espejar
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type RuleResult = { key: string; label: string; level: "warn" | "block"; ok: boolean; detail: string };

/** Condiciones del tablero para completar la tarjeta (las valida el servidor al cerrarla). */
export function CompletionPanel({ card }: { card: CardDetail }) {
  const q = useQuery({
    queryKey: ["completion", card.id, card.updatedAt, card.qa.status, card.subtasks.length],
    queryFn: () => api<{ results: RuleResult[]; canComplete: boolean }>(`/cards/${card.id}/completion`),
  });
  if (!q.data || q.data.results.length === 0 || card.completedAt) return null;
  const { results, canComplete } = q.data;
  return (
    <section className="rounded-2xl border p-4" aria-label="Condiciones para terminar">
      <div className="mb-2 flex items-center gap-2">
        <ListChecks className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-sm font-semibold">Para terminar</h3>
        <span className={cn("text-xs font-medium", canComplete ? "text-success" : "text-destructive")}>{canComplete ? "Se puede completar" : "Faltan condiciones"}</span>
      </div>
      <ul className="space-y-1.5 text-sm">
        {results.map((r) => (
          <li key={r.key} className="flex items-start gap-2">
            {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : r.level === "block" ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />}
            <span>
              {r.label}
              {!r.ok && <span className="block text-xs text-muted-foreground">{r.detail}{r.level === "warn" ? " · solo informa, no bloquea" : ""}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
