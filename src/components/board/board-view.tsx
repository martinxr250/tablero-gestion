"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, Archive, Filter, Lock, MoreHorizontal, Plus, RotateCcw, Settings, SquareKanban, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useOrg, useSyncOrg } from "@/components/shell/org-context";
import { AvatarStack } from "@/components/ui/user-avatar";
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button, ErrorState, Input, Select, Skeleton, Spinner } from "@/components/ui/primitives";
import { describeActivity } from "@/lib/activity";
import { api, ApiError } from "@/lib/api";
import { asColor, PRIORITY, SWATCH_TEXT } from "@/lib/colors";
import { ago, dueState, fmtDateTime } from "@/lib/format";
import type { Activity, BoardData, CardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BoardSettingsDialog } from "./board-settings";
import { CardModal } from "./card-modal";
import { Kanban } from "./kanban";

type Filters = { text: string; member: string; label: string; due: string; priority: string };
const EMPTY: Filters = { text: "", member: "", label: "", due: "", priority: "" };

export function BoardView({ boardId }: { boardId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openCardId = params.get("card");
  const { me } = useOrg();
  const q = useQuery({ queryKey: ["board", boardId], queryFn: () => api<BoardData>(`/boards/${boardId}`) });
  useSyncOrg(q.data?.board.orgId);

  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"settings" | "archived" | "activity" | null>(null);
  const cursor = useRef<number | null>(null);

  useEffect(() => {
    if (q.data && (cursor.current === null || q.data.cursor > cursor.current)) cursor.current = q.data.cursor;
  }, [q.data]);

  // Sondeo de cambios cada 4 s mientras la pestaña está visible: casi tiempo real sin WebSockets.
  useQuery({
    queryKey: ["board-changes", boardId],
    enabled: !!q.data,
    refetchInterval: 4000,
    queryFn: async () => {
      if (cursor.current === null) return 0;
      const r = await api<{ cursor: number; changes: Activity[] }>(`/boards/${boardId}/changes?after=${cursor.current}`);
      if (r.changes.length === 0) return r.cursor;
      cursor.current = r.cursor;
      qc.invalidateQueries({ queryKey: ["board", boardId] });
      const touched = new Set(r.changes.map((c) => c.cardId).filter(Boolean) as string[]);
      for (const id of touched) {
        qc.invalidateQueries({ queryKey: ["card", id] });
        qc.invalidateQueries({ queryKey: ["comments", id] });
      }
      const others = r.changes.filter((c) => c.actorId && c.actorId !== me?.user.id);
      if (others.length) {
        const last = others[others.length - 1]!;
        toast(`${last.actorName ?? "Alguien"} ${describeActivity(last)}`, { description: others.length > 1 ? `y ${others.length - 1} cambio(s) más` : undefined });
        const ids = new Set(others.map((c) => c.cardId).filter(Boolean) as string[]);
        setHighlight(ids);
        setTimeout(() => setHighlight(new Set()), 4000);
      }
      return r.cursor;
    },
  });

  const openCard = useCallback((id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("card", id);
    else sp.delete("card");
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }, [params, pathname, router]);

  const filtering = Object.values(filters).some(Boolean);
  const visible = useMemo(() => {
    const text = filters.text.trim().toLowerCase();
    return (c: CardSummary) => {
      if (text && !c.title.toLowerCase().includes(text)) return false;
      if (filters.member && c.ownerId !== filters.member && !c.assigneeIds.includes(filters.member)) return false;
      if (filters.label && !c.labelIds.includes(filters.label)) return false;
      if (filters.priority && c.priority !== filters.priority) return false;
      if (filters.due) {
        const st = dueState(c.dueAt, !!c.completedAt);
        if (filters.due === "none" && c.dueAt) return false;
        if (filters.due === "overdue" && st !== "overdue") return false;
        if (filters.due === "soon" && st !== "soon") return false;
        if (filters.due === "done" && !c.completedAt) return false;
      }
      return true;
    };
  }, [filters]);

  const restore = useMutation({
    mutationFn: () => api(`/boards/${boardId}/archive`, { method: "POST", body: { archived: false } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", boardId] }),
  });

  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 404) return <ErrorState error={new Error("El tablero no existe o no tenés acceso.")} />;
    return <ErrorState error={q.error} retry={q.refetch} />;
  }
  if (!q.data) {
    return (
      <div className="flex gap-4 p-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-96 w-72" />
        ))}
      </div>
    );
  }

  const data = q.data;
  const canEdit = (data.role === "editor" || data.role === "admin") && !data.board.archivedAt;
  const isAdmin = data.role === "admin";
  const progress = data.cards.length ? Math.round((data.cards.filter((c) => c.completedAt).length / data.cards.length) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-5 pb-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-4">
          <nav aria-label="Ruta" className="flex min-w-0 items-center gap-2 text-xs font-medium">
            <Link href={`/w/${data.board.workspaceId}`} className="truncate rounded-lg bg-card px-2.5 py-1.5 shadow-card hover:text-primary">
              {data.board.workspaceName}
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate rounded-lg bg-card px-2.5 py-1.5 shadow-card">{data.board.name}</span>
          </nav>
          <span className="flex-1" />
          <AvatarStack users={data.people} max={3} size={32} />
          <div className="w-44">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Progreso: {progress}%</p>
            <div className="h-2.5 overflow-hidden rounded-full border bg-card p-px" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Tareas completadas">
              <div className="h-full rounded-full bg-[repeating-linear-gradient(135deg,var(--brand)_0_6px,color-mix(in_oklch,var(--brand),white_25%)_6px_12px)] transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <div className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-card shadow-card", SWATCH_TEXT[asColor(data.board.color)])}>
            <SquareKanban className="size-6" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{data.board.name}</h1>
              <span className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
                {data.board.visibility === "private" ? <Lock className="size-3" /> : <Users className="size-3" />}
                {data.board.visibility === "private" ? "Privado" : "Espacio"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{data.board.description || `${data.cards.length} tareas en ${data.lists.length} columnas`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FiltersButton data={data} filters={filters} setFilters={setFilters} />
            <Button variant="secondary" size="sm" onClick={() => setPanel("activity")}>
              <ActivityIcon /> <span className="hidden sm:inline">Actividad</span>
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="icon-sm" aria-label="Más opciones del tablero">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem onSelect={() => setPanel("archived")}>
                  <Archive /> Elementos archivados
                </MenuItem>
                {isAdmin && (
                  <MenuItem onSelect={() => setPanel("settings")}>
                    <Settings /> Configuración y miembros
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
            {canEdit && (
              <Button
                variant="brand"
                className="rounded-full"
                onClick={() => {
                  const el = document.getElementById("add-list-trigger");
                  el?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
                  el?.click();
                }}
              >
                <Plus /> Agregar columna
              </Button>
            )}
          </div>
        </div>
      </header>
      {data.board.archivedAt && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:mx-6 dark:bg-amber-500/15 dark:text-amber-100">
          Este tablero está archivado y es de solo lectura.
          {isAdmin && (
            <Button size="sm" variant="secondary" onClick={() => restore.mutate()} loading={restore.isPending}>
              <RotateCcw className="h-4 w-4" /> Restaurar
            </Button>
          )}
        </div>
      )}
      {filtering && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm text-primary sm:mx-6">
          <Filter className="h-4 w-4" /> Filtros activos. El arrastre se desactiva mientras filtrás.
          <button className="ml-auto font-medium hover:underline" onClick={() => setFilters(EMPTY)}>
            Limpiar
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Kanban data={data} canEdit={canEdit} visible={visible} filtering={filtering} highlight={highlight} onOpenCard={(id) => openCard(id)} />
      </div>
      {openCardId && <CardModal key={openCardId} cardId={openCardId} board={data} onClose={() => openCard(null)} />}
      {panel === "settings" && <BoardSettingsDialog data={data} onClose={() => setPanel(null)} />}
      {panel === "archived" && <ArchivedDialog data={data} canEdit={canEdit} onOpenCard={openCard} onClose={() => setPanel(null)} />}
      {panel === "activity" && <ActivityDialog boardId={boardId} onOpenCard={openCard} onClose={() => setPanel(null)} />}
    </div>
  );
}

function FiltersButton({ data, filters, setFilters }: { data: BoardData; filters: Filters; setFilters: (f: Filters) => void }) {
  const count = Object.values(filters).filter(Boolean).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={count ? "soft" : "secondary"} size="sm">
          <Filter className="h-4 w-4" /> Filtrar{count ? ` (${count})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <Input className="h-9" placeholder="Buscar por título…" aria-label="Buscar por título" value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} />
        <Select className="h-9" aria-label="Persona" value={filters.member} onChange={(e) => setFilters({ ...filters, member: e.target.value })}>
          <option value="">Cualquier persona</option>
          {data.people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select className="h-9" aria-label="Etiqueta" value={filters.label} onChange={(e) => setFilters({ ...filters, label: e.target.value })}>
          <option value="">Cualquier etiqueta</option>
          {data.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select className="h-9" aria-label="Vencimiento" value={filters.due} onChange={(e) => setFilters({ ...filters, due: e.target.value })}>
          <option value="">Cualquier vencimiento</option>
          <option value="overdue">Vencidas</option>
          <option value="soon">Vencen pronto (48 h)</option>
          <option value="none">Sin fecha</option>
          <option value="done">Completadas</option>
        </Select>
        <Select className="h-9" aria-label="Prioridad" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="">Cualquier prioridad</option>
          {Object.entries(PRIORITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>
            <X className="h-4 w-4" /> Limpiar filtros
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ArchivedDialog({ data, canEdit, onOpenCard, onClose }: { data: BoardData; canEdit: boolean; onOpenCard: (id: string) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["archived", data.board.id],
    queryFn: () => api<{ lists: { id: string; name: string; archivedAt: string }[]; cards: { id: string; title: string; listName: string; archivedAt: string }[] }>(`/boards/${data.board.id}/archived`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["archived", data.board.id] });
    qc.invalidateQueries({ queryKey: ["board", data.board.id] });
  };
  const restoreList = useMutation({ mutationFn: (id: string) => api(`/lists/${id}/archive`, { method: "POST", body: { archived: false } }), onSettled: refresh });
  const deleteList = useMutation({ mutationFn: (id: string) => api(`/lists/${id}`, { method: "DELETE" }), onSettled: refresh });
  const restoreCard = useMutation({ mutationFn: (id: string) => api(`/cards/${id}/archive`, { method: "POST", body: { archived: false } }), onSettled: refresh });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Elementos archivados" description="Se eliminan automáticamente a los 90 días.">
      {q.isLoading && <Spinner />}
      <h3 className="mb-2 text-sm font-semibold">Listas</h3>
      <ul className="mb-5 space-y-1">
        {q.data?.lists.map((l) => (
          <li key={l.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="flex-1 truncate">{l.name}</span>
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => restoreList.mutate(l.id)}>
                Restaurar
              </Button>
            )}
            {data.role === "admin" && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => confirm("¿Eliminar la lista y todas sus tarjetas?") && deleteList.mutate(l.id)}>
                Eliminar
              </Button>
            )}
          </li>
        ))}
        {q.data?.lists.length === 0 && <li className="text-sm text-muted-foreground">No hay listas archivadas.</li>}
      </ul>
      <h3 className="mb-2 text-sm font-semibold">Tarjetas</h3>
      <ul className="space-y-1">
        {q.data?.cards.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpenCard(c.id)}>
              {c.title} <span className="text-xs text-muted-foreground">· {c.listName}</span>
            </button>
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => restoreCard.mutate(c.id)}>
                Restaurar
              </Button>
            )}
          </li>
        ))}
        {q.data?.cards.length === 0 && <li className="text-sm text-muted-foreground">No hay tarjetas archivadas.</li>}
      </ul>
    </Dialog>
  );
}

function ActivityDialog({ boardId, onOpenCard, onClose }: { boardId: string; onOpenCard: (id: string) => void; onClose: () => void }) {
  const q = useInfiniteQuery({
    queryKey: ["board-activity", boardId],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api<{ entries: Activity[]; nextBefore: number | null }>(`/boards/${boardId}/activity${pageParam ? `?before=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.nextBefore,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Actividad del tablero">
      {q.isLoading && <Spinner />}
      <ul className="space-y-3">
        {q.data?.pages.flatMap((p) => p.entries).map((a) => (
          <li key={a.id} className="text-sm">
            <strong className="font-medium">{a.actorName ?? "Alguien"}</strong>{" "}
            {a.cardId ? (
              <button className="text-left text-muted-foreground hover:underline" onClick={() => onOpenCard(a.cardId!)}>
                {describeActivity(a)}
              </button>
            ) : (
              <span className="text-muted-foreground">{describeActivity(a)}</span>
            )}
            <span className="block text-xs text-muted-foreground" title={fmtDateTime(a.createdAt)}>
              {ago(a.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button variant="secondary" className="mt-4" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Cargar más
        </Button>
      )}
    </Dialog>
  );
}
