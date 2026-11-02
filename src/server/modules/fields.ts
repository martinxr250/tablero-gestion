import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { badRequest, conflict, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser, type Tx } from "../db/client";
import { boardFields, cardFieldValues, type FieldConfig, type FieldType } from "../db/schema";
import { boardAccess, cardAccess } from "./access";
import { positionAfter } from "./positions";
import { COLORS, logActivity } from "./shared";

export type FieldValue = string | number | boolean;
type Field = typeof boardFields.$inferSelect;

const optionSchema = z.object({ id: z.string().min(1).max(40).optional(), name: z.string().trim().min(1).max(40), color: z.enum(COLORS).default("slate") });
const configSchema = z.object({
  options: z.array(optionSchema).max(30).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Código de moneda de 3 letras (ARS, USD…)").optional(),
});

/** Normaliza la configuración según el tipo: opciones con id estable para listas, moneda para importes. */
function normalizeConfig(type: FieldType, raw: z.infer<typeof configSchema> | undefined, previous?: FieldConfig): FieldConfig {
  if (type === "select") {
    const options = (raw?.options ?? previous?.options ?? []).map((o) => ({ id: o.id ?? uuidv7(), name: o.name, color: o.color ?? "slate" }));
    if (options.length === 0) throw badRequest("Una lista de opciones necesita al menos una opción");
    if (new Set(options.map((o) => o.name.toLowerCase())).size !== options.length) throw badRequest("Hay opciones repetidas");
    return { options };
  }
  if (type === "currency") return { currency: raw?.currency ?? previous?.currency ?? "ARS" };
  return {};
}

/** Valida y convierte el valor de un campo según su tipo. null = borrar el valor. */
export function parseFieldValue(field: Pick<Field, "type" | "config" | "name">, raw: unknown): FieldValue | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const bad = (msg: string) => badRequest(`${field.name}: ${msg}`);
  switch (field.type) {
    case "text": {
      if (typeof raw !== "string") throw bad("tiene que ser texto");
      const v = raw.trim();
      if (v.length > 500) throw bad("máximo 500 caracteres");
      return v || null;
    }
    case "number":
    case "currency": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".")) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw bad("tiene que ser un número");
      return Math.round(n * 100) / 100;
    }
    case "date": {
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) throw bad("fecha inválida (aaaa-mm-dd)");
      return raw;
    }
    case "checkbox":
      if (typeof raw !== "boolean") throw bad("tiene que ser sí o no");
      return raw ? true : null;
    case "select": {
      if (typeof raw !== "string" || !field.config.options?.some((o) => o.id === raw)) throw bad("opción inexistente");
      return raw;
    }
  }
}

/** Texto legible de un valor (planillas y vistas sin formato). */
export function fieldValueText(field: Pick<Field, "type" | "config">, value: FieldValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (field.type === "checkbox") return value ? "Sí" : "";
  if (field.type === "select") return field.config.options?.find((o) => o.id === value)?.name ?? "";
  if (field.type === "currency") return `${field.config.currency ?? ""} ${value}`.trim();
  return String(value);
}

export async function listBoardFields(tx: Tx, boardId: string) {
  const rows = await tx.select().from(boardFields).where(eq(boardFields.boardId, boardId)).orderBy(asc(boardFields.position), asc(boardFields.id));
  return rows.map((f) => ({ id: f.id, name: f.name, type: f.type, config: f.config, showOnCard: f.showOnCard }));
}

/** Valores de campos por tarjeta: { cardId: { fieldId: valor } }. */
export async function fieldValuesByCard(tx: Tx, cardIds: string[]) {
  const out = new Map<string, Record<string, FieldValue>>();
  if (cardIds.length === 0) return out;
  const rows = await tx.select().from(cardFieldValues).where(inArray(cardFieldValues.cardId, cardIds));
  for (const r of rows) {
    const m = out.get(r.cardId) ?? {};
    m[r.fieldId] = r.value;
    out.set(r.cardId, m);
  }
  return out;
}

/** Copia los valores de una tarjeta a otra (duplicar). fieldMap traduce ids si cambian de tablero. */
export async function copyFieldValues(tx: Tx, fromCardId: string, toCardId: string, fieldMap?: Map<string, string>) {
  const rows = await tx.select().from(cardFieldValues).where(eq(cardFieldValues.cardId, fromCardId));
  const values = rows
    .map((r) => ({ orgId: r.orgId, cardId: toCardId, fieldId: fieldMap ? fieldMap.get(r.fieldId) : r.fieldId, value: r.value }))
    .filter((r): r is typeof r & { fieldId: string } => !!r.fieldId);
  if (values.length) await tx.insert(cardFieldValues).values(values);
}

/** Copia la definición de campos entre tableros (plantillas y duplicado). Devuelve id viejo → id nuevo. */
export async function copyBoardFields(tx: Tx, orgId: string, fromBoardId: string, toBoardId: string) {
  const map = new Map<string, string>();
  for (const f of await tx.select().from(boardFields).where(eq(boardFields.boardId, fromBoardId))) {
    const id = uuidv7();
    map.set(f.id, id);
    await tx.insert(boardFields).values({ id, orgId, boardId: toBoardId, name: f.name, type: f.type, config: f.config, showOnCard: f.showOnCard, position: f.position });
  }
  return map;
}

