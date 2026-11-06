"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Mouse, trackpad y lápiz por eventos de puntero (funciona igual en Chrome, Safari, Firefox y Edge,
 * también con pantallas táctiles). El dedo queda para TouchSensor, que pide mantener presionado.
 */
class MousePenSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: e }: React.PointerEvent) => e.isPrimary && e.button === 0 && e.pointerType !== "touch",
    },
  ];
}
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, GripVertical, MoreHorizontal, Palette, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ColorPicker } from "@/components/ui/color-picker";
import { Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { asColor, SWATCH } from "@/lib/colors";
import type { BoardData, CardSummary, Label, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CardFieldsContext, CardTile } from "./card-tile";

const LIST_PREFIX = "L:";
const isListId = (id: string) => id.startsWith(LIST_PREFIX);
const listKey = (id: string) => `${LIST_PREFIX}${id}`;

type Props = {
  data: BoardData;
  canEdit: boolean;
  visible: (card: CardSummary) => boolean;
  filtering: boolean;
  highlight: Set<string>;
  onOpenCard: (id: string) => void;
};

export function Kanban({ data, canEdit, visible, filtering, highlight, onOpenCard }: Props) {
  const qc = useQueryClient();
  const boardKey = ["board", data.board.id];
  const [listOrder, setListOrder] = useState<string[]>([]);
  const [columns, setColumns] = useState<Record<string, string[]>>({});
  const [active, setActive] = useState<{ type: "card" | "list"; id: string } | null>(null);
  const dragging = useRef(false);
  const origin = useRef<{ list: string; index: number } | null>(null);

  const cardsById = useMemo(() => new Map(data.cards.map((c) => [c.id, c])), [data.cards]);
  // Los espejos usan etiquetas y personas de su tablero original.
  const labels = useMemo(() => new Map<string, Label>([...data.external.labels, ...data.labels].map((l) => [l.id, l])), [data.labels, data.external]);
  const people = useMemo(() => new Map<string, Person>([...data.external.people, ...data.people].map((p) => [p.userId, p])), [data.people, data.external]);
  const tileFields = useMemo(() => [...data.fields, ...data.external.fields], [data.fields, data.external]);
  const listsById = useMemo(() => new Map(data.lists.map((l) => [l.id, l])), [data.lists]);

  const syncFromData = useCallback(() => {
    setListOrder(data.lists.map((l) => l.id));
    const cols: Record<string, string[]> = Object.fromEntries(data.lists.map((l) => [l.id, []]));
    for (const c of data.cards) cols[c.listId]?.push(c.id);
    setColumns(cols);
  }, [data]);

  useEffect(() => {
    if (!dragging.current) syncFromData();
  }, [syncFromData]);

  const moveCard = useMutation({
    mutationFn: (v: { cardId: string; listId: string; afterCardId: string | null }) =>
      api(cardsById.get(v.cardId)?.mirror ? `/mirrors/${v.cardId}/move` : `/cards/${v.cardId}/move`, {
        method: "POST",
        body: { listId: v.listId, afterCardId: v.afterCardId },
      }),
    onError: () => syncFromData(),
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey }),
  });
  const moveList = useMutation({
    mutationFn: (v: { listId: string; afterListId: string | null }) => api(`/lists/${v.listId}/move`, { method: "POST", body: { afterListId: v.afterListId } }),
    onError: () => syncFromData(),
    onSettled: () => qc.invalidateQueries({ queryKey: boardKey }),
  });

  const sensors = useSensors(
    // Mouse: arrastra al moverse 6 px. Táctil: mantener presionado un instante, así el dedo
    // puede desplazar el tablero sin agarrar tarjetas por accidente.
    useSensor(MousePenSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const findList = (id: string) => (isListId(id) ? id.slice(LIST_PREFIX.length) : Object.keys(columns).find((k) => columns[k]!.includes(id)));

  function onDragStart(e: DragStartEvent) {
    dragging.current = true;
    const id = String(e.active.id);
    if (isListId(id)) setActive({ type: "list", id: id.slice(LIST_PREFIX.length) });
    else {
      const list = findList(id)!;
      origin.current = { list, index: columns[list]!.indexOf(id) };
      setActive({ type: "card", id });
    }
  }

  function onDragOver(e: DragOverEvent) {
    const activeId = String(e.active.id);
    if (!e.over || isListId(activeId)) return;
    const overId = String(e.over.id);
    const from = findList(activeId);
    const to = findList(overId);
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const fromItems = cols[from]!.filter((x) => x !== activeId);
      const toItems = [...cols[to]!];
      const overIndex = isListId(overId) ? toItems.length : toItems.indexOf(overId);
      toItems.splice(overIndex < 0 ? toItems.length : overIndex, 0, activeId);
      return { ...cols, [from]: fromItems, [to]: toItems };
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    setActive(null);
    dragging.current = false;
    if (!overId) return syncFromData();

    if (isListId(activeId)) {
      const from = listOrder.indexOf(activeId.slice(LIST_PREFIX.length));
      const to = listOrder.indexOf(findList(overId) ?? "");
      if (from < 0 || to < 0 || from === to) return;
      const next = arrayMove(listOrder, from, to);
      setListOrder(next);
      moveList.mutate({ listId: next[to]!, afterListId: to === 0 ? null : next[to - 1]! });
      return;
    }

    const list = findList(activeId);
    if (!list) return syncFromData();
    let items = columns[list]!;
    const oldIndex = items.indexOf(activeId);
    const overIndex = isListId(overId) ? items.length - 1 : items.indexOf(overId);
    if (overIndex >= 0 && oldIndex !== overIndex) {
      items = arrayMove(items, oldIndex, overIndex);
      setColumns((cols) => ({ ...cols, [list]: items }));
    }
    const index = items.indexOf(activeId);
    if (origin.current && origin.current.list === list && origin.current.index === index) return;
    moveCard.mutate({ cardId: activeId, listId: list, afterCardId: index === 0 ? null : items[index - 1]! });
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Tomaste ${describe(String(active.id))}.`,
    onDragOver: ({ active, over }) => (over ? `${describe(String(active.id))} está sobre ${describe(String(over.id))}.` : `${describe(String(active.id))} fuera de una lista.`),
    onDragEnd: ({ active, over }) => (over ? `Soltaste ${describe(String(active.id))} en ${describe(String(over.id))}.` : "Movimiento cancelado."),
    onDragCancel: ({ active }) => `Se canceló el movimiento de ${describe(String(active.id))}.`,
  };
  function describe(id: string) {
    if (isListId(id)) return `la lista ${listsById.get(id.slice(LIST_PREFIX.length))?.name ?? ""}`;
    return `la tarjeta ${cardsById.get(id)?.title ?? ""}`;
  }

  const dndEnabled = canEdit && !filtering;

  return (
    <CardFieldsContext value={tileFields}>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        dragging.current = false;
        setActive(null);
        syncFromData();
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "Para mover, presioná Espacio. Usá las flechas para cambiar la posición y Espacio de nuevo para soltar. Escape cancela. Enter abre la tarjeta.",
        },
      }}
    >
      <div className="flex h-full items-start gap-4 overflow-x-auto px-4 pb-6 pt-1 scroll-thin sm:px-6">
        <SortableContext items={listOrder.map(listKey)} strategy={horizontalListSortingStrategy}>
          {listOrder.map((listId) => {
            const list = listsById.get(listId);
            if (!list) return null;
            const ids = (columns[listId] ?? []).filter((id) => {
              const c = cardsById.get(id);
              return c && visible(c);
            });
            return (
              <ListColumn
                key={listId}
                boardId={data.board.id}
                list={list}
                cardIds={ids}
                total={columns[listId]?.length ?? 0}
                cardsById={cardsById}
                labels={labels}
                people={people}
                canEdit={canEdit}
                dndEnabled={dndEnabled}
                highlight={highlight}
                activeId={active?.id}
                onOpenCard={onOpenCard}
              />
            );
          })}
        </SortableContext>
        {canEdit && <AddList boardId={data.board.id} afterListId={listOrder[listOrder.length - 1] ?? null} />}
      </div>
      <DragOverlay>
        {active?.type === "card" && cardsById.get(active.id) ? (
          <div className="w-[17.5rem]">
            <CardTile card={cardsById.get(active.id)!} labels={labels} people={people} dragging />
          </div>
        ) : active?.type === "list" ? (
          <div className="w-[19rem] rounded-3xl border border-brand bg-card p-4 font-bold shadow-xl">{listsById.get(active.id)?.name}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
    </CardFieldsContext>
  );
}

function ListColumn({
  boardId,
  list,
  cardIds,
  total,
  cardsById,
  labels,
  people,
  canEdit,
  dndEnabled,
  highlight,
  activeId,
  onOpenCard,
}: {
  boardId: string;
  list: BoardData["lists"][number];
  cardIds: string[];
  total: number;
  cardsById: Map<string, CardSummary>;
  labels: Map<string, Label>;
  people: Map<string, Person>;
  canEdit: boolean;
  dndEnabled: boolean;
  highlight: Set<string>;
  activeId?: string;
  onOpenCard: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { setNodeRef, attributes, listeners, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: listKey(list.id),
    disabled: !dndEnabled,
  });
  // El arrastre de la lista se ignora si empieza en un campo o botón de la cabecera.
  const fromControl = (target: EventTarget) => target instanceof HTMLElement && !!target.closest("input, textarea, select, button, a");
  const headerListeners = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!fromControl(e.target)) listeners?.onPointerDown?.(e);
    },
    onTouchStart: (e: React.TouchEvent) => {
      if (!fromControl(e.target)) listeners?.onTouchStart?.(e);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target === e.currentTarget) listeners?.onKeyDown?.(e);
    },
  };
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.name);
  const [adding, setAdding] = useState(false);
  const startRename = () => {
    setName(list.name);
    setRenaming(true);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["board", boardId] });
  const update = useMutation({ mutationFn: (body: { name?: string; color?: string }) => api(`/lists/${list.id}`, { method: "PATCH", body }), onSettled: invalidate });
  const archive = useMutation({ mutationFn: () => api(`/lists/${list.id}/archive`, { method: "POST", body: { archived: true } }), onSettled: invalidate });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex max-h-full w-[19rem] shrink-0 flex-col rounded-[2rem] border pb-2 bg-card/70 shadow-card backdrop-blur-sm dark:bg-card", isDragging && "opacity-40")}
      aria-label={`Lista ${list.name}`}
    >
      {/* Toda la cabecera sirve para arrastrar la lista; los botones internos siguen funcionando
          porque el arrastre recién empieza tras mover el puntero unos píxeles. */}
      <header
        ref={dndEnabled ? setActivatorNodeRef : undefined}
        {...(dndEnabled ? { ...attributes, ...headerListeners, "aria-label": `Lista ${list.name}. Presioná Espacio para moverla.` } : {})}
        className={cn("flex items-center gap-2 rounded-t-[2rem] px-4 pb-3 pt-4 outline-none focus-visible:ring-2 focus-visible:ring-ring", dndEnabled && "cursor-grab select-none active:cursor-grabbing")}
      >
        {dndEnabled && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className={cn("size-2 shrink-0 rounded-full", SWATCH[asColor(list.color)])} aria-hidden />
        {renaming ? (
          <form
            className="flex-1"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim() && name !== list.name) update.mutate({ name: name.trim() });
              setRenaming(false);
            }}
          >
            <Input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => setRenaming(false)} className="h-8" aria-label="Nombre de la lista" />
          </form>
        ) : (
          <h2 className="min-w-0 truncate text-base font-bold" onDoubleClick={() => canEdit && startRename()}>
            {list.name}
          </h2>
        )}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">{cardIds.length === total ? total : `${cardIds.length}/${total}`}</span>
        <span className="flex-1" />
        {canEdit && (
          <button
            onClick={() => setAdding(true)}
            className="flex h-8 w-11 items-center justify-center rounded-xl border border-dashed text-muted-foreground hover:border-primary/40 hover:text-primary"
            aria-label={`Agregar tarjeta en ${list.name}`}
          >
            <Plus className="size-4" />
          </button>
        )}
        {canEdit && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Opciones de ${list.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={startRename}>
                <Pencil className="h-4 w-4" /> Renombrar
              </MenuItem>
              <MenuItem onSelect={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Agregar tarjeta
              </MenuItem>
              <ListColorItem current={list.color} onPick={(color) => update.mutate({ color })} />
              <MenuItem danger onSelect={() => archive.mutate()}>
                <Archive className="h-4 w-4" /> Archivar lista
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </header>
      <div className="column-scroll min-h-2 flex-1 space-y-3 overflow-y-auto px-3 pt-1 pb-12 scroll-thin">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cardIds.map((id) => (
            <SortableCard
              key={id}
              card={cardsById.get(id)!}
              labels={labels}
              people={people}
              disabled={!dndEnabled}
              highlighted={highlight.has(id)}
              hidden={activeId === id}
              onOpen={() => onOpenCard(id)}
            />
          ))}
        </SortableContext>
        {cardIds.length === 0 && <div className="rounded-2xl border border-dashed py-8 text-center text-xs text-muted-foreground">Sin tarjetas</div>}
      </div>
      {canEdit && <AddCard listId={list.id} boardId={boardId} open={adding} setOpen={setAdding} />}
    </section>
  );
}

function ListColorItem({ current, onPick }: { current: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <MenuItem
          onSelect={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
        >
          <Palette className="h-4 w-4" /> Color
        </MenuItem>
      </PopoverTrigger>
      <PopoverContent side="right" className="w-auto">
        <ColorPicker
          value={current}
          onChange={(c) => {
            onPick(c);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function SortableCard({
  card,
  labels,
  people,
  disabled,
  highlighted,
  hidden,
  onOpen,
}: {
  card: CardSummary;
  labels: Map<string, Label>;
  people: Map<string, Person>;
  disabled: boolean;
  highlighted: boolean;
  hidden: boolean;
  onOpen: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition } = useSortable({ id: card.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-roledescription="tarjeta"
      aria-label={card.title}
      onClick={onOpen}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
      // Sin selección de texto: si no, el navegador empieza a seleccionar y le gana al arrastre.
      className={cn("cursor-pointer rounded-2xl outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring", hidden && "opacity-30")}
    >
      <CardTile card={card} labels={labels} people={people} highlighted={highlighted} />
    </div>
  );
}

function AddCard({ listId, boardId, open, setOpen }: { listId: string; boardId: string; open: boolean; setOpen: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => api(`/lists/${listId}/cards`, { method: "POST", body: { title: title.trim() } }),
    onSuccess: () => setTitle(""),
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", boardId] }),
  });
  // Se abre desde el botón "+" del encabezado de la lista.
  if (!open) return null;
  return (
    <form
      className="space-y-2 px-3 pb-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (title.trim()) create.mutate();
      }}
    >
      <Textarea
        autoFocus
        rows={2}
        maxLength={200}
        placeholder="Título de la tarjeta"
        aria-label="Título de la nueva tarjeta"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (title.trim() && !create.isPending) create.mutate(); // sin doble envío
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={create.isPending} disabled={!title.trim()}>
          Agregar
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

function AddList({ boardId, afterListId }: { boardId: string; afterListId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api(`/boards/${boardId}/lists`, { method: "POST", body: { name: name.trim(), afterListId } }),
    onSuccess: () => setName(""),
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", boardId] }),
  });
  if (!open) {
    return (
      <button id="add-list-trigger" onClick={() => setOpen(true)} className="flex w-[19rem] shrink-0 items-center gap-2 rounded-3xl border border-dashed px-4 py-4 text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground">
        <Plus className="h-4 w-4" /> Agregar lista
      </button>
    );
  }
  return (
    <form
      className="w-[19rem] shrink-0 space-y-2 rounded-3xl border bg-card p-4 shadow-card"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (name.trim()) create.mutate();
      }}
    >
      <Input autoFocus placeholder="Nombre de la lista" aria-label="Nombre de la lista" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={create.isPending} disabled={!name.trim()}>
          Agregar lista
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
