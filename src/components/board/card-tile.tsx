"use client";

import { Ban, Calendar, Copy, CheckCircle2, CheckSquare, CircleDot, CornerDownRight, Flag, ListTree, MessageSquare, Paperclip, Repeat, ShieldCheck, Tag } from "lucide-react";
import { createContext, useContext } from "react";
import { Avatar } from "@/components/ui/user-avatar";
import { asColor, CHIP, PRIORITY } from "@/lib/colors";
import { fieldDisplay } from "@/lib/fields";
import { dueState, fmtDate } from "@/lib/format";
import type { BoardField, CardSummary, Label, Person } from "@/lib/types";
import { cn } from "@/lib/utils";

const QA_LABEL = { none: "", pending: "En revisión", approved: "Aprobada", rejected: "Rechazada" } as const;
const QA_CHIP = {
  none: "",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  approved: "bg-success/15 text-success",
  rejected: "bg-brand-soft text-brand",
} as const;

/** Campos personalizados del tablero visibles en el frente de las tarjetas. */
export const CardFieldsContext = createContext<BoardField[]>([]);

/** Tarjeta del tablero: prioridad, responsable, fecha, extracto y pie con archivos y etiquetas. */
export function CardTile({
  card,
  labels,
  people,
  highlighted,
  dragging,
}: {
  card: CardSummary;
  labels: Map<string, Label>;
  people: Map<string, Person>;
  highlighted?: boolean;
  dragging?: boolean;
}) {
  const due = dueState(card.dueAt, !!card.completedAt);
  const owner = card.ownerId ? people.get(card.ownerId) : (card.assigneeIds.map((id) => people.get(id)).find(Boolean) ?? null);
  const extra = card.assigneeIds.filter((id) => id !== owner?.userId).length;
  const p = PRIORITY[card.priority] ?? PRIORITY.none!;
  const labelNames = card.labelIds.map((id) => labels.get(id)?.name).filter(Boolean) as string[];
  const fieldChips = useContext(CardFieldsContext)
    .filter((f) => f.showOnCard)
    .map((f) => ({ f, text: fieldDisplay(f, card.fieldValues?.[f.id]) }))
    .filter((x) => x.text);

  return (
    <div
      className={cn(
        "task-surface rounded-[1.4rem] border bg-card text-left shadow-card transition-[box-shadow,border-color] hover:border-primary/40 dark:bg-secondary",
        dragging && "rotate-2 border-brand shadow-xl",
        highlighted && "border-brand ring-2 ring-brand/30",
        card.completedAt && "opacity-80",
      )}
    >
      <div className="p-3.5 pb-3">
        <span className={cn("mb-2.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", p.chip)}>
          <Flag className={cn("size-3", p.flag)} aria-hidden />
          {card.priority === "none" ? "Sin prioridad" : `Prioridad ${p.label.toLowerCase()}`}
        </span>
        {card.completedAt && (
          <span className="mb-2.5 ml-1.5 inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-success uppercase">
            <CheckCircle2 className="size-3" aria-hidden /> Hecha
          </span>
        )}
        {(card.blocked || card.qaStatus !== "none" || card.recurrence) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {card.blocked && (
              <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-destructive uppercase">
                <Ban className="size-3" aria-hidden /> Bloqueada
              </span>
            )}
            {card.qaStatus !== "none" && (
              <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase", QA_CHIP[card.qaStatus])}>
                <ShieldCheck className="size-3" aria-hidden /> {QA_LABEL[card.qaStatus]}
              </span>
            )}
            {card.recurrence && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground" title="Tarea que se repite">
                <Repeat className="size-3" aria-hidden /> {card.recurrence === "weekly" ? "Semanal" : "Mensual"}
              </span>
            )}
          </div>
        )}
        {card.mirror && (
          <p className="mb-1 flex items-center gap-1 truncate text-[11px] text-primary" title={`Tarjeta de ${card.mirror.boardName}`}>
            <Copy className="size-3 shrink-0" aria-hidden /> Espejo de {card.mirror.boardName}
          </p>
        )}
        {card.parentId && (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <CornerDownRight className="size-3" aria-hidden /> Subtarea
          </p>
        )}
        <p className="text-[0.9rem] font-semibold leading-snug break-words">{card.title}</p>

        {(owner || card.dueAt) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {owner && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Avatar user={owner} size={20} />
                <span className="truncate">{owner.name.split(" ")[0]}</span>
                {extra > 0 && <span className="text-[10px]">+{extra}</span>}
              </span>
            )}
            {card.dueAt && (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  due === "overdue" && "font-semibold text-destructive",
                  due === "soon" && "font-semibold text-amber-600 dark:text-amber-300",
                  due === "done" && "text-success",
                )}
              >
                <Calendar className="size-3.5" aria-hidden /> {fmtDate(card.dueAt)}
              </span>
            )}
          </div>
        )}

        {fieldChips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {fieldChips.map(({ f, text }) => {
              const option = f.type === "select" ? f.config.options?.find((o) => o.id === card.fieldValues[f.id]) : null;
              return (
                <span
                  key={f.id}
                  className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px]", option ? CHIP[asColor(option.color)] : "bg-muted text-muted-foreground")}
                  title={`${f.name}: ${text}`}
                >
                  <span className="opacity-70">{f.name}:</span> <span className="truncate font-medium">{text}</span>
                </span>
              );
            })}
          </div>
        )}

        {card.excerpt && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{card.excerpt}</p>}
      </div>

      <div className="flex items-center gap-3 border-t border-dashed px-3.5 py-2.5 text-xs text-muted-foreground">
        <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap" title="Archivos">
          <Paperclip className="size-3.5" aria-hidden /> {card.attachmentCount} {card.attachmentCount === 1 ? "archivo" : "archivos"}
        </span>
        {card.estimatePoints !== null && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-primary-soft px-1.5 font-semibold text-primary tabular-nums" title="Estimación en puntos">
            {card.estimatePoints} pts
          </span>
        )}
        {card.subtaskTotal > 0 && (
          <span className={cn("inline-flex shrink-0 items-center gap-1", card.subtaskDone === card.subtaskTotal && "text-success")} title="Subtareas">
            <ListTree className="size-3.5" aria-hidden /> {card.subtaskDone}/{card.subtaskTotal}
          </span>
        )}
        {card.checklistTotal > 0 && (
          <span className={cn("inline-flex shrink-0 items-center gap-1", card.checklistDone === card.checklistTotal && "text-success")} title="Checklist">
            <CheckSquare className="size-3.5" aria-hidden /> {card.checklistDone}/{card.checklistTotal}
          </span>
        )}
        {card.commentCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1" title="Comentarios">
            <MessageSquare className="size-3.5" aria-hidden /> {card.commentCount}
          </span>
        )}
        {card.issueNumber !== null && (
          <span className={cn("inline-flex shrink-0 items-center gap-1 font-medium", card.syncAttention ? "text-amber-600 dark:text-amber-300" : "text-primary")} title={card.syncAttention ? "Sincronización pendiente o con conflicto" : `Issue #${card.issueNumber}`}>
            <CircleDot className="size-3.5" aria-hidden />#{card.issueNumber}
          </span>
        )}
        {labelNames.length > 0 && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1" title="Etiquetas">
            <Tag className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{labelNames.join(", ")}</span>
          </span>
        )}
      </div>
    </div>
  );
}
