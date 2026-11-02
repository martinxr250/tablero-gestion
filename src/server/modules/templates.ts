import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import type { Tx } from "../db/client";
import { boards, cardLabels, cards, checklistItems, checklists, labels, lists, myBoards } from "../db/schema";
import type { ColorName } from "./shared";
import { copyBoardFields, copyFieldValues } from "./fields";

type Builtin = {
  name: string;
  description: string;
  lists: string[];
  labels: [string, ColorName][];
  /** Índices de las listas de revisión y terminado para el control de calidad. */
  qa?: { review: number; done: number };
};

/** Plantillas incluidas. Las de la organización son tableros marcados como plantilla. */
export const BUILTIN_TEMPLATES: Record<string, Builtin> = {
  kanban: { name: "Kanban simple", description: "Por hacer, en curso y hecho.", lists: ["Por hacer", "En curso", "Hecho"], labels: [] },
  sprint: {
    name: "Desarrollo por etapas",
    description: "Pendientes, desarrollo, revisión de calidad y terminado.",
    lists: ["Pendientes", "Por hacer", "En curso", "Revisión", "Hecho"],
    labels: [["Error", "red"], ["Mejora", "teal"], ["Deuda técnica", "amber"]],
    qa: { review: 3, done: 4 },
  },
  marketing: {
    name: "Campaña de marketing",
    description: "De la idea a la publicación, con revisión.",
    lists: ["Ideas", "Planificado", "En producción", "Revisión", "Publicado"],
    labels: [["Redes", "pink"], ["Contenido", "amber"], ["Diseño", "violet"]],
    qa: { review: 3, done: 4 },
  },
  bugs: {
    name: "Seguimiento de errores",
    description: "Reporte, confirmación, corrección y verificación.",
    lists: ["Reportado", "Confirmado", "En corrección", "Verificación", "Resuelto"],
    labels: [["Crítico", "red"], ["Menor", "slate"]],
    qa: { review: 3, done: 4 },
  },
};

export const templateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("builtin"), key: z.enum(Object.keys(BUILTIN_TEMPLATES) as [string, ...string[]]) }),
  z.object({ kind: z.literal("board"), boardId: z.uuid(), includeCards: z.boolean().default(false) }),
]);
export type TemplateInput = z.infer<typeof templateSchema>;

/** Arma listas, etiquetas y (opcional) tarjetas del tablero nuevo a partir de una plantilla. */
export async function applyTemplate(tx: Tx, input: { orgId: string; boardId: string; actorId: string; template: TemplateInput }) {
  const { orgId, boardId, template } = input;
  if (template.kind === "builtin") {
    const t = BUILTIN_TEMPLATES[template.key]!;
    const listIds: string[] = [];
    let prev: string | null = null;
    for (const name of t.lists) {
      const position = generateKeyBetween(prev, null);
      prev = position;
      const id = uuidv7();
      listIds.push(id);
      await tx.insert(lists).values({ id, orgId, boardId, name, color: "slate", position });
    }
    if (t.labels.length) await tx.insert(labels).values(t.labels.map(([name, color]) => ({ id: uuidv7(), orgId, boardId, name, color })));
    if (t.qa) await tx.update(boards).set({ qaRequired: true, qaListId: listIds[t.qa.review], doneListId: listIds[t.qa.done] }).where(eq(boards.id, boardId));
    return;
  }
  await copyBoardContents(tx, { orgId, sourceBoardId: template.boardId, targetBoardId: boardId, actorId: input.actorId, includeCards: template.includeCards });
}

