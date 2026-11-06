"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JSONContent } from "@tiptap/react";
import {
  Archive, ArrowRightLeft, Copy, Calendar, CheckCircle2, CheckSquare, Circle, Download, Flag, History, Link2, MessageSquare,
  Paperclip, Plus, RotateCcw, Tag, Trash2, Upload, UserRound, Users, X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/user-avatar";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Badge, Button, Input, Select, Skeleton, Spinner, Textarea } from "@/components/ui/primitives";
import { describeActivity } from "@/lib/activity";
import { api, ApiError } from "@/lib/api";
import { asColor, CHIP, PRIORITY, type ColorName } from "@/lib/colors";
import { ago, dueState, fmtDateTime, toLocalInput } from "@/lib/format";
import type { Activity, BoardData, BoardRole, CardDetail, Comment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CardFields } from "./card-fields";
import { CardBanners, CompletionPanel, PlanningSidebar, QaPanel, Subtasks } from "./card-planning";
import { DevPanel } from "./dev-panel";
import { RichEditor } from "./rich-editor";

const RELATION_LABEL: Record<string, { out: string; in: string }> = {
  blocks: { out: "Bloquea a", in: "Bloqueada por" },
  relates: { out: "Relacionada con", in: "Relacionada con" },
  duplicates: { out: "Duplica a", in: "Duplicada por" },
};

export function CardModal({ cardId, board: viewBoard, onClose, onOpenCard }: { cardId: string; board: BoardData; onClose: () => void; onOpenCard: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["card", cardId], queryFn: () => api<{ card: CardDetail; role: BoardRole }>(`/cards/${cardId}`) });
  const card = q.data?.card;
  // Abierta desde un espejo: listas, etiquetas y personas son las del tablero original.
  const isMirror = !!card && card.boardId !== viewBoard.board.id;
  const source = useQuery({ queryKey: ["board", card?.boardId], queryFn: () => api<BoardData>(`/boards/${card!.boardId}`), enabled: isMirror });
  const board = (isMirror ? source.data : viewBoard) ?? viewBoard;
  const loadingSource = isMirror && !source.data;
  const descriptionDirty = useRef(false);
  const canEdit = (q.data?.role === "editor" || q.data?.role === "admin") && !board.board.archivedAt;
  const canComment = canEdit || (q.data?.role === "commenter" && !board.board.archivedAt);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["card", cardId] });
    // También los tableros donde la tarjeta está espejada.
    qc.invalidateQueries({ queryKey: ["board"] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ card: CardDetail }>(`/cards/${cardId}`, { method: "PATCH", body }),
    onSuccess: (r) => qc.setQueryData(["card", cardId], (old: { card: CardDetail; role: BoardRole } | undefined) => (old ? { ...old, card: r.card } : old)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["board"] }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && (!descriptionDirty.current || confirm("Tenés cambios sin guardar en la descripción. ¿Cerrar igual?")) && onClose()} wide className="border bg-background sm:max-w-5xl dark:border-white/10" title={card ? <CardTitle key={card.title} card={card} canEdit={canEdit} onSave={(title) => patch.mutate({ title })} /> : "Cargando…"}>
      {q.error ? (
        <p className="text-sm text-destructive">{q.error instanceof ApiError && q.error.status === 404 ? "La tarjeta no existe o no tenés acceso." : (q.error as Error).message}</p>
      ) : !card || loadingSource ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          {/* Cada sección es una tarjeta propia sobre el fondo del modal: así se distingue qué es qué. */}
          <div className="min-w-0 space-y-4 [&>section]:rounded-2xl [&>section]:border [&>section]:bg-card [&>section]:p-5">
            <p className="-mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs font-medium text-foreground">
                <span className="size-1.5 rounded-full bg-primary" /> {card.listName}
              </span>
              {card.createdByName && <span>creada por {card.createdByName}</span>}
              <span>· {ago(card.createdAt)}</span>
            </p>
            {card.archivedAt && (
              <div className="rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-100">
                Esta tarjeta está archivada.
              </div>
            )}
            {isMirror && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-primary-soft px-4 py-2.5 text-sm text-primary">
                <Copy className="size-4" /> Estás viendo un espejo. La tarjeta pertenece a
                <Link href={`/b/${board.board.id}?card=${card.id}`} className="font-semibold underline-offset-2 hover:underline">
                  {board.board.name}
                </Link>
                y los cambios se ven en todos los tableros.
              </div>
            )}
            <CardBanners card={card} onOpenCard={onOpenCard} />
            <MetaRow card={card} board={board} />
            <QaPanel card={card} board={board} canEdit={canEdit} refresh={refresh} />
            <CompletionPanel card={card} />
            <CardFields card={card} board={board} canEdit={canEdit} refresh={refresh} />
            <Description card={card} canEdit={canEdit} dirtyRef={descriptionDirty} onSave={(description) => patch.mutateAsync({ description, expectedUpdatedAt: card.updatedAt })} />
            <Subtasks card={card} board={board} canEdit={canEdit} refresh={refresh} onOpenCard={onOpenCard} />
            <Checklists card={card} canEdit={canEdit} refresh={refresh} />
            <Attachments card={card} canEdit={canEdit} refresh={refresh} />
            <Relations card={card} canEdit={canEdit} refresh={refresh} />
            <DevPanel cardId={card.id} boardId={board.board.id} canEdit={canEdit} />
            <Comments cardId={card.id} board={board} canComment={canComment} canModerate={q.data?.role === "admin"} />
          </div>
          <Sidebar card={card} board={board} canEdit={canEdit} patch={(b) => patch.mutate(b)} refresh={refresh} onClose={onClose} onOpenCard={onOpenCard} />
        </div>
      )}
    </Dialog>
  );
}

