import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import type { SessionUser } from "../auth/session";
import type { AuditContext } from "../core/audit";
import { AppError, conflict, notFound } from "../core/errors";
import { env } from "../core/env";
import { uuidv7 } from "../core/ids";
import { logger } from "../core/logger";
import { withUser } from "../db/client";
import { aiConversations, organizations } from "../db/schema";
import { aiClient, aiError, checkQuota, recordUsage } from "../ai/claude";
import { UNTRUSTED_NOTE } from "../ai/content";
import { isTool, toolDefinitions, toolError, TOOLS, type ToolCtx } from "../assistant/tools";
import { orgAccess } from "./access";

// Asistente IA con acciones. La conversación se guarda en el servidor (privada de cada persona).
// Claude consulta datos con herramientas de lectura y propone cambios con herramientas de escritura;
// los cambios se ejecutan solo cuando la persona los confirma, con sus propios permisos.

type Block = Anthropic.Beta.BetaContentBlockParam;
type ActionUi = { title: string; detail?: string; status: "pending" | "done" | "declined" | "error"; error?: string };
/** Mensaje guardado: el de la API más datos para mostrar (ui), que se quitan antes de enviarlo. */
type Stored = { role: "user" | "assistant"; content: Block[]; ui?: { actions?: Record<string, ActionUi>; at?: string } };
type Pending = { results: Anthropic.Beta.BetaToolResultBlockParam[]; actions: { id: string; name: string; input: unknown; title: string; detail?: string }[] };

const MAX_ITERATIONS = 10;
const BUDGET_MS = 200_000; // margen dentro de los 300 s de la función
const LOCK_MS = 280_000;
const RESULT_CHARS = 20_000;
const KEEP_MESSAGES = 80;

const READ_LABEL: Record<string, string> = {
  list_boards: "Revisó tus tableros",
  get_board: "Leyó un tablero",
  search_cards: "Buscó tarjetas",
  get_card: "Leyó una tarjeta",
  my_work: "Revisó tus tareas",
  list_design_projects: "Revisó los proyectos de diseño",
  get_design_project: "Leyó un proyecto de diseño",
};

function system(user: SessionUser, orgName: string, context?: { boardId?: string; cardId?: string; projectId?: string }) {
  const today = new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Argentina/Buenos_Aires" });
  const where = context?.cardId ? `La persona tiene abierta la tarjeta ${context.cardId}.` : context?.boardId ? `La persona está mirando el tablero ${context.boardId}.` : context?.projectId ? `La persona está en el proyecto de diseño ${context.projectId}.` : "";
  return `Sos el asistente de Tableros, una plataforma de gestión de proyectos con tableros Kanban y un Estudio de software para diseñar sistemas desde cero (visión, requisitos, casos de uso, diagramas, arquitectura y plan). Ayudás a ${user.name} en la organización «${orgName}». Hoy es ${today}. ${where}

Cómo trabajás:
- Usá las herramientas de lectura para obtener datos e ids reales; nunca inventes ids, nombres ni datos.
- Cuando la persona pida hacer algo (crear, mover, asignar, comentar, diseñar…), proponé las acciones con las herramientas de escritura. No se ejecutan hasta que la persona las confirma en pantalla, así que no pidas permiso por texto: proponelas directamente y agrupá en un mismo turno las que van juntas.
- Si falta un dato importante (por ejemplo, en qué tablero), elegí lo más razonable según el contexto o preguntá en una frase.
- Si una acción falla o la persona la rechaza, explicalo y ofrecé una alternativa.
- Para diseñar un sistema desde cero: creá el proyecto de diseño con una idea bien descrita y generá los documentos de a uno (visión, requisitos, casos de uso, modelo de datos, arquitectura, flujos y plan). Al final podés convertir el plan en un tablero.
- Presentate como «la IA de Tableros» o «el asistente»; no hables del modelo ni del proveedor que hay detrás.
- Respondé en español rioplatense, breve y concreto, con Markdown simple (viñetas, **negrita**, subtítulos ###). Al mencionar tarjetas, tableros o proyectos usá enlaces así: [título](card:ID), [nombre](board:ID), [nombre](design:ID).
${UNTRUSTED_NOTE}`;
}

const toApi = (m: Stored[]): Anthropic.Beta.BetaMessageParam[] => m.map(({ role, content }) => ({ role, content }));
const clipResult = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? { ok: true });
  return s.length > RESULT_CHARS ? `${s.slice(0, RESULT_CHARS)}… (recortado)` : s;
};

