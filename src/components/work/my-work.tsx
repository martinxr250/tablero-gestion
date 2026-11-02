"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isBefore, isSameDay, startOfDay } from "date-fns";
import { Ban, CalendarDays, CheckCircle2, Circle, CircleX, Eye, Flag, Inbox, Plus, Send, Trash2 } from "lucide-react";
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

type Delivery = "pending" | "in_development" | "in_review" | "ready" | "done" | "blocked";
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
  sprintName: string | null;
  reviewPending: boolean;
  checksFailed: boolean;
  delivery: Delivery;
  board: { id: string; name: string; color: string; orgName: string };
};
type InboxItem = { id: string; title: string; dueOn: string | null; done: boolean; createdAt: string };

// Secciones en el orden pedido; cada tarea cae en una sola (la primera que le corresponde por prioridad).
const SECTIONS = [
  { key: "today", label: "Para hoy" },
  { key: "upcoming", label: "Próximas" },
  { key: "overdue", label: "Vencidas" },
  { key: "progress", label: "En progreso" },
  { key: "blocked", label: "Bloqueadas" },
  { key: "review", label: "Esperando revisión" },
  { key: "done", label: "Completadas recientemente" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const DELIVERY_LABEL: Record<Delivery, string> = {
  pending: "Pendiente",
  in_development: "En desarrollo",
  in_review: "En revisión",
  ready: "Lista para entrega",
  done: "Terminada",
  blocked: "Bloqueada",
};

function sectionOf(card: WorkCard, now: Date): SectionKey {
  if (card.completedAt) return "done";
  if (card.blocked) return "blocked";
  if (card.reviewPending || card.delivery === "in_review") return "review";
  const today = startOfDay(now);
  if (card.dueAt && isBefore(new Date(card.dueAt), today)) return "overdue";
  if (card.dueAt && isSameDay(new Date(card.dueAt), today)) return "today";
  if (card.delivery === "in_development" || card.delivery === "ready") return "progress";
  return "upcoming";
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
            {card.board.orgName} · {card.board.name} · {card.listName}
            {card.sprintName && ` · ${card.sprintName}`}
            {!card.isOwner && " · colaborás"}
          </p>
        </div>
        <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground md:inline" title="Estado de entrega">
          {DELIVERY_LABEL[card.delivery]}
        </span>
        {card.blocked && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive" title="Bloqueada por otra tarea">
            <Ban className="size-3.5" /> <span className="hidden sm:inline">Bloqueada</span>
          </span>
        )}
        {card.reviewPending && !card.completedAt && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-300" title="Esperando revisión (código o QA)">
            <Eye className="size-3.5" /> <span className="hidden sm:inline">Revisión</span>
          </span>
        )}
        {card.checksFailed && !card.completedAt && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-destructive" title="Checks de CI fallidos">
            <CircleX className="size-3.5" /> <span className="hidden sm:inline">CI</span>
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

/** Mi trabajo: bandeja personal + tareas de todos los tableros por sección, con filtro, orden y agrupación. */
export function MyWork() {
  const [priority, setPriority] = useState("all");
  const [boardFilter, setBoardFilter] = useState("all");
  const [onlyOwner, setOnlyOwner] = useState(false);
  const [groupBy, setGroupBy] = useState<"section" | "board" | "priority">("section");
  const [sortBy, setSortBy] = useState<"due" | "priority">("due");
  const q = useQuery({
    queryKey: ["my-work"],
    queryFn: () => api<{ cards: WorkCard[] }>("/me/work?completed=week"),
    refetchInterval: 60_000,
  });
  const boards = useMemo(() => [...new Map((q.data?.cards ?? []).map((c) => [c.board.id, c.board])).values()], [q.data]);
  const groups = useMemo(() => {
    const now = new Date();
    const cards = (q.data?.cards ?? []).filter(
      (c) => (priority === "all" || c.priority === priority) && (boardFilter === "all" || c.board.id === boardFilter) && (!onlyOwner || c.isOwner),
    );
    const cmp = (a: WorkCard, b: WorkCard) =>
      sortBy === "priority"
        ? PRIORITY_RANK[a.priority]! - PRIORITY_RANK[b.priority]! || (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~")
        : (a.dueAt ?? "~").localeCompare(b.dueAt ?? "~") || PRIORITY_RANK[a.priority]! - PRIORITY_RANK[b.priority]!;
    const out: { key: string; label: string; tone?: string; items: WorkCard[] }[] = [];
    if (groupBy === "section") {
      for (const sct of SECTIONS) out.push({ key: sct.key, label: sct.label, tone: sct.key === "overdue" || sct.key === "blocked" ? "text-destructive" : undefined, items: [] });
      for (const c of cards) out.find((g) => g.key === sectionOf(c, now))!.items.push(c);
    } else if (groupBy === "board") {
      for (const b of boards) out.push({ key: b.id, label: `${b.name} · ${b.orgName}`, items: cards.filter((c) => c.board.id === b.id) });
    } else {
      for (const [k, v] of Object.entries(PRIORITY)) out.push({ key: k, label: v.label, items: cards.filter((c) => c.priority === k) });
    }
    for (const g of out) g.items.sort(cmp);
    return out.filter((g) => g.items.length > 0);
  }, [q.data, priority, boardFilter, onlyOwner, groupBy, sortBy, boards]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="grid h-full min-h-0 gap-5 p-4 sm:p-6 lg:grid-cols-[22rem_1fr]">
      <InboxPanel />
      <section className="flex min-h-0 flex-col" aria-label="Mis tareas">
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="mr-auto">
            <h1 className="display-title text-4xl">Mi trabajo</h1>
            <p className="mt-1 text-sm text-muted-foreground">Tus tareas de todas las organizaciones y tableros, como responsable o colaborador.</p>
          </div>
          <Select aria-label="Agrupar por" className="h-9 w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="section">Agrupar por estado</option>
            <option value="board">Agrupar por tablero</option>
            <option value="priority">Agrupar por prioridad</option>
          </Select>
          <Select aria-label="Ordenar por" className="h-9 w-auto" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
            <option value="due">Ordenar por vencimiento</option>
            <option value="priority">Ordenar por prioridad</option>
          </Select>
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
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={onlyOwner} onChange={(e) => setOnlyOwner(e.target.checked)} />
            Solo donde soy responsable
          </label>
        </div>
        {q.error ? (
          <ErrorState error={q.error} retry={q.refetch} />
        ) : !q.data ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 pb-6 scroll-thin">
            {groups.map((g) => (
              <div key={g.key}>
                <h2 className={cn("mb-2 flex items-center gap-2 text-sm font-semibold", g.tone)}>
                  {g.label} <span className="text-xs font-normal text-muted-foreground">{g.items.length}</span>
                </h2>
                <ul className="space-y-2">
                  {g.items.map((c) => (
                    <WorkRow key={c.id} card={c} />
                  ))}
                </ul>
              </div>
            ))}
            {total === 0 && (
              <div className="rounded-[2rem] border border-dashed p-10 text-center">
                <p className="text-lg">No tenés tareas con estos filtros</p>
                <p className="mt-1 text-sm text-muted-foreground">Cuando te asignen una tarea en cualquier tablero, va a aparecer acá.</p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