function CardTitle({ card, canEdit, onSave }: { card: CardDetail; canEdit: boolean; onSave: (t: string) => void }) {
  const [value, setValue] = useState(card.title);
  if (!canEdit) return <span className="block text-2xl font-semibold tracking-tight">{card.title}</span>;
  return (
    <span className="block">
      <input
        aria-label="Título de la tarjeta"
        className="w-full rounded-xl bg-transparent px-1.5 py-0.5 text-2xl font-semibold tracking-tight outline-none hover:bg-muted/60 focus:bg-muted"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          // Un título vacío no se guarda: vuelve al anterior.
          if (!value.trim()) setValue(card.title);
          else if (value.trim() !== card.title) onSave(value.trim());
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

function SectionTitle({ icon: Icon, children, action }: { icon: typeof Users; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="flex-1 text-sm font-semibold">{children}</h3>
      {action}
    </div>
  );
}

function MetaRow({ card, board }: { card: CardDetail; board: BoardData }) {
  const people = new Map(board.people.map((p) => [p.userId, p]));
  const labels = new Map(board.labels.map((l) => [l.id, l]));
  const owner = card.ownerId ? people.get(card.ownerId) : null;
  const due = dueState(card.dueAt, !!card.completedAt);
  const p = PRIORITY[card.priority] ?? PRIORITY.none!;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border text-sm sm:grid-cols-5 [&>div]:min-w-0 [&>div]:bg-card [&>div]:px-4 [&>div]:py-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Responsable</p>
        {owner ? (
          <span className="flex items-center gap-2">
            <Avatar user={owner} size={24} /> {owner.name}
          </span>
        ) : (
          <span className="text-muted-foreground">Sin responsable</span>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Colaboradores</p>
        <div className="flex -space-x-1.5">
          {card.assigneeIds.map((id) => people.get(id)).filter(Boolean).map((u) => <Avatar key={u!.userId} user={u!} size={26} />)}
          {card.assigneeIds.length === 0 && <span className="text-muted-foreground">Nadie</span>}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Etiquetas</p>
        <div className="flex flex-wrap gap-1">
          {card.labelIds.map((id) => labels.get(id)).filter(Boolean).map((l) => (
            <Badge key={l!.id} className={CHIP[asColor(l!.color)]}>
              {l!.name}
            </Badge>
          ))}
          {card.labelIds.length === 0 && <span className="text-muted-foreground">—</span>}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Vencimiento</p>
        {card.dueAt ? (
          <Badge
            className={cn(
              "text-xs",
              due === "overdue" && "bg-destructive/10 text-destructive",
              due === "soon" && CHIP.amber,
              due === "done" && CHIP.green,
              due === "later" && "bg-muted",
            )}
          >
            {fmtDateTime(card.dueAt)} {due === "overdue" && "· vencida"}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Prioridad</p>
        <Badge className={p.chip}>{p.label}</Badge>
      </div>
    </div>
  );
}

function Description({ card, canEdit, onSave, dirtyRef }: { card: CardDetail; canEdit: boolean; onSave: (d: JSONContent | null) => Promise<unknown>; dirtyRef: { current: boolean } }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JSONContent | null>(null);
  const [saving, setSaving] = useState(false);
  // Cambios sin guardar: se avisa antes de salir de la página.
  useEffect(() => {
    if (!editing) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, dirtyRef]);
  const stopEditing = () => {
    dirtyRef.current = false;
    setDraft(null);
    setEditing(false);
  };
  const empty = !card.description;
  return (
    <section>
      <SectionTitle
        icon={MessageSquare}
        action={
          canEdit && !editing && (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )
        }
      >
        Descripción
      </SectionTitle>
      {editing ? (
        <div className="space-y-2">
          <RichEditor
            value={card.description}
            editable
            onChange={(d) => {
              dirtyRef.current = true;
              setDraft(d);
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const isEmpty = draft && JSON.stringify(draft) === '{"type":"doc","content":[{"type":"paragraph"}]}';
                  await onSave(isEmpty ? null : (draft ?? (card.description as JSONContent)));
                  stopEditing();
                } finally {
                  setSaving(false);
                }
              }}
            >
              Guardar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => (!dirtyRef.current || confirm("¿Descartar los cambios de la descripción?")) && stopEditing()}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : empty ? (
        <button
          disabled={!canEdit}
          onClick={() => setEditing(true)}
          className="w-full rounded-xl bg-muted px-3 py-4 text-left text-sm text-muted-foreground enabled:hover:bg-border/50"
        >
          {canEdit ? "Agregá una descripción más detallada…" : "Sin descripción."}
        </button>
      ) : (
        <RichEditor key={card.updatedAt} value={card.description} editable={false} />
      )}
    </section>
  );
}

function Checklists({ card, canEdit, refresh }: { card: CardDetail; canEdit: boolean; refresh: () => void }) {
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const add = useMutation({
    mutationFn: () => api(`/cards/${card.id}/checklists`, { method: "POST", body: { title } }),
    onSuccess: () => {
      setTitle("");
      setAdding(false);
    },
    onSettled: refresh,
  });
  return (
    <section className="space-y-5">
      {card.checklists.map((cl) => (
        <ChecklistBlock key={cl.id} checklist={cl} canEdit={canEdit} refresh={refresh} />
      ))}
      {canEdit &&
        (adding ? (
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <Input autoFocus placeholder="Nombre del checklist" aria-label="Nombre del checklist" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Button type="submit" loading={add.isPending}>
              Agregar
            </Button>
            <Button variant="ghost" size="icon" aria-label="Cancelar" onClick={() => setAdding(false)}>
              <X className="h-4 w-4" />
            </Button>
          </form>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <CheckSquare className="h-4 w-4" /> Agregar checklist
          </Button>
        ))}
    </section>
  );
}

function ChecklistBlock({ checklist, canEdit, refresh }: { checklist: CardDetail["checklists"][number]; canEdit: boolean; refresh: () => void }) {
  const [text, setText] = useState("");
  const done = checklist.items.filter((i) => i.done).length;
  const pct = checklist.items.length ? Math.round((done / checklist.items.length) * 100) : 0;
  const addItem = useMutation({ mutationFn: () => api(`/checklists/${checklist.id}/items`, { method: "POST", body: { text } }), onSuccess: () => setText(""), onSettled: refresh });
  const toggle = useMutation({ mutationFn: (v: { id: string; done: boolean }) => api(`/checklist-items/${v.id}`, { method: "PATCH", body: { done: v.done } }), onSettled: refresh });
  const removeItem = useMutation({ mutationFn: (id: string) => api(`/checklist-items/${id}`, { method: "DELETE" }), onSettled: refresh });
  const remove = useMutation({ mutationFn: () => api(`/checklists/${checklist.id}`, { method: "DELETE" }), onSettled: refresh });
  return (
    <div>
      <SectionTitle
        icon={CheckSquare}
        action={
          canEdit && (
            <Button variant="ghost" size="sm" onClick={() => confirm("¿Eliminar este checklist?") && remove.mutate()}>
              Eliminar
            </Button>
          )
        }
      >
        {checklist.title}
      </SectionTitle>
      <div className="mb-2 flex items-center gap-2">
        <span className="w-9 text-xs text-muted-foreground tabular-nums">{pct}%</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full bg-primary transition-all", pct === 100 && "bg-success")} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="space-y-1">
        {checklist.items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--primary)]"
              checked={item.done}
              disabled={!canEdit}
              aria-label={item.text}
              onChange={(e) => toggle.mutate({ id: item.id, done: e.target.checked })}
            />
            <span className={cn("flex-1 text-sm", item.done && "text-muted-foreground line-through")}>{item.text}</span>
            {canEdit && (
              <button className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100" aria-label={`Eliminar ${item.text}`} onClick={() => removeItem.mutate(item.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (text.trim()) addItem.mutate();
          }}
        >
          <Input className="h-9" placeholder="Agregar un ítem" aria-label={`Nuevo ítem en ${checklist.title}`} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" variant="secondary" loading={addItem.isPending} disabled={!text.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Attachments({ card, canEdit, refresh }: { card: CardDetail; canEdit: boolean; refresh: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<CardDetail["attachments"][number] | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return api(`/cards/${card.id}/attachments`, { method: "POST", form });
    },
    onSuccess: () => toast.success("Archivo adjuntado"),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/attachments/${id}`, { method: "DELETE" }), onSettled: refresh });
  const send = (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (f.size > 4 * 1024 * 1024) toast.error(`${f.name} supera los 4 MB`);
      else upload.mutate(f);
    }
  };
  return (
    <section>
      <SectionTitle icon={Paperclip}>Adjuntos</SectionTitle>
      {card.attachments.length > 0 && (
        <ul className="mb-3 grid gap-2 sm:grid-cols-2">
          {card.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border p-2">
              {a.isImage ? (
                <button onClick={() => setPreview(a)} aria-label={`Ver ${a.fileName}`} className="shrink-0 rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/v1/attachments/${a.id}/download?inline=1`} alt="" className="h-12 w-12 rounded-lg object-cover" />
                </button>
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-bold uppercase text-muted-foreground">
                  {a.fileName.split(".").pop()?.slice(0, 4)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                {a.canPreview ? (
                  a.isImage ? (
                    <button className="block max-w-full truncate text-left text-sm font-medium hover:text-primary" onClick={() => setPreview(a)}>
                      {a.fileName}
                    </button>
                  ) : (
                    <a className="block truncate text-sm font-medium hover:text-primary" href={`/api/v1/attachments/${a.id}/download?inline=1`} target="_blank" rel="noopener noreferrer">
                      {a.fileName}
                    </a>
                  )
                ) : (
                  <p className="truncate text-sm font-medium">{a.fileName}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatSize(a.sizeBytes)} · {a.uploaderName ?? "—"} · {ago(a.createdAt)}
                </p>
              </div>
              <a href={`/api/v1/attachments/${a.id}/download`} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label={`Descargar ${a.fileName}`}>
                <Download className="h-4 w-4" />
              </a>
              {canEdit && (
                <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Eliminar ${a.fileName}`} onClick={() => confirm("¿Eliminar el adjunto?") && remove.mutate(a.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <Dialog open onOpenChange={(o) => !o && setPreview(null)} title={preview.fileName} wide>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/v1/attachments/${preview.id}/download?inline=1`} alt={preview.fileName} className="mx-auto max-h-[70vh] rounded-2xl object-contain" />
          <a href={`/api/v1/attachments/${preview.id}/download`} className="inline-flex items-center gap-1.5 justify-self-end text-sm text-muted-foreground hover:text-primary">
            <Download className="h-4 w-4" /> Descargar
          </a>
        </Dialog>
      )}
      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            send(e.dataTransfer.files);
          }}
          className={cn("flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground", over && "border-primary bg-primary-soft")}
        >
          {upload.isPending ? <Spinner /> : <Upload className="h-5 w-5" />}
          <p>
            Arrastrá archivos acá o{" "}
            <button className="font-medium text-primary hover:underline" onClick={() => input.current?.click()}>
              elegí uno
            </button>
          </p>
          <p className="text-xs">Imágenes, PDF, Office, ZIP o texto · máx. 4 MB</p>
          <input ref={input} type="file" multiple hidden onChange={(e) => send(e.target.files)} />
        </div>
      )}
      {!canEdit && card.attachments.length === 0 && <p className="text-sm text-muted-foreground">Sin adjuntos.</p>}
    </section>
  );
}