/** Conserva los últimos mensajes empezando siempre por un mensaje de texto de la persona. */
function trim(messages: Stored[]) {
  if (messages.length <= KEEP_MESSAGES) return messages;
  let start = messages.length - KEEP_MESSAGES;
  while (start < messages.length && !(messages[start]!.role === "user" && messages[start]!.content.some((b) => b.type === "text") && !messages[start]!.content.some((b) => b.type === "tool_result"))) start++;
  return messages.slice(start);
}

async function loadConversation(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Conversación");
  const [c] = await withUser(userId, (tx) => tx.select().from(aiConversations).where(eq(aiConversations.id, id)));
  if (!c) throw notFound("Conversación");
  return c;
}

/** Toma la conversación para procesarla (evita dos pedidos a la vez sobre la misma). */
async function lock(userId: string, id: string) {
  const rows = await withUser(userId, (tx) =>
    tx
      .update(aiConversations)
      .set({ lockedUntil: new Date(Date.now() + LOCK_MS) })
      .where(and(eq(aiConversations.id, id), or(isNull(aiConversations.lockedUntil), lt(aiConversations.lockedUntil, new Date()))))
      .returning({ id: aiConversations.id }),
  );
  if (!rows.length) throw conflict("El asistente todavía está trabajando en esta conversación.", "assistant_busy");
}

async function save(userId: string, id: string, messages: Stored[], pending: Pending | null, title?: string) {
  await withUser(userId, (tx) =>
    tx
      .update(aiConversations)
      .set({ messages: trim(messages), pending, lockedUntil: null, updatedAt: new Date(), ...(title ? { title } : {}) })
      .where(eq(aiConversations.id, id)),
  );
}

async function runTool(ctx: ToolCtx, name: string, input: unknown): Promise<{ ok: boolean; content: string }> {
  if (!isTool(name)) return { ok: false, content: `No existe la herramienta ${name}.` };
  const t = TOOLS[name] as { input: z.ZodType; run: (c: ToolCtx, i: unknown) => Promise<unknown> };
  try {
    const parsed = t.input.parse(input ?? {});
    return { ok: true, content: clipResult(await t.run(ctx, parsed)) };
  } catch (err) {
    if (!(err instanceof AppError) && !(err instanceof z.ZodError)) logger.error("assistant_tool_error", { tool: name, err });
    return { ok: false, content: toolError(err) };
  }
}

type LoopResult = { status: "done" | "needs_confirmation" | "continue" };

/** Bucle: pide a Claude, ejecuta lecturas, y frena ante acciones que necesitan confirmación. */
async function loop(ctx: ToolCtx, convId: string, messages: Stored[], sys: string, title?: string): Promise<LoopResult> {
  const started = Date.now();
  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (Date.now() - started > BUDGET_MS) {
        await save(ctx.me.id, convId, messages, null, title);
        return { status: "continue" };
      }
      await checkQuota(ctx.orgId);
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await aiClient().beta.messages.create(
          {
            model: env().AI_MODEL,
            max_tokens: 8000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: sys,
            tools: toolDefinitions as Anthropic.Beta.BetaToolUnion[],
            output_config: { effort: "medium" },
            messages: toApi(messages),
          },
          { timeout: 120_000, maxRetries: 1 },
        );
      } catch (err) {
        throw aiError(err);
      }
      await recordUsage({ orgId: ctx.orgId, userId: ctx.me.id, feature: "assistant" }, response);
      messages.push({ role: "assistant", content: response.content as Block[], ui: { at: new Date().toISOString() } });
      if (response.stop_reason === "refusal") {
        messages.at(-1)!.content = [{ type: "text", text: "No puedo ayudar con ese pedido." }];
        await save(ctx.me.id, convId, messages, null, title);
        return { status: "done" };
      }
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) {
        await save(ctx.me.id, convId, messages, null, title);
        return { status: "done" };
      }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      const actions: Pending["actions"] = [];
      const ui: Record<string, ActionUi> = {};
      for (const use of uses) {
        const def = isTool(use.name) ? TOOLS[use.name] : null;
        if (def && def.write) {
          const parsed = def.input.safeParse(use.input ?? {});
          if (!parsed.success) {
            results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: toolError(parsed.error) });
            continue;
          }
          const d = await (def.describe as (c: ToolCtx, i: unknown) => Promise<{ title: string; detail?: string }>)(ctx, parsed.data);
          actions.push({ id: use.id, name: use.name, input: parsed.data, title: d.title, detail: d.detail || undefined });
        } else {
          const r = await runTool(ctx, use.name, use.input);
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: !r.ok, content: r.content });
          ui[use.id] = { title: READ_LABEL[use.name] ?? use.name, status: r.ok ? "done" : "error", error: r.ok ? undefined : r.content };
        }
      }
      if (actions.length) {
        await save(ctx.me.id, convId, messages, { results, actions }, title);
        return { status: "needs_confirmation" };
      }
      messages.push({ role: "user", content: results, ui: { actions: ui } });
    }
    await save(ctx.me.id, convId, messages, null, title);
    return { status: "continue" };
  } catch (err) {
    // Si la llamada falló, se descarta un turno de la IA a medio armar y se libera la conversación.
    while (messages.length && messages.at(-1)!.role === "assistant" && messages.at(-1)!.content.some((b) => b.type === "tool_use")) messages.pop();
    await save(ctx.me.id, convId, messages, null, title).catch(() => {});
    throw err;
  }
}

