"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, Archive, CalendarDays, CheckCircle2, ChevronsDownUp, ChevronsUpDown, Copy, FileDown, Filter, Gauge, LayoutGrid, List as ListIcon, ListPlus, Milestone, Flame, GitBranch, Lock, MoreHorizontal, Plus, RefreshCw, RotateCcw, Settings, SquareKanban, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, ViewTransition } from "react";
import { toast } from "sonner";
import { useOrg, useSyncOrg } from "@/components/shell/org-context";
import { Avatar, AvatarStack } from "@/components/ui/user-avatar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button, ErrorState, Input, Select, Skeleton, Spinner } from "@/components/ui/primitives";
import { describeActivity } from "@/lib/activity";
import { api, ApiError } from "@/lib/api";
import { PRIORITY } from "@/lib/colors";
import { ago, dueState, fmtDateTime } from "@/lib/format";
import type { Activity, BoardData, CardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BoardSettingsDialog } from "./board-settings";
import { CardModal } from "./card-modal";
import { BulkDialog } from "./bulk-dialog";
import { Kanban } from "./kanban";
import { CalendarView } from "./views/calendar-view";
import { InsightsView } from "./views/insights-view";
import { ListView } from "./views/list-view";
import { SprintsView } from "./views/sprints-view";
import type { RepoInfo } from "./repo-settings";

// Preferencia "resumen del tablero contraído", guardada en el navegador. Contraído por defecto.
const HEADER_KEY = "tableros.boardHeaderCompact";
const HEADER_EVENT = "tableros:board-header";
function subscribeHeader(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(HEADER_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(HEADER_EVENT, cb);
  };
}
function readHeaderCompact() {
  try {
    return localStorage.getItem(HEADER_KEY) !== "0";
  } catch {
    return true;
  }
}
function setCompactHeader(value: boolean) {
  try {
    localStorage.setItem(HEADER_KEY, value ? "1" : "0");
  } catch {
    /* almacenamiento no disponible */
  }
  window.dispatchEvent(new Event(HEADER_EVENT));
}

type ViewKey = "board" | "list" | "calendar" | "sprints" | "insights";
const VIEWS: { key: ViewKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "board", label: "Tablero", icon: LayoutGrid },
  { key: "list", label: "Lista", icon: ListIcon },
  { key: "calendar", label: "Calendario", icon: CalendarDays },
  { key: "sprints", label: "Etapas", icon: Milestone },
  { key: "insights", label: "Panel del líder", icon: Gauge },
];

