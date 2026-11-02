"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, endOfWeek, isBefore, isSameDay, startOfDay } from "date-fns";
import { Ban, CalendarDays, CheckCircle2, Circle, Flag, Inbox, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useOrg } from "@/components/shell/org-context";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button, ErrorState, Input, Select, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { asColor, PRIORITY, SWATCH } from "@/lib/colors";
import { fmtDate, fmtShort } from "@/lib/format";
import type { BoardData, WorkspaceTree } from "@/lib/types";
import { cn } from "@/lib/utils";

type WorkCard = {
  id: string;
  title: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  qaStatus: string;
  blocked: boolean;
  isOwner: boolean;
  listName: string;
  board: { id: string; name: string; color: string; orgName: string };
};
type InboxItem = { id: string; title: string; dueOn: string | null; done: boolean; createdAt: string };

const GROUPS = [
  { key: "overdue", label: "Vencidas" },
  { key: "today", label: "Hoy" },
  { key: "tomorrow", label: "Mañana" },
  { key: "week", label: "Esta semana" },
  { key: "later", label: "Más adelante" },
  { key: "none", label: "Sin fecha" },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

function groupOf(card: WorkCard, now: Date): GroupKey {
  if (!card.dueAt) return "none";
  const due = new Date(card.dueAt);
  const today = startOfDay(now);
  if (isBefore(due, today) && !card.completedAt) return "overdue";
  if (isSameDay(due, today)) return "today";
  if (isSameDay(due, addDays(today, 1))) return "tomorrow";
  if (!isBefore(endOfWeek(today, { weekStartsOn: 1 }), due)) return "week";
  return "later";
}

/** Elegir tablero y lista para mandar una nota de la bandeja. */
function MoveToBoard({ item, onMoved }: { item: InboxItem; onMoved: (boardId: string, cardId: string) => void }) {
  const { orgId } = useOrg();
  const [open, setOpen] = useState(false);
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState("");
  const tree = useQuery({ queryKey: ["workspaces", orgId], queryFn: () => api<WorkspaceTree>(`/orgs/${orgId}/workspaces`), enabled: open && !!orgId });
  const board = useQuery({ queryKey: ["board", boardId], queryFn: () => api<BoardData>(`/boards/${boardId}`), enabled: !!boardId });
  const move = useMutation({
    mutationFn: () => api<{ cardId: string; boardId: string }>(`/me/inbox/${item.id}/move`, { method: "POST", body: { listId: listId || board.data?.lists[0]?.id } }),
    onSuccess: (r) => {
      setOpen(false);
      onMoved(r.boardId, r.cardId);
    },
  });
  const editable = (board.data?.role === "editor" || board.data?.role === "admin") && !board.data.board.archivedAt;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-primary" aria-label={`Mandar "${item.title}" a un tablero`} title="Mandar a un tablero">
          <Send className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-sm font-semibold">Mandar a un tablero</p>
        <Select
          aria-label="Tablero"
          value={boardId}
          onChange={(e) => {
            setBoardId(e.target.value);
            setListId("");
          }}
        >
          <option value="">Elegí un tablero…</option>
          {tree.data?.workspaces.map((w) => (
            <optgroup key={w.id} label={w.name}>
              {w.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {board.data && (
          <Select aria-label="Lista" value={listId || board.data.lists[0]?.id || ""} onChange={(e) => setListId(e.target.value)}>
            {board.data.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
        {board.data && !editable && <p className="text-xs text-destructive">No tenés permiso para crear tarjetas en este tablero.</p>}
        <Button className="w-full" size="sm" disabled={!board.data || !editable} loading={move.isPending} onClick={() => move.mutate()}>
          Crear tarjeta
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function InboxPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const q = useQuery({ queryKey: ["inbox"], queryFn: () => api<{ items: InboxItem[] }>("/me/inbox") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["inbox"] });
  const add = useMutation({
    mutationFn: () => api("/me/inbox", { method: "POST", body: { title, dueOn: dueOn || null } }),
    onSuccess: () => {
      setTitle("");
      setDueOn("");
    },
    onSettled: refresh,
  });
  const toggle = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api(`/me/inbox/${v.id}`, { method: "PATCH", body: { done: v.done } }), onSettled: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/me/inbox/${id}`, { method: "DELETE" }), onSettled: refresh });
  const items = q.data?.items ?? [];
  return (
    <section className="flex min-h-0 flex-col rounded-[2rem] border bg-card" aria-label="Bandeja de entrada">
      <header className="flex items-center gap-2 px-5 pt-5 pb-3">
        <Inbox className="size-4 text-primary" />
        <h2 className="flex-1 text-base font-semibold">Bandeja de entrada</h2>
        <span className="text-xs text-muted-foreground">{items.filter((i) => !i.done).length}</span>
      </header>
      <form
        className="space-y-2 px-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (title.trim()) add.mutate();
        }}
      >
        <Input placeholder="Anotá algo para no olvidarlo…" aria-label="Nueva nota" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        {title.trim() && (
          <div className="flex gap-2">
            <Input type="date" aria-label="Fecha (opcional)" className="h-9" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
            <Button type="submit" size="sm" loading={add.isPending}>
              <Plus /> Anotar
            </Button>
          </div>
        )}
      </form>
      <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4 scroll-thin">
        {!q.data && <Skeleton className="h-24" />}
        {items.map((i) => (
          <li key={i.id} className="group flex items-center gap-2 rounded-xl border bg-background/40 px-2.5 py-2">
            <button aria-label={i.done ? `Reabrir ${i.title}` : `Marcar ${i.title} como hecha`} onClick={() => toggle.mutate({ id: i.id, done: !i.done })}>
              {i.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm", i.done && "text-muted-foreground line-through")}>{i.title}</p>
              {i.dueOn && <p className="text-[11px] text-muted-foreground">{fmtShort(`${i.dueOn}T12:00:00`)}</p>}
            </div>
            {!i.done && (
              <MoveToBoard
                item={i}
                onMoved={(boardId, cardId) => {
                  refresh();
                  qc.invalidateQueries({ queryKey: ["my-work"] });
                  toast.success("Tarjeta creada", { action: { label: "Abrir", onClick: () => router.push(`/b/${boardId}?card=${cardId}`) } });
                }}
              />
            )}
            <button className="rounded-lg p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-destructive focus:opacity-100" aria-label={`Borrar ${i.title}`} onClick={() => remove.mutate(i.id)}>
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {q.data && items.length === 0 && (
          <li className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">Anotá ideas o pendientes y después mandalos al tablero que corresponda.</li>
        )}
      </ul>
    </section>
  );
}

function WorkRow({ card }: { card: WorkCard }) {
  const p = PRIORITY[card.priority] ?? PRIORITY.none!;
  const overdue = card.dueAt && !card.completedAt && isBefore(new Date(card.dueAt), startOfDay(new Date()));
  return (
    <li>
      <Link href={`/b/${card.board.id}?card=${card.id}`} className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 transition-colors hover:border-primary/40">
        {card.completedAt ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Flag className={cn("size-4 shrink-0", p.flag)} aria-label={`Prioridad ${p.label}`} />}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", card.completedAt && "text-muted-foreground line-through")}>{card.title}</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span className={cn("size-2 shrink-0 rounded-full", SWATCH[asColor(card.board.color)])} />
            {card.board.name} · {card.listName}
            {!card.isOwner && " · colaborás"}
          </p>
        </div>
        {card.blocked && (
          <span className="hidden items-center gap-1 text-xs text-destructive sm:inline-flex">
            <Ban className="size-3.5" /> Bloqueada
          </span>
        )}
        {card.dueAt && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs tabular-nums", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
            <CalendarDays className="size-3.5" /> {fmtDate(card.dueAt)}
          </span>
        )}
      </Link>
    </li>
  );
}

/** Mi trabajo: bandeja personal + planificador con las tareas de todos los tableros. */
export function MyWork() {
  const [completed, setCompleted] = useState(false);
  const [priority, setPriority] = useState("all");
  const [boardFilter, setBoardFilter] = useState("all");
  const q = useQuery({
    queryKey: ["my-work", completed],
    queryFn: () => api<{ cards: WorkCard[] }>(`/me/work?completed=${completed ? "week" : "none"}`),
    refetchInterval: 60_000,
  });
  const boards = useMemo(() => [...new Map((q.data?.cards ?? []).map((c) => [c.board.id, c.board])).values()], [q.data]);
  const groups = useMemo(() => {
    const now = new Date();
    const map = new Map<GroupKey, WorkCard[]>(GROUPS.map((g) => [g.key, []]));
    for (const c of q.data?.cards ?? []) {
      if (priority !== "all" && c.priority !== priority) continue;
      if (boardFilter !== "all" && c.board.id !== boardFilter) continue;
      map.get(groupOf(c, now))!.push(c);
    }
    for (const list of map.values()) list.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "") || PRIORITY_RANK[a.priority]! - PRIORITY_RANK[b.priority]!);
    return map;
  }, [q.data, priority, boardFilter]);
  const total = [...groups.values()].reduce((n, g) => n + g.length, 0);

  return (
    <div className="grid h-full min-h-0 gap-5 p-4 sm:p-6 lg:grid-cols-[22rem_1fr]">
      <InboxPanel />
      <section className="flex min-h-0 flex-col" aria-label="Planificador">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="display-title text-4xl">Mi trabajo</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tus tareas de todos los tableros, como responsable o colaborador.</p>
          </div>
          <Select aria-label="Filtrar por prioridad" className="h-9 w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="all">Todas las prioridades</option>
            {Object.entries(PRIORITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filtrar por tablero" className="h-9 w-auto max-w-56" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}>
            <option value="all">Todos los tableros</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.orgName})
              </option>
            ))}
          </Select>
          <label className="inline-flex h-9 items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={completed} onChange={(e) => setCompleted(e.target.checked)} />
            Completadas (7 días)
          </label>
        </div>
        {q.error ? (
          <ErrorState error={q.error} retry={q.refetch} />
        ) : !q.data ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 pb-6 scroll-thin">
            {GROUPS.map((g) => {
              const items = groups.get(g.key)!;
              if (items.length === 0) return null;
              return (
                <div key={g.key}>
                  <h2 className={cn("mb-2 flex items-center gap-2 text-sm font-semibold", g.key === "overdue" && "text-destructive")}>
                    {g.label} <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
                  </h2>
                  <ul className="space-y-2">
                    {items.map((c) => (
                      <WorkRow key={c.id} card={c} />
                    ))}
                  </ul>
                </div>
              );
            })}
            {total === 0 && (
              <div className="rounded-[2rem] border border-dashed p-10 text-center">
                <p className="text-lg">No tenés tareas pendientes 🎉</p>
                <p className="mt-1 text-sm text-muted-foreground">Cuando te asignen una tarea en cualquier tablero, va a aparecer acá.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