/** Copia listas, etiquetas, configuración de calidad y, si se pide, tarjetas con checklists y etiquetas. */
export async function copyBoardContents(
  tx: Tx,
  input: { orgId: string; sourceBoardId: string; targetBoardId: string; actorId: string; includeCards: boolean },
) {
  const { orgId, sourceBoardId, targetBoardId } = input;
  // El tablero de origen tiene que ser visible para quien copia y de la misma organización.
  const [visible] = await tx.select().from(myBoards).where(eq(myBoards.boardId, sourceBoardId));
  const [source] = await tx.select().from(boards).where(eq(boards.id, sourceBoardId));
  if (!visible || !source || source.orgId !== orgId) throw notFound("Plantilla");

  const listMap = new Map<string, string>();
  const srcLists = await tx.select().from(lists).where(and(eq(lists.boardId, sourceBoardId), isNull(lists.archivedAt))).orderBy(asc(lists.position));
  for (const l of srcLists) {
    const id = uuidv7();
    listMap.set(l.id, id);
    await tx.insert(lists).values({ id, orgId, boardId: targetBoardId, name: l.name, color: l.color, position: l.position });
  }
  const labelMap = new Map<string, string>();
  const srcLabels = await tx.select().from(labels).where(eq(labels.boardId, sourceBoardId));
  for (const l of srcLabels) {
    const id = uuidv7();
    labelMap.set(l.id, id);
    await tx.insert(labels).values({ id, orgId, boardId: targetBoardId, name: l.name, color: l.color });
  }
  await tx
    .update(boards)
    .set({
      qaRequired: source.qaRequired,
      qaListId: source.qaListId ? (listMap.get(source.qaListId) ?? null) : null,
      doneListId: source.doneListId ? (listMap.get(source.doneListId) ?? null) : null,
    })
    .where(eq(boards.id, targetBoardId));
  const fieldMap = await copyBoardFields(tx, orgId, sourceBoardId, targetBoardId);
  if (!input.includeCards) return;

  const srcCards = await tx.select().from(cards).where(and(eq(cards.boardId, sourceBoardId), isNull(cards.archivedAt))).orderBy(asc(cards.position));
  const cardMap = new Map<string, string>();
  for (const c of srcCards) {
    const listId = listMap.get(c.listId);
    if (!listId) continue;
    const id = uuidv7();
    cardMap.set(c.id, id);
    await tx.insert(cards).values({
      id,
      orgId,
      boardId: targetBoardId,
      listId,
      title: c.title,
      description: c.description,
      descriptionText: c.descriptionText,
      priority: c.priority,
      position: c.position,
      estimatePoints: c.estimatePoints,
      recurrence: c.recurrence,
      createdBy: input.actorId,
    });
  }
  // Subtareas: se vuelven a enlazar con su tarea padre copiada.
  for (const c of srcCards) {
    if (c.parentId && cardMap.has(c.id) && cardMap.has(c.parentId)) {
      await tx.update(cards).set({ parentId: cardMap.get(c.parentId) }).where(eq(cards.id, cardMap.get(c.id)!));
    }
  }
  const srcIds = [...cardMap.keys()];
  if (srcIds.length === 0) return;
  const cl = await tx.select().from(cardLabels).where(inArray(cardLabels.cardId, srcIds));
  const labelRows = cl
    .filter((r) => labelMap.has(r.labelId))
    .map((r) => ({ orgId, boardId: targetBoardId, cardId: cardMap.get(r.cardId)!, labelId: labelMap.get(r.labelId)! }));
  if (labelRows.length) await tx.insert(cardLabels).values(labelRows);
  const srcChecklists = await tx.select().from(checklists).where(inArray(checklists.cardId, srcIds));
  for (const k of srcChecklists) {
    const id = uuidv7();
    await tx.insert(checklists).values({ id, orgId, cardId: cardMap.get(k.cardId)!, title: k.title, position: k.position });
    const items = await tx.select().from(checklistItems).where(eq(checklistItems.checklistId, k.id));
    if (items.length) await tx.insert(checklistItems).values(items.map((i) => ({ id: uuidv7(), orgId, checklistId: id, text: i.text, position: i.position })));
  }
  for (const [from, to] of cardMap) await copyFieldValues(tx, from, to, fieldMap);
}