/** Ejecuta (o rechaza) las acciones pendientes y arma el mensaje con todos los resultados. */
async function resolvePending(ctx: ToolCtx, pending: Pending, approve: Set<string>): Promise<Stored> {
  const results = [...pending.results];
  const actions: Record<string, ActionUi> = {};
  for (const a of pending.actions) {
    if (!approve.has(a.id)) {
      results.push({ type: "tool_result", tool_use_id: a.id, is_error: true, content: "La persona no aprobó esta acción; no se ejecutó." });
      actions[a.id] = { title: a.title, detail: a.detail, status: "declined" };
      continue;
    }
    const r = await runTool(ctx, a.name, a.input);
    results.push({ type: "tool_result", tool_use_id: a.id, is_error: !r.ok, content: r.content });
    actions[a.id] = { title: a.title, detail: a.detail, status: r.ok ? "done" : "error", error: r.ok ? undefined : r.content.replace(/^Error \d+: /, "") };
  }
  return { role: "user", content: results, ui: { actions } };
}

/** Vista para la pantalla: textos, pasos de lectura y acciones con su estado. */
function view(c: typeof aiConversations.$inferSelect) {
  const messages = c.messages as Stored[];
  const pending = c.pending as Pending | null;
  const out: ({ type: "user"; text: string; at?: string } | { type: "assistant"; text: string; at?: string } | { type: "steps"; items: ActionUi[] } | { type: "actions"; items: (ActionUi & { id: string })[] })[] = [];
  messages.forEach((m, idx) => {
    if (m.role === "user") {
      const text = m.content.filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text").map((b) => b.text).join("\n");
      const acts = Object.entries(m.ui?.actions ?? {});
      const steps = acts.filter(([id]) => isReadUse(messages, idx, id)).map(([, a]) => a);
      const writes = acts.filter(([id]) => !isReadUse(messages, idx, id)).map(([id, a]) => ({ ...a, id }));
      if (steps.length) out.push({ type: "steps", items: steps });
      if (writes.length) out.push({ type: "actions", items: writes });
      if (text) out.push({ type: "user", text, at: m.ui?.at });
    } else {
      const text = m.content.filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text").map((b) => b.text).join("\n\n").trim();
      if (text) out.push({ type: "assistant", text, at: m.ui?.at });
    }
  });
  return {
    id: c.id,
    title: c.title,
    items: out,
    pending: pending?.actions.map((a) => ({ id: a.id, title: a.title, detail: a.detail, tool: a.name })) ?? [],
    busy: !!c.lockedUntil && c.lockedUntil > new Date(),
    updatedAt: c.updatedAt,
  };
}
/** Si el tool_use con ese id (en el mensaje anterior) es de lectura. */
function isReadUse(messages: Stored[], idx: number, id: string) {
  const prev = messages[idx - 1];
  const use = prev?.content.find((b) => b.type === "tool_use" && (b as { id: string }).id === id) as { name: string } | undefined;
  return !!use && isTool(use.name) && !TOOLS[use.name].write;
}

const contextSchema = z.object({ boardId: z.uuid().optional(), cardId: z.uuid().optional(), projectId: z.uuid().optional() }).optional();
const rate = [{ name: "assistant", by: "user" as const, limit: 60, windowSec: 3600 }];

async function prepare(me: SessionUser, actx: AuditContext, convId: string) {
  const conv = await loadConversation(me.id, convId);
  const orgName = await withUser(me.id, async (tx) => {
    await orgAccess(tx, me.id, conv.orgId);
    const [o] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, conv.orgId));
    return o?.name ?? "";
  });
  return { conv, ctx: { me, actx, orgId: conv.orgId } satisfies ToolCtx, orgName };
}