function Relations({ card, canEdit, refresh }: { card: CardDetail; canEdit: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [type, setType] = useState("relates");
  const candidates = useQuery({
    queryKey: ["relation-candidates", card.id, q],
    queryFn: () => api<{ cards: { id: string; title: string }[] }>(`/cards/${card.id}/relation-candidates?q=${encodeURIComponent(q)}`),
    enabled: open,
  });
  const add = useMutation({
    mutationFn: (toCardId: string) => api(`/cards/${card.id}/relations`, { method: "POST", body: { toCardId, type } }),
    onSuccess: () => setOpen(false),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (r: { cardId: string; type: string }) => api(`/cards/${card.id}/relations/${r.cardId}?type=${r.type}`, { method: "DELETE" }),
    onSettled: refresh,
  });
  if (!canEdit && card.relations.length === 0) return null;
  return (
    <section>
      <SectionTitle
        icon={Link2}
        action={
          canEdit && (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="sm">
                  <Plus className="h-4 w-4" /> Relacionar
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-2">
                <Select aria-label="Tipo de relación" value={type} onChange={(e) => setType(e.target.value)} className="h-9">
                  <option value="relates">Relacionada con</option>
                  <option value="blocks">Bloquea a</option>
                  <option value="duplicates">Duplica a</option>
                </Select>
                <Input className="h-9" placeholder="Buscar tarjeta…" aria-label="Buscar tarjeta" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} />
                <ul className="max-h-56 overflow-y-auto scroll-thin">
                  {candidates.data?.cards.map((c) => (
                    <li key={c.id}>
                      <button className="w-full truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => add.mutate(c.id)}>
                        {c.title}
                      </button>
                    </li>
                  ))}
                  {candidates.data?.cards.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Sin resultados</li>}
                </ul>
              </PopoverContent>
            </Popover>
          )
        }
      >
        Relaciones
      </SectionTitle>
      <ul className="space-y-1">
        {card.relations.map((r) => (
          <li key={`${r.cardId}-${r.type}-${r.direction}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
            <span className="w-32 shrink-0 text-xs text-muted-foreground">{RELATION_LABEL[r.type]?.[r.direction]}</span>
            <Link href={`/b/${r.boardId}?card=${r.cardId}`} className={cn("min-w-0 flex-1 truncate hover:underline", r.completed && "line-through")}>
              {r.title}
            </Link>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">{r.boardName}</span>
            {canEdit && (
              <button aria-label="Quitar relación" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(r)}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const MENTION_RE = /@\[([^\]\n]{1,80})\]\(([0-9a-f-]{36})\)/gi;

function CommentBody({ body }: { body: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    if (m.index! > last) parts.push(body.slice(last, m.index));
    parts.push(
      <span key={m.index} className="rounded bg-primary-soft px-1 font-medium text-primary">
        @{m[1]}
      </span>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(body.slice(last));
  return <p className="whitespace-pre-wrap break-words text-sm">{parts}</p>;
}

function Comments({ cardId, board, canComment, canModerate }: { cardId: string; board: BoardData; canComment: boolean; canModerate: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: { id: string } }>("/me") });
  const comments = useQuery({ queryKey: ["comments", cardId], queryFn: () => api<{ comments: Comment[] }>(`/cards/${cardId}/comments`) });
  const activity = useQuery({ queryKey: ["card-activity", cardId], queryFn: () => api<{ entries: Activity[] }>(`/cards/${cardId}/activity`), enabled: showActivity });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["comments", cardId] });
    qc.invalidateQueries({ queryKey: ["board", board.board.id] });
  };
  const post = useMutation({ mutationFn: () => api(`/cards/${cardId}/comments`, { method: "POST", body: { body } }), onSuccess: () => setBody(""), onSettled: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api(`/comments/${id}`, { method: "DELETE" }), onSettled: invalidate });
  const edit = useMutation({ mutationFn: (v: { id: string; body: string }) => api(`/comments/${v.id}`, { method: "PATCH", body: { body: v.body } }), onSettled: invalidate });
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  const suggestions = useMemo(
    () => (mention ? board.people.filter((p) => p.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6) : []),
    [mention, board.people],
  );

  function onChange(value: string, caret: number) {
    setBody(value);
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}\p{N} ]{0,30})$/u);
    setMention(m ? { query: m[1]!, start: caret - m[1]!.length - 1 } : null);
  }
  function pick(p: { userId: string; name: string }) {
    if (!mention) return;
    const caret = textarea.current?.selectionStart ?? body.length;
    const token = `@[${p.name}](${p.userId}) `;
    setBody(body.slice(0, mention.start) + token + body.slice(caret));
    setMention(null);
    textarea.current?.focus();
  }

  return (
    <section>
      <SectionTitle
        icon={MessageSquare}
        action={
          <Button variant="ghost" size="sm" onClick={() => setShowActivity((s) => !s)}>
            <History className="h-4 w-4" /> {showActivity ? "Ocultar historial" : "Ver historial"}
          </Button>
        }
      >
        Comentarios
      </SectionTitle>
      {canComment && (
        <form
          className="relative mb-4 space-y-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (body.trim()) post.mutate();
          }}
        >
          <Textarea
            ref={textarea}
            rows={2}
            maxLength={5000}
            placeholder="Escribí un comentario… usá @ para mencionar"
            aria-label="Nuevo comentario"
            value={body}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={(e) => {
              if (mention && suggestions.length && e.key === "Enter") {
                e.preventDefault();
                pick(suggestions[0]!);
              }
              if (e.key === "Escape") setMention(null);
            }}
          />
          {mention && suggestions.length > 0 && (
            <ul className="absolute left-2 top-full z-10 mt-1 w-64 rounded-xl border border-border bg-card p-1 shadow-xl" role="listbox" aria-label="Personas para mencionar">
              {suggestions.map((p) => (
                <li key={p.userId}>
                  <button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => pick(p)}>
                    <Avatar user={p} size={22} /> {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button type="submit" size="sm" loading={post.isPending} disabled={!body.trim()}>
            Comentar
          </Button>
        </form>
      )}
      {comments.isLoading && <Skeleton className="h-16" />}
      <ul className="space-y-4">
        {comments.data?.comments.map((c) => (
          <li key={c.id} className="flex gap-3">
            <Avatar user={{ userId: c.authorId ?? c.id, name: c.authorName ?? "?", hasAvatar: c.authorHasAvatar }} size={30} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <strong className="font-semibold">{c.authorName ?? "Usuario eliminado"}</strong>{" "}
                <span className="text-xs text-muted-foreground">
                  {ago(c.createdAt)}
                  {c.editedAt && " · editado"}
                </span>
              </p>
              {editing?.id === c.id ? (
                <form
                  className="mt-1 space-y-2"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    edit.mutate(editing, { onSuccess: () => setEditing(null) });
                  }}
                >
                  <Textarea rows={2} maxLength={5000} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} aria-label="Editar comentario" />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" loading={edit.isPending} disabled={!editing.body.trim()}>
                      Guardar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-1 rounded-xl bg-muted px-3 py-2">
                  <CommentBody body={c.body} />
                </div>
              )}
              {editing?.id !== c.id && (c.authorId === me?.user.id || canModerate) && (
                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                  {c.authorId === me?.user.id && (
                    <button className="hover:underline" onClick={() => setEditing({ id: c.id, body: c.body })}>
                      Editar
                    </button>
                  )}
                  <button className="hover:text-destructive hover:underline" onClick={() => confirm("¿Eliminar el comentario?") && remove.mutate(c.id)}>
                    Eliminar
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
        {comments.data?.comments.length === 0 && !canComment && <li className="text-sm text-muted-foreground">Sin comentarios.</li>}
      </ul>
      {showActivity && (
        <div className="mt-6 border-t border-border pt-4">
          <h4 className="mb-2 text-sm font-semibold">Historial de cambios</h4>
          {activity.isLoading && <Spinner />}
          <ul className="space-y-2 text-sm">
            {activity.data?.entries.map((a) => (
              <li key={a.id}>
                <strong className="font-medium">{a.actorName ?? "Alguien"}</strong> <span className="text-muted-foreground">{describeActivity(a)}</span>
                <span className="block text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Sidebar({
  card,
  board,
  canEdit,
  patch,
  refresh,
  onClose,
  onOpenCard,
}: {
  card: CardDetail;
  board: BoardData;
  canEdit: boolean;
  patch: (b: Record<string, unknown>) => void;
  refresh: () => void;
  onClose: () => void;
  onOpenCard: (id: string) => void;
}) {
  const qc = useQueryClient();
  const assign = useMutation({ mutationFn: (userIds: string[]) => api(`/cards/${card.id}/assignees`, { method: "PUT", body: { userIds } }), onSettled: refresh });
  const setLabels = useMutation({ mutationFn: (labelIds: string[]) => api(`/cards/${card.id}/labels`, { method: "PUT", body: { labelIds } }), onSettled: refresh });
  const archive = useMutation({ mutationFn: (archived: boolean) => api(`/cards/${card.id}/archive`, { method: "POST", body: { archived } }), onSettled: refresh });
  const del = useMutation({
    mutationFn: () => api(`/cards/${card.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", board.board.id] });
      onClose();
    },
  });
  const move = useMutation({
    mutationFn: (v: { listId: string; afterCardId: string | null }) => api(`/cards/${card.id}/move`, { method: "POST", body: v }),
    onSuccess: () => toast.success("Tarjeta movida"),
    onSettled: refresh,
  });

  const editors = board.people;
  return (
    <aside className="space-y-4 self-start rounded-2xl border bg-card p-4 text-sm md:sticky md:top-0">
      <Button
        variant={card.completedAt ? "soft" : "primary"}
        className="h-10 w-full justify-start"
        disabled={!canEdit}
        onClick={() => patch({ completed: !card.completedAt })}
      >
        {card.completedAt ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4" />}
        {card.completedAt ? "Completada" : "Marcar como completada"}
      </Button>

      <p className="border-t pt-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Detalles</p>

      <div className="space-y-1.5">
        <label htmlFor="card-owner" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" /> Responsable
        </label>
        <Select id="card-owner" className="h-9" disabled={!canEdit} value={card.ownerId ?? ""} onChange={(e) => patch({ ownerId: e.target.value || null })}>
          <option value="">Sin responsable</option>
          {editors.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <MultiPicker
        key={card.assigneeIds.join()}
        icon={Users}
        label="Colaboradores"
        disabled={!canEdit}
        options={editors.map((p) => ({ id: p.userId, label: p.name, avatar: p }))}
        selected={card.assigneeIds}
        onChange={(ids) => assign.mutate(ids)}
      />

      <LabelPicker board={board} card={card} disabled={!canEdit} onChange={(ids) => setLabels.mutate(ids)} />

      <div className="space-y-1.5">
        <label htmlFor="card-due" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" /> Vencimiento
        </label>
        <div className="flex gap-1">
          <Input
            id="card-due"
            type="datetime-local"
            className="h-9 px-2 text-xs"
            disabled={!canEdit}
            defaultValue={toLocalInput(card.dueAt)}
            key={card.dueAt ?? "none"}
            onBlur={(e) => {
              const v = e.target.value;
              const iso = v ? new Date(v).toISOString() : null;
              if (iso !== (card.dueAt ? new Date(card.dueAt).toISOString() : null)) patch({ dueAt: iso });
            }}
          />
          {card.dueAt && canEdit && (
            <Button variant="ghost" size="icon" aria-label="Quitar vencimiento" onClick={() => patch({ dueAt: null })}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="card-priority" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Flag className="h-3.5 w-3.5" /> Prioridad
        </label>
        <Select id="card-priority" className="h-9" disabled={!canEdit} value={card.priority} onChange={(e) => patch({ priority: e.target.value })}>
          {Object.entries(PRIORITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>

      <p className="border-t pt-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Planificación</p>
      <PlanningSidebar card={card} board={board} canEdit={canEdit} patch={patch} onOpenCard={onOpenCard} />

      {canEdit && !card.archivedAt && (
        <div className="space-y-1.5">
          <label htmlFor="card-move" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Mover a
          </label>
          <Select
            id="card-move"
            className="h-9"
            value=""
            onChange={(e) => {
              const [listId, where] = e.target.value.split("|");
              if (!listId) return;
              const inList = board.cards.filter((c) => c.listId === listId && c.id !== card.id);
              move.mutate({ listId, afterCardId: where === "top" ? null : (inList[inList.length - 1]?.id ?? null) });
            }}
          >
            <option value="">Elegí lista y posición…</option>
            {board.lists.map((l) => (
              <optgroup key={l.id} label={l.name}>
                <option value={`${l.id}|top`}>{l.name} — al principio</option>
                <option value={`${l.id}|bottom`}>{l.name} — al final</option>
              </optgroup>
            ))}
          </Select>
        </div>
      )}

      {canEdit && (
        <div className="space-y-2 border-t border-border pt-4">
          {card.archivedAt ? (
            <>
              <Button variant="secondary" className="w-full justify-start" onClick={() => archive.mutate(false)} loading={archive.isPending}>
                <RotateCcw className="h-4 w-4" /> Restaurar
              </Button>
              <Button variant="danger" className="w-full justify-start" onClick={() => confirm("¿Eliminar definitivamente esta tarjeta?") && del.mutate()} loading={del.isPending}>
                <Trash2 className="h-4 w-4" /> Eliminar
              </Button>
            </>
          ) : (
            <Button variant="secondary" className="w-full justify-start" onClick={() => archive.mutate(true)} loading={archive.isPending}>
              <Archive className="h-4 w-4" /> Archivar
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}

function MultiPicker({
  icon: Icon,
  label,
  options,
  selected,
  onChange,
  disabled,
}: {
  icon: typeof Users;
  label: string;
  options: { id: string; label: string; avatar?: { userId: string; name: string; hasAvatar: boolean } }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o && JSON.stringify([...draft].sort()) !== JSON.stringify([...selected].sort())) onChange(draft);
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="w-full justify-start" disabled={disabled}>
            {selected.length ? `${selected.length} seleccionado${selected.length > 1 ? "s" : ""}` : "Elegir…"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-1">
          <ul className="max-h-64 overflow-y-auto scroll-thin">
            {options.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--primary)]"
                    checked={draft.includes(o.id)}
                    onChange={(e) => setDraft(e.target.checked ? [...draft, o.id] : draft.filter((x) => x !== o.id))}
                  />
                  {o.avatar && <Avatar user={o.avatar} size={22} />}
                  <span className="truncate">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function LabelPicker({ board, card, disabled, onChange }: { board: BoardData; card: CardDetail; disabled: boolean; onChange: (ids: string[]) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<ColorName>("violet");
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/boards/${board.board.id}/labels`, { method: "POST", body: { name, color } }),
    onSuccess: ({ id }) => {
      setName("");
      qc.invalidateQueries({ queryKey: ["board", board.board.id] });
      onChange([...card.labelIds, id]);
    },
  });
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Tag className="h-3.5 w-3.5" /> Etiquetas
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" className="w-full justify-start" disabled={disabled}>
            {card.labelIds.length ? `${card.labelIds.length} etiqueta${card.labelIds.length > 1 ? "s" : ""}` : "Elegir…"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3">
          <ul className="max-h-48 space-y-1 overflow-y-auto scroll-thin">
            {board.labels.map((l) => {
              const on = card.labelIds.includes(l.id);
              return (
                <li key={l.id}>
                  <button
                    className={cn("flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-medium", CHIP[asColor(l.color)], on && "ring-2 ring-primary")}
                    aria-pressed={on}
                    onClick={() => onChange(on ? card.labelIds.filter((x) => x !== l.id) : [...card.labelIds, l.id])}
                  >
                    {l.name}
                    {on && <CheckCircle2 className="h-4 w-4" />}
                  </button>
                </li>
              );
            })}
            {board.labels.length === 0 && <li className="text-sm text-muted-foreground">Todavía no hay etiquetas.</li>}
          </ul>
          <form
            className="space-y-2 border-t border-border pt-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <Input className="h-9" placeholder="Nueva etiqueta" aria-label="Nombre de la nueva etiqueta" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            <ColorPicker value={color} onChange={setColor} />
            <Button type="submit" size="sm" loading={create.isPending} disabled={!name.trim()}>
              Crear y aplicar
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
