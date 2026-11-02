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
    default: return "nueva actividad";
  }
}