export const assistantRoutes = [
  route({
    method: "GET",
    path: "/orgs/:orgId/assistant/conversations",
    summary: "Conversaciones del asistente IA de la persona en la organización",
    tag: "Asistente",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId);
        const rows = await tx
          .select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt })
          .from(aiConversations)
          .where(and(eq(aiConversations.orgId, params.orgId), eq(aiConversations.userId, me.id)))
          .orderBy(desc(aiConversations.updatedAt))
          .limit(50);
        return { conversations: rows };
      }),
  }),

  route({
    method: "POST",
    path: "/orgs/:orgId/assistant/conversations",
    summary: "Empezar una conversación con el asistente",
    tag: "Asistente",
    status: 201,
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        await orgAccess(tx, me.id, params.orgId);
        const id = uuidv7();
        await tx.insert(aiConversations).values({ id, orgId: params.orgId, userId: me.id });
        return { id };
      }),
  }),

  route({
    method: "GET",
    path: "/assistant/conversations/:conversationId",
    summary: "Mensajes y acciones pendientes de una conversación",
    tag: "Asistente",
    handler: async ({ me, params }) => view(await loadConversation(me.id, params.conversationId)),
  }),

  route({
    method: "DELETE",
    path: "/assistant/conversations/:conversationId",
    summary: "Borrar una conversación",
    tag: "Asistente",
    handler: async ({ me, params }) => {
      const c = await loadConversation(me.id, params.conversationId);
      await withUser(me.id, (tx) => tx.delete(aiConversations).where(eq(aiConversations.id, c.id)));
      return undefined;
    },
  }),

  route({
    method: "POST",
    path: "/assistant/conversations/:conversationId/messages",
    summary: "Enviar un mensaje al asistente (puede proponer acciones que esperan confirmación)",
    tag: "Asistente",
    rateLimit: rate,
    body: z.object({ text: z.string().trim().min(1).max(4000), context: contextSchema }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { conv, ctx, orgName } = await prepare(me, actx, params.conversationId);
      await lock(me.id, conv.id);
      try {
        const messages = [...(conv.messages as Stored[])];
        const blocks: Block[] = [];
        let ui: Stored["ui"] = { at: new Date().toISOString() };
        // Un mensaje nuevo con acciones sin confirmar las rechaza.
        if (conv.pending) {
          const declined = await resolvePending(ctx, conv.pending as Pending, new Set());
          blocks.push(...declined.content);
          ui = { ...ui, actions: declined.ui?.actions };
        }
        blocks.push({ type: "text", text: body.text });
        messages.push({ role: "user", content: blocks, ui });
        const first = !(conv.messages as Stored[]).length;
        const r = await loop(ctx, conv.id, messages, system(me, orgName, body.context), first ? body.text.slice(0, 80) : undefined);
        return { ...r, conversation: view(await loadConversation(me.id, conv.id)) };
      } catch (err) {
        await withUser(me.id, (tx) => tx.update(aiConversations).set({ lockedUntil: null }).where(eq(aiConversations.id, conv.id))).catch(() => {});
        throw err;
      }
    },
  }),

  route({
    method: "POST",
    path: "/assistant/conversations/:conversationId/confirm",
    summary: "Confirmar o rechazar las acciones propuestas por el asistente",
    tag: "Asistente",
    rateLimit: rate,
    body: z.object({ approve: z.array(z.string().max(100)).max(50), context: contextSchema }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { conv, ctx, orgName } = await prepare(me, actx, params.conversationId);
      if (!conv.pending) throw conflict("No hay acciones esperando confirmación.", "nothing_pending");
      await lock(me.id, conv.id);
      try {
        const messages = [...(conv.messages as Stored[])];
        messages.push(await resolvePending(ctx, conv.pending as Pending, new Set(body.approve)));
        await save(me.id, conv.id, messages, null);
        await lock(me.id, conv.id);
        const r = await loop(ctx, conv.id, messages, system(me, orgName, body.context));
        return { ...r, conversation: view(await loadConversation(me.id, conv.id)) };
      } catch (err) {
        await withUser(me.id, (tx) => tx.update(aiConversations).set({ lockedUntil: null }).where(eq(aiConversations.id, conv.id))).catch(() => {});
        throw err;
      }
    },
  }),

  route({
    method: "POST",
    path: "/assistant/conversations/:conversationId/continue",
    summary: "Seguir trabajando cuando el asistente pausó por tiempo",
    tag: "Asistente",
    rateLimit: rate,
    body: z.object({ context: contextSchema }),
    handler: async ({ me, params, body, audit: actx }) => {
      const { conv, ctx, orgName } = await prepare(me, actx, params.conversationId);
      const messages = [...(conv.messages as Stored[])];
      const last = messages.at(-1);
      if (conv.pending || !last || last.role !== "user") return { status: "done", conversation: view(conv) };
      await lock(me.id, conv.id);
      try {
        const r = await loop(ctx, conv.id, messages, system(me, orgName, body.context));
        return { ...r, conversation: view(await loadConversation(me.id, conv.id)) };
      } catch (err) {
        await withUser(me.id, (tx) => tx.update(aiConversations).set({ lockedUntil: null }).where(eq(aiConversations.id, conv.id))).catch(() => {});
        throw err;
      }
    },
  }),
];
