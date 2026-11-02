import type { Activity, Notification } from "./types";

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** Texto legible para cada evento de actividad. */
export function describeActivity(a: Pick<Activity, "action" | "data">): string {
  const d = a.data ?? {};
  const t = s(d.title);
  switch (a.action) {
    case "board.created": return `creó el tablero "${s(d.name)}"`;
    case "board.updated": return "actualizó el tablero";
    case "board.archived": return "archivó el tablero";
    case "board.restored": return "restauró el tablero";
    case "board.member_set": return "actualizó los miembros del tablero";
    case "board.member_removed": return "quitó a un miembro del tablero";
    case "list.created": return `creó la lista "${s(d.name)}"`;
    case "list.updated": return `editó la lista "${s(d.name)}"`;
    case "list.moved": return `reordenó la lista "${s(d.name)}"`;
    case "list.archived": return `archivó la lista "${s(d.name)}"`;
    case "list.restored": return `restauró la lista "${s(d.name)}"`;
    case "list.deleted": return `eliminó la lista "${s(d.name)}"`;
    case "label.created": return `creó la etiqueta "${s(d.name)}"`;
    case "label.updated": return "editó una etiqueta";
    case "label.deleted": return `eliminó la etiqueta "${s(d.name)}"`;
    case "card.created": return `creó "${t}" en ${s(d.list)}`;
    case "card.updated": return `editó "${t}"`;
    case "card.completed": return `completó "${t}"`;
    case "card.reopened": return `reabrió "${t}"`;
    case "card.moved": return `movió "${t}" de ${s(d.from)} a ${s(d.to)}`;
    case "card.reordered": return `reordenó "${t}"`;
    case "card.archived": return `archivó "${t}"`;
    case "card.restored": return `restauró "${t}"`;
    case "card.deleted": return `eliminó "${t}"`;
    case "card.assignees": return `cambió los asignados de "${t}"`;
    case "card.labels": return `cambió las etiquetas de "${t}"`;
    case "card.relation_added": return `relacionó "${t}" con "${s(d.other)}"`;
    case "card.relation_removed": return `quitó una relación de "${t}"`;
    case "checklist.created": return `agregó el checklist "${s(d.checklist)}" a "${t}"`;
    case "checklist.deleted": return `eliminó un checklist de "${t}"`;
    case "checklist.item_added": return `agregó un ítem en "${t}"`;
    case "checklist.item_done": return `completó "${s(d.item)}" en "${t}"`;
    case "checklist.item_undone": return `desmarcó "${s(d.item)}" en "${t}"`;
    case "comment.created": return `comentó en "${t}"`;
    case "comment.deleted": return `eliminó un comentario en "${t}"`;
    case "attachment.added": return `adjuntó ${s(d.file)} en "${t}"`;
    case "attachment.removed": return `quitó ${s(d.file)} de "${t}"`;
    case "card.recurred": return `programó la próxima "${t}"`;
    case "card.duplicated": return `duplicó "${t}"`;
    case "card.subtask_created": return `agregó la subtarea "${t}" a "${s(d.parent)}"`;
    case "card.mirrored": return `espejó "${t}" en ${s(d.to)}`;
    case "card.mirror_added": return "agregó una tarjeta espejo";
    case "card.mirror_moved": return `movió una tarjeta espejo a ${s(d.to)}`;
    case "card.mirror_removed": return "quitó una tarjeta espejo";
    case "field.created": return `creó el campo "${s(d.name)}"`;
    case "field.deleted": return `eliminó el campo "${s(d.name)}"`;
    case "card.field_set": return d.value ? `puso ${s(d.field)} = "${s(d.value)}" en "${t}"` : `borró ${s(d.field)} en "${t}"`;
    case "share.enabled": return d.kind === "public" ? "activó el enlace público de solo lectura" : "activó el enlace para unirse";
    case "share.updated": return "cambió el permiso del enlace para unirse";
    case "share.regenerated": return d.kind === "public" ? "generó un enlace público nuevo" : "generó un enlace nuevo para unirse";
    case "share.disabled": return d.kind === "public" ? "desactivó el enlace público" : "desactivó el enlace para unirse";
    case "share.joined": return "se unió al tablero con un enlace";
    case "cards.bulk_created": return `cargó ${String(d.count ?? "")} tareas de una vez`;
    case "qa.approved": return `aprobó "${t}" en control de calidad`;
    case "qa.rejected": return `rechazó "${t}" en control de calidad`;
    case "sprint.created": return `creó la etapa "${s(d.name)}"`;
    case "sprint.started": return `inició la etapa "${s(d.name)}"`;
    case "sprint.closed": return `cerró la etapa "${s(d.name)}"`;
    case "sprint.deleted": return `eliminó la etapa "${s(d.name)}"`;
    case "vcs.issue_created": return `creó el issue #${String(d.number ?? "")} para "${t}"`;
    case "vcs.issue_synced": return `sincronizó "${t}" con el issue #${String(d.number ?? "")}`;
    default: return "hizo un cambio";
  }
}

export function describeNotification(n: Notification): string {
  const d = n.data ?? {};
  const card = s(d.cardTitle);
  switch (n.type) {
    case "card.assigned": return `te asignó "${card}"`;
    case "card.owner": return `te hizo responsable de "${card}"`;
    case "comment.mention": return `te mencionó en "${card}": ${s(d.excerpt)}`;
    case "comment.created": return `comentó en "${card}": ${s(d.excerpt)}`;
    case "card.due_soon": return `"${card}" vence en menos de 24 horas`;
    case "board.added": return `te agregó al tablero "${s(d.boardName)}"`;
    case "card.moved": return `movió "${card}" a ${s(d.to)}`;
    case "card.completed": return `completó "${card}"`;
    case "qa.approved": return `aprobó "${card}" en control de calidad`;
    case "qa.rejected": return `rechazó "${card}": ${s(d.note)}`;
    default: return "nueva actividad";
  }
}