function DuplicateBoardDialog({ data, onClose }: { data: BoardData; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState(`${data.board.name} (copia)`);
  const [includeCards, setIncludeCards] = useState(true);
  const [asTemplate, setAsTemplate] = useState(false);
  const dup = useMutation({
    mutationFn: () => api<{ id: string }>(`/boards/${data.board.id}/duplicate`, { method: "POST", body: { name, includeCards, asTemplate } }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(asTemplate ? "Plantilla creada" : "Tablero duplicado");
      onClose();
      router.push(`/b/${id}`);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Duplicar tablero" description="Copia listas, etiquetas y la configuración de calidad. Los comentarios y archivos no se copian.">
      <div className="space-y-4">
        <Input aria-label="Nombre del tablero nuevo" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={includeCards} onChange={(e) => setIncludeCards(e.target.checked)} />
          Incluir las tarjetas (con checklists y subtareas)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={asTemplate} onChange={(e) => setAsTemplate(e.target.checked)} />
          Guardarlo como plantilla para crear tableros nuevos
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={dup.isPending} disabled={!name.trim()} onClick={() => dup.mutate()}>
            Duplicar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const LIST_SEGMENTS = ["bg-primary text-primary-foreground", "bg-chart-2 text-primary-foreground", "bg-brand text-brand-foreground", "bg-success text-primary-foreground"];

function BoardChip({ icon: Icon, label, value }: { icon: typeof Flame; label: string; value: string }) {
  return (
    <div className="pill-chip">
      <span className="flex size-10 items-center justify-center rounded-full border bg-card">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block text-sm">{value}</span>
      </span>
    </div>
  );
}

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
  const compactHeader = useSyncExternalStore(subscribeHeader, readHeaderCompact, () => true);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"settings" | "archived" | "activity" | "bulk" | "duplicate" | null>(null);
  const view = (VIEWS.some((v) => v.key === params.get("view")) ? params.get("view") : "board") as ViewKey;
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
    // Un espejo abre la tarjeta original.
    const target = id ? (q.data?.cards.find((c) => c.id === id)?.mirror?.cardId ?? id) : null;
    if (target) sp.set("card", target);
    else sp.delete("card");
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }, [params, pathname, router, q.data]);

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
  const compact = compactHeader;
  const completed = data.cards.filter((c) => c.completedAt).length;
  const overdue = data.cards.filter((c) => dueState(c.dueAt, !!c.completedAt) === "overdue").length;
  const progress = data.cards.length ? Math.round((completed / data.cards.length) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 pt-5 pb-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Ruta" className="flex min-w-0 items-center gap-2 text-xs font-medium">
            <Link href={`/w/${data.board.workspaceId}`} className="truncate rounded-full border bg-card px-3.5 py-2 hover:text-primary">
              {data.board.workspaceName}
            </Link>
            {!compact && <span className="truncate rounded-full border bg-card px-3.5 py-2">{data.board.name}</span>}
          </nav>
          {compact && (
            <span className="flex min-w-0 items-baseline gap-3">
              <span className="display-title truncate text-2xl">{data.board.name}</span>
              <span className="display-figure shrink-0 text-xl">
                {progress}
                <span className="dim">%</span>
              </span>
            </span>
          )}
          <RepoChip boardId={boardId} canSync={data.role !== "viewer"} />
          <span className="flex-1" />
          <AvatarStack users={data.people} max={3} size={36} />
          <div className="flex flex-wrap items-center gap-2">
            <FiltersButton data={data} filters={filters} setFilters={setFilters} />
            <Button variant="secondary" size="sm" onClick={() => setPanel("activity")}>
              <ActivityIcon /> <span className="hidden sm:inline">Actividad</span>
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={compact ? "Mostrar resumen del tablero" : "Contraer resumen del tablero"}
              aria-expanded={!compact}
              title={compact ? "Mostrar resumen" : "Contraer resumen"}
              onClick={() => setCompactHeader(!compact)}
            >
              {compact ? <ChevronsUpDown /> : <ChevronsDownUp />}
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="icon-sm" aria-label="Más opciones del tablero">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                {canEdit && (
                  <MenuItem onSelect={() => setPanel("bulk")}>
                    <ListPlus /> Carga masiva de tareas
                  </MenuItem>
                )}
                <MenuItem asChild>
                  <a href={`/api/v1/boards/${data.board.id}/export`} download>
                    <FileDown /> Exportar a planilla
                  </a>
                </MenuItem>
                <MenuItem onSelect={() => setPanel("duplicate")}>
                  <Copy /> Duplicar tablero
                </MenuItem>
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
          </div>
        </div>

        {!compact && (
          <>
        <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-5">
          <div className="min-w-0">
            <h1 className="display-title text-4xl break-words sm:text-5xl">{data.board.name}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-soft px-2 py-0.5 text-[10px] font-semibold tracking-wider text-brand uppercase">
                {data.board.visibility === "private" ? <Lock className="size-3" /> : <Users className="size-3" />}
                {data.board.visibility === "private" ? "Privado" : "Espacio"}
              </span>
              <span className="truncate">{data.board.description || `${data.cards.length} tareas en ${data.lists.length} columnas`}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 pb-1">
            <BoardChip icon={SquareKanban} label="Tareas" value={`${data.cards.length - completed} abiertas`} />
            <BoardChip icon={Flame} label="Vencidas" value={overdue > 0 ? String(overdue) : "Ninguna"} />
            <BoardChip icon={CheckCircle2} label="Completadas" value={String(completed)} />
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Progreso</p>
            <p className="display-figure text-6xl">
              {progress}
              <span className="dim">%</span>
            </p>
          </div>
        </div>

        {/* Barra segmentada: una franja por columna, proporcional a sus tarjetas */}
        <div className="mt-6 flex items-end gap-1.5">
          {data.lists.map((l, i) => {
            const count = data.cards.filter((c) => c.listId === l.id).length;
            return (
              <div key={l.id} className="min-w-20" style={{ flexGrow: Math.max(count / Math.max(data.cards.length, 1), 0.08), flexBasis: 0 }}>
                <span className="mb-1.5 block truncate px-1 text-xs text-muted-foreground">{l.name}</span>
                <span className={cn("flex h-10 items-center justify-end rounded-full p-1", count === 0 ? "hatched bg-muted" : LIST_SEGMENTS[i % LIST_SEGMENTS.length])}>
                  <span className="rounded-full bg-black/15 px-2.5 py-0.5 text-xs font-medium tabular-nums dark:bg-black/25">{count}</span>
                </span>
              </div>
            );
          })}
          {canEdit && (
            <Button
              variant="brand"
              className="h-10 shrink-0 rounded-full px-5"
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
          </>
        )}
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
      <nav aria-label="Vistas del tablero" className="mb-4 flex px-4 sm:px-6">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-full border bg-card p-1 scroll-thin">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              aria-current={view === v.key ? "page" : undefined}
              onClick={() => {
                const sp = new URLSearchParams(params.toString());
                if (v.key === "board") sp.delete("view");
                else sp.set("view", v.key);
                router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
              }}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                view === v.key && "bg-foreground text-background hover:text-background",
              )}
            >
              <v.icon className="size-4" aria-hidden /> {v.label}
            </button>
          ))}
        </div>
      </nav>
      <ViewTransition key={view} enter="page-enter" exit="page-exit" default="none">
        <div className="min-h-0 flex-1">
          {view === "board" && <Kanban data={data} canEdit={canEdit} visible={visible} filtering={filtering} highlight={highlight} onOpenCard={(id) => openCard(id)} />}
          {view === "list" && <ListView data={data} visible={visible} onOpenCard={(id) => openCard(id)} />}
          {view === "calendar" && <CalendarView data={data} visible={visible} onOpenCard={(id) => openCard(id)} />}
          {view === "sprints" && <SprintsView data={data} canEdit={canEdit} onOpenCard={(id) => openCard(id)} />}
          {view === "insights" && <InsightsView boardId={data.board.id} onOpenCard={(id) => openCard(id)} />}
        </div>
      </ViewTransition>
      <BulkDialog data={data} open={panel === "bulk"} onOpenChange={(o) => setPanel(o ? "bulk" : null)} />
      {panel === "duplicate" && <DuplicateBoardDialog data={data} onClose={() => setPanel(null)} />}
      {openCardId && <CardModal key={openCardId} cardId={openCardId} board={data} onClose={() => openCard(null)} onOpenCard={(id) => openCard(id)} />}
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
        <Input className="h-9" maxLength={100} placeholder="Buscar por título…" aria-label="Buscar por título" value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} />
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
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="flex items-center gap-2 text-lg font-bold">
            <ActivityIcon className="size-5 text-primary" /> Actividad del tablero
          </SheetTitle>
          <SheetDescription>Todos los cambios, del más reciente al más antiguo.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scroll-thin">
          {q.isLoading && <Spinner />}
          {!q.isLoading && entries.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay actividad.</p>}
          <ol className="relative space-y-5 border-l pl-6">
            {entries.map((a) => (
              <li key={a.id} className="relative text-sm">
                <span className="absolute top-0 -left-[2.4rem]">
                  <Avatar user={{ userId: a.actorId ?? String(a.id), name: a.actorName ?? "?" }} size={28} />
                </span>
                <strong className="font-semibold">{a.actorName ?? "Alguien"}</strong>{" "}
                {a.cardId ? (
                  <button
                    className="text-left text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => {
                      onClose();
                      onOpenCard(a.cardId!);
                    }}
                  >
                    {describeActivity(a)}
                  </button>
                ) : (
                  <span className="text-muted-foreground">{describeActivity(a)}</span>
                )}
                <span className="mt-0.5 block text-xs text-muted-foreground" title={fmtDateTime(a.createdAt)}>
                  {ago(a.createdAt)}
                </span>
              </li>
            ))}
          </ol>
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-6 w-full" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              Cargar más
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Estado del repositorio vinculado. Sin webhook (por ejemplo en local), sincroniza al abrir y cada 2 minutos. */
function RepoChip({ boardId, canSync }: { boardId: string; canSync: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["board-repo", boardId], queryFn: () => api<{ repo: RepoInfo | null }>(`/boards/${boardId}/repo`) });
  const repo = q.data?.repo;
  const runSync = async () => {
    await api(`/boards/${boardId}/repo/sync`, { method: "POST", body: {} });
    qc.invalidateQueries({ queryKey: ["board", boardId] });
    qc.invalidateQueries({ queryKey: ["board-repo", boardId] });
    return Date.now();
  };
  useQuery({
    queryKey: ["board-repo-autosync", boardId],
    queryFn: runSync,
    enabled: !!repo && !repo.webhook && canSync,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const manual = useMutation({ mutationFn: runSync, onSuccess: () => toast.success("Sincronizado con GitHub") });
  if (!repo) return null;
  const attention = repo.pending > 0 || repo.conflicts > 0 || !!repo.lastSyncError;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-xs font-medium shadow-card">
      <GitBranch className="size-3.5 text-primary" aria-hidden />
      <a href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" className="max-w-40 truncate hover:text-primary">
        {repo.fullName}
      </a>
      <span className={cn("size-1.5 rounded-full", attention ? "bg-amber-500" : "bg-success")} title={repo.lastSyncError ?? (attention ? "Hay cambios pendientes o conflictos" : "Sincronizado")} />
      {canSync && (
        <button className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Sincronizar con GitHub" title={repo.lastSyncedAt ? `Última sincronización ${ago(repo.lastSyncedAt)}` : "Sincronizar"} onClick={() => manual.mutate()}>
          <RefreshCw className={cn("size-3.5", manual.isPending && "animate-spin")} />
        </button>
      )}
    </span>
  );
}