async function fieldWithAccess(tx: Tx, actx: Parameters<typeof boardAccess>[1], fieldId: string) {
  const [field] = await tx.select().from(boardFields).where(eq(boardFields.id, fieldId));
  if (!field) throw notFound("Campo");
  const { board } = await boardAccess(tx, actx, field.boardId, "edit");
  return { field, board };
}

const nameSchema = z.string().trim().min(1).max(40);

export const fieldRoutes = [
  route({
    method: "POST",
    path: "/boards/:boardId/fields",
    summary: "Crear un campo personalizado en el tablero",
    tag: "Campos personalizados",
    status: 201,
    body: z.object({
      name: nameSchema,
      type: z.enum(["text", "number", "currency", "date", "checkbox", "select"]),
      config: configSchema.optional(),
      showOnCard: z.boolean().default(true),
    }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, actx, params.boardId, "edit");
        const count = await tx.$count(boardFields, eq(boardFields.boardId, board.id));
        if (count >= 30) throw badRequest("Máximo 30 campos por tablero");
        const [dup] = await tx.select({ id: boardFields.id }).from(boardFields).where(and(eq(boardFields.boardId, board.id), eq(boardFields.name, body.name)));
        if (dup) throw conflict("Ya existe un campo con ese nombre");
        const id = uuidv7();
        await tx.insert(boardFields).values({
          id,
          orgId: board.orgId,
          boardId: board.id,
          name: body.name,
          type: body.type,
          config: normalizeConfig(body.type, body.config),
          showOnCard: body.showOnCard,
          position: await positionAfter(tx, "board_fields", board.id, undefined),
        });
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "field.created", data: { name: body.name } });
        return { id };
      }),
  }),

  route({
    method: "PATCH",
    path: "/fields/:fieldId",
    summary: "Editar un campo personalizado (nombre, opciones, visibilidad u orden)",
    tag: "Campos personalizados",
    body: z.object({
      name: nameSchema.optional(),
      config: configSchema.optional(),
      showOnCard: z.boolean().optional(),
      afterFieldId: z.uuid().nullable().optional(),
    }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { field, board } = await fieldWithAccess(tx, actx, params.fieldId);
        const patch: Partial<typeof boardFields.$inferInsert> = {};
        if (body.name !== undefined && body.name !== field.name) {
          const [dup] = await tx.select({ id: boardFields.id }).from(boardFields).where(and(eq(boardFields.boardId, board.id), eq(boardFields.name, body.name)));
          if (dup) throw conflict("Ya existe un campo con ese nombre");
          patch.name = body.name;
        }
        if (body.config !== undefined) {
          patch.config = normalizeConfig(field.type, body.config, field.config);
          // Si se quitó una opción, los valores que la usaban quedan vacíos.
          if (field.type === "select") {
            const keep = new Set(patch.config.options!.map((o) => o.id));
            const gone = (field.config.options ?? []).filter((o) => !keep.has(o.id)).map((o) => o.id);
            for (const id of gone) {
              await tx.delete(cardFieldValues).where(and(eq(cardFieldValues.fieldId, field.id), eq(cardFieldValues.value, id)));
            }
          }
        }
        if (body.showOnCard !== undefined) patch.showOnCard = body.showOnCard;
        if (body.afterFieldId !== undefined) patch.position = await positionAfter(tx, "board_fields", board.id, body.afterFieldId, field.id);
        if (Object.keys(patch).length) await tx.update(boardFields).set(patch).where(eq(boardFields.id, field.id));
        return { ok: true };
      }),
  }),

  route({
    method: "DELETE",
    path: "/fields/:fieldId",
    summary: "Eliminar un campo personalizado y sus valores",
    tag: "Campos personalizados",
    handler: async ({ me, params, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { field, board } = await fieldWithAccess(tx, actx, params.fieldId);
        await tx.delete(boardFields).where(eq(boardFields.id, field.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "field.deleted", data: { name: field.name } });
        return { ok: true };
      }),
  }),

  route({
    method: "PUT",
    path: "/cards/:cardId/fields/:fieldId",
    summary: "Cargar o borrar el valor de un campo en una tarjeta",
    tag: "Campos personalizados",
    body: z.object({ value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const { card } = await cardAccess(tx, actx, params.cardId, "edit");
        const [field] = await tx.select().from(boardFields).where(and(eq(boardFields.id, params.fieldId), eq(boardFields.boardId, card.boardId)));
        if (!field) throw notFound("Campo");
        const value = parseFieldValue(field, body.value);
        const key = and(eq(cardFieldValues.cardId, card.id), eq(cardFieldValues.fieldId, field.id));
        if (value === null) {
          await tx.delete(cardFieldValues).where(key);
        } else {
          await tx
            .insert(cardFieldValues)
            .values({ orgId: card.orgId, cardId: card.id, fieldId: field.id, value })
            .onConflictDoUpdate({ target: [cardFieldValues.cardId, cardFieldValues.fieldId], set: { value, updatedAt: new Date() } });
        }
        await logActivity(tx, {
          orgId: card.orgId,
          boardId: card.boardId,
          cardId: card.id,
          actorId: me.id,
          action: "card.field_set",
          data: { title: card.title, field: field.name, value: fieldValueText(field, value ?? undefined) },
        });
        return { value };
      }),
  }),
];
