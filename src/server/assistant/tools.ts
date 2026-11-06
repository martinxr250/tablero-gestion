import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { SessionUser } from "../auth/session";
import type { AuditContext } from "../core/audit";
import { AppError } from "../core/errors";
import { withUser } from "../db/client";
import { boards, cards, designProjects, lists, users, workspaces } from "../db/schema";
import { invokeAs, type Method } from "../api/router";

// Herramientas del asistente. Todas actúan con la sesión de la persona a través de la misma API de
// la app (invokeAs): mismos permisos, validaciones y registros de actividad. Las de lectura se
// ejecutan solas; las que cambian algo esperan la confirmación explícita de la persona.

export type ToolCtx = { me: SessionUser; actx: AuditContext; orgId: string };

type Tool<S extends z.ZodType> = {
  description: string;
  input: S;
  write: boolean;
  /** Descripción para la confirmación, armada por el servidor con datos reales (no por la IA). */
  describe?: (ctx: ToolCtx, input: z.infer<S>) => Promise<{ title: string; detail?: string }>;
  run: (ctx: ToolCtx, input: z.infer<S>) => Promise<unknown>;
};
const tool = <S extends z.ZodType>(t: Tool<S>) => t;

async function call(ctx: ToolCtx, method: Method, path: string, body?: unknown) {
  const { compiledRoutes } = await import("../api");
  return (await invokeAs(compiledRoutes, ctx.me, ctx.actx, method, path, body)).data as Record<string, unknown>;
}

const PRIORITY = z.enum(["none", "low", "medium", "high", "urgent"]);
const PRIORITY_ES: Record<string, string> = { none: "sin prioridad", low: "baja", medium: "media", high: "alta", urgent: "urgente" };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("AAAA-MM-DD");
const toDue = (d: string | null | undefined) => (d === undefined ? undefined : d === null ? null : `${d}T23:59:00-03:00`);
/** Texto plano → documento de texto enriquecido (un párrafo por línea). */
const toDoc = (text: string) => ({
  type: "doc",
  content: text
    .split(/\n+/)
    .filter((l) => l.trim())
    .map((l) => ({ type: "paragraph", content: [{ type: "text", text: l.slice(0, 2000) }] })),
});

/** Texto plano de un documento de texto enriquecido. */
function plainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[]; type?: string };
  if (typeof n.text === "string") return n.text;
  const inner = (n.content ?? []).map(plainText).join(n.type === "doc" || n.type === "bulletList" || n.type === "orderedList" ? "\n" : "");
  return n.type === "paragraph" || n.type === "heading" || n.type === "listItem" ? `${inner}\n` : inner;
}

// Nombres para describir acciones (siempre con los permisos de la persona: si no lo ve, no hay nombre).
async function cardName(ctx: ToolCtx, id: string) {
  const [c] = await withUser(ctx.me.id, (tx) => tx.select({ title: cards.title, board: boards.name }).from(cards).innerJoin(boards, eq(boards.id, cards.boardId)).where(eq(cards.id, id))).catch(() => []);
  return c ? `«${c.title}» (${c.board})` : "una tarjeta";
}
async function listName(ctx: ToolCtx, id: string) {
  const [l] = await withUser(ctx.me.id, (tx) => tx.select({ list: lists.name, board: boards.name }).from(lists).innerJoin(boards, eq(boards.id, lists.boardId)).where(eq(lists.id, id))).catch(() => []);
  return l ? `${l.board} › ${l.list}` : "una lista";
}
async function boardName(ctx: ToolCtx, id: string) {
  const [b] = await withUser(ctx.me.id, (tx) => tx.select({ name: boards.name }).from(boards).where(eq(boards.id, id))).catch(() => []);
  return b ? `«${b.name}»` : "un tablero";
}
async function workspaceName(ctx: ToolCtx, id: string) {
  const [w] = await withUser(ctx.me.id, (tx) => tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, id))).catch(() => []);
  return w ? `«${w.name}»` : "un espacio";
}
async function userNames(ctx: ToolCtx, ids: string[]) {
  if (!ids.length) return "nadie";
  const rows = await withUser(ctx.me.id, (tx) => tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).catch(() => []);
  const m = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((i) => m.get(i) ?? "alguien").join(", ");
}
async function projectName(ctx: ToolCtx, id: string) {
  const [p] = await withUser(ctx.me.id, (tx) => tx.select({ name: designProjects.name }).from(designProjects).where(eq(designProjects.id, id))).catch(() => []);
  return p ? `«${p.name}»` : "un proyecto";
}

const DOC_KIND_ES: Record<string, string> = {
  vision: "la visión",
  requirements: "los requisitos",
  use_cases: "los casos de uso",
  flow: "un diagrama de flujo",
  sequence: "un diagrama de secuencia",
  data_model: "el modelo de datos",
  architecture: "la arquitectura",
  plan: "el plan de proyecto",
};

export const TOOLS = {
  // ------------------------------------------------------------------ lectura
  list_boards: tool({
    description: "Lista los espacios de trabajo y tableros de la organización que la persona puede ver, con sus ids.",
    input: z.object({}),
    write: false,
    run: async (ctx) => {
      const r = (await call(ctx, "GET", `/orgs/${ctx.orgId}/workspaces`)) as { workspaces: { id: string; name: string; role: string | null; boards: { id: string; name: string; role?: string }[] }[] };
      return r.workspaces.map((w) => ({ workspaceId: w.id, workspace: w.name, role: w.role, boards: w.boards.map((b) => ({ boardId: b.id, name: b.name, role: b.role })) }));
    },
  }),
  get_board: tool({
    description: "Estado de un tablero: listas, personas, etiquetas, etapas y tarjetas (resumidas). Usalo antes de crear o mover tarjetas para conocer los ids.",
    input: z.object({ boardId: z.uuid() }),
    write: false,
    run: async (ctx, { boardId }) => {
      const b = (await call(ctx, "GET", `/boards/${boardId}`)) as {
        board: { name: string; workspaceName: string };
        role: string;
        lists: { id: string; name: string }[];
        people: { userId: string; name: string }[];
        labels: { id: string; name: string }[];
        sprints: { id: string; name: string; status: string; startsOn: string; endsOn: string }[];
        cards: { id: string; title: string; listId: string; ownerId: string | null; dueAt: string | null; priority: string; completedAt: string | null; blocked: boolean; estimatePoints: number | null; sprintId: string | null; parentId: string | null; assigneeIds: string[] }[];
      };
      const person = new Map(b.people.map((p) => [p.userId, p.name]));
      return {
        board: b.board.name,
        workspace: b.board.workspaceName,
        yourRole: b.role,
        lists: b.lists.map((l) => ({ listId: l.id, name: l.name })),
        people: b.people.map((p) => ({ userId: p.userId, name: p.name })),
        labels: b.labels.map((l) => ({ labelId: l.id, name: l.name })),
        sprints: b.sprints.map((s) => ({ sprintId: s.id, name: s.name, status: s.status, from: s.startsOn, to: s.endsOn })),
        cards: b.cards.slice(0, 200).map((c) => ({
          cardId: c.id,
          title: c.title,
          listId: c.listId,
          owner: c.ownerId ? (person.get(c.ownerId) ?? null) : null,
          assignees: c.assigneeIds.map((a) => person.get(a)).filter(Boolean),
          due: c.dueAt?.slice(0, 10) ?? null,
          priority: c.priority,
          done: !!c.completedAt,
          blocked: c.blocked,
          points: c.estimatePoints,
          sprintId: c.sprintId,
          isSubtask: !!c.parentId,
        })),
        truncated: b.cards.length > 200,
      };
    },
  }),
  search_cards: tool({
    description: "Busca tarjetas en toda la organización por texto y filtros. status: open (por defecto), completed, overdue.",
    input: z.object({ query: z.string().max(100).default(""), boardId: z.uuid().optional(), mine: z.boolean().optional(), status: z.enum(["open", "completed", "overdue"]).optional() }),
    write: false,
    run: async (ctx, i) => {
      const q = new URLSearchParams({ q: i.query, orgId: ctx.orgId, status: i.status ?? "open" });
      if (i.boardId) q.set("boardId", i.boardId);
      if (i.mine) q.set("assigneeId", "me");
      const r = (await call(ctx, "GET", `/search?${q}`)) as { cards?: { id: string; title: string; boardName?: string; listName?: string; dueAt?: string | null; boardId?: string }[] };
      return (r.cards ?? []).slice(0, 40).map((c) => ({ cardId: c.id, title: c.title, board: c.boardName, boardId: c.boardId, list: c.listName, due: c.dueAt?.slice(0, 10) ?? null }));
    },
  }),
  get_card: tool({
    description: "Detalle de una tarjeta: descripción, checklists, subtareas, comentarios recientes, responsables y fechas.",
    input: z.object({ cardId: z.uuid() }),
    write: false,
    run: async (ctx, { cardId }) => {
      const r = (await call(ctx, "GET", `/cards/${cardId}`)) as { card: Record<string, unknown>; role: string };
      const c = r.card as {
        title: string;
        boardId: string;
        listId: string;
        description: unknown;
        priority: string;
        dueAt: string | null;
        completedAt: string | null;
        ownerId: string | null;
        estimatePoints: number | null;
        checklists?: { title: string; items: { text: string; done: boolean }[] }[];
        subtasks?: { id: string; title: string; done: boolean }[];
      };
      const comments = ((await call(ctx, "GET", `/cards/${cardId}/comments`)) as { comments: { body: string; authorName: string | null; createdAt: string }[] }).comments;
      return {
        cardId,
        yourRole: r.role,
        title: c.title,
        boardId: c.boardId,
        listId: c.listId,
        description: plainText(c.description).slice(0, 3000),
        priority: c.priority,
        due: c.dueAt?.slice(0, 10) ?? null,
        done: !!c.completedAt,
        ownerId: c.ownerId,
        points: c.estimatePoints,
        checklists: c.checklists?.map((l) => ({ title: l.title, items: l.items.map((it) => `${it.done ? "[x]" : "[ ]"} ${it.text}`) })),
        subtasks: c.subtasks?.map((x) => ({ cardId: x.id, title: x.title, done: x.done })),
        recentComments: comments.slice(-8).map((m) => ({ by: m.authorName, at: String(m.createdAt).slice(0, 16), text: m.body.slice(0, 500) })),
      };
    },
  }),
  my_work: tool({
    description: "Las tareas asignadas a la persona que pregunta (abiertas, vencidas y próximas).",
    input: z.object({}),
    write: false,
    run: async (ctx) => {
      const r = (await call(ctx, "GET", `/me/work`)) as Record<string, unknown>;
      return JSON.parse(JSON.stringify(r, (k, v) => (k === "description" || k === "position" ? undefined : v)).slice(0, 30000));
    },
  }),
  list_design_projects: tool({
    description: "Proyectos del Estudio de software (diseño de sistemas) de la organización.",
    input: z.object({}),
    write: false,
    run: async (ctx) => ((await call(ctx, "GET", `/orgs/${ctx.orgId}/design-projects`)) as { projects: unknown[] }).projects,
  }),
  get_design_project: tool({
    description: "Documentos de un proyecto de diseño (visión, requisitos, casos de uso, diagramas, arquitectura, plan) con su texto.",
    input: z.object({ projectId: z.uuid() }),
    write: false,
    run: async (ctx, { projectId }) => {
      const r = (await call(ctx, "GET", `/design-projects/${projectId}`)) as { project: unknown; canEdit: boolean; docs: { id: string; kind: string; title: string; source: string }[] };
      return { project: r.project, canEdit: r.canEdit, docs: r.docs.map((d) => ({ docId: d.id, kind: d.kind, title: d.title, text: d.source.slice(0, 4000) })) };
    },
  }),

  // ------------------------------------------------------------------ acciones (con confirmación)
  create_card: tool({
    description: "Crea una tarjeta en una lista, con datos opcionales (descripción, prioridad, vencimiento, responsable, puntos, etapa).",
    input: z.object({
      listId: z.uuid(),
      title: z.string().min(1).max(200),
      description: z.string().max(5000).optional(),
      priority: PRIORITY.optional(),
      due: date.optional(),
      ownerId: z.uuid().optional(),
      estimatePoints: z.number().min(0).max(1000).optional(),
      sprintId: z.uuid().optional(),
    }),
    write: true,
    describe: async (ctx, i) => ({
      title: `Crear la tarjeta «${i.title}» en ${await listName(ctx, i.listId)}`,
      detail: [
        i.priority && `Prioridad ${PRIORITY_ES[i.priority]}`,
        i.due && `vence ${i.due}`,
        i.ownerId && `responsable: ${await userNames(ctx, [i.ownerId])}`,
        i.estimatePoints != null && `${i.estimatePoints} pts`,
        i.description && `descripción: ${i.description.slice(0, 140)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    }),
    run: async (ctx, i) => {
      const { id } = (await call(ctx, "POST", `/lists/${i.listId}/cards`, { title: i.title })) as { id: string };
      const patch: Record<string, unknown> = {};
      if (i.description) patch.description = toDoc(i.description);
      if (i.priority) patch.priority = i.priority;
      if (i.due) patch.dueAt = toDue(i.due);
      if (i.ownerId) patch.ownerId = i.ownerId;
      if (i.estimatePoints != null) patch.estimatePoints = i.estimatePoints;
      if (i.sprintId) patch.sprintId = i.sprintId;
      if (Object.keys(patch).length) await call(ctx, "PATCH", `/cards/${id}`, patch);
      return { cardId: id, created: true };
    },
  }),
  create_cards_bulk: tool({
    description: "Crea varias tarjetas de una vez en un tablero (hasta 50). listId opcional: si falta, van a la primera lista.",
    input: z.object({
      boardId: z.uuid(),
      cards: z
        .array(z.object({ title: z.string().min(1).max(200), description: z.string().max(3000).optional(), listId: z.uuid().optional(), priority: PRIORITY.optional(), due: date.optional(), ownerId: z.uuid().optional(), estimatePoints: z.number().min(0).max(1000).optional() }))
        .min(1)
        .max(50),
    }),
    write: true,
    describe: async (ctx, i) => ({ title: `Crear ${i.cards.length} tarjetas en ${await boardName(ctx, i.boardId)}`, detail: i.cards.map((c) => `• ${c.title}`).join("\n").slice(0, 1500) }),
    run: async (ctx, i) => {
      const r = await call(ctx, "POST", `/boards/${i.boardId}/cards/bulk`, {
        items: i.cards.map((c) => ({ title: c.title, description: c.description, listId: c.listId, priority: c.priority ?? "none", dueAt: toDue(c.due) ?? null, ownerId: c.ownerId ?? null, estimatePoints: c.estimatePoints ?? null })),
      });
      return { created: r.created };
    },
  }),
  update_card: tool({
    description: "Edita una tarjeta: título, descripción, prioridad, vencimiento (null para quitar), responsable (null para quitar), puntos, etapa o marcarla terminada.",
    input: z.object({
      cardId: z.uuid(),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(5000).optional(),
      priority: PRIORITY.optional(),
      due: date.nullable().optional(),
      ownerId: z.uuid().nullable().optional(),
      estimatePoints: z.number().min(0).max(1000).nullable().optional(),
      sprintId: z.uuid().nullable().optional(),
      completed: z.boolean().optional(),
    }),
    write: true,
    describe: async (ctx, i) => ({
      title: `${i.completed === true ? "Marcar como terminada" : i.completed === false ? "Reabrir" : "Editar"} ${await cardName(ctx, i.cardId)}`,
      detail: [
        i.title && `título: «${i.title}»`,
        i.priority && `prioridad ${PRIORITY_ES[i.priority]}`,
        i.due !== undefined && (i.due ? `vence ${i.due}` : "sin vencimiento"),
        i.ownerId !== undefined && (i.ownerId ? `responsable: ${await userNames(ctx, [i.ownerId])}` : "sin responsable"),
        i.estimatePoints !== undefined && `${i.estimatePoints ?? "sin"} pts`,
        i.sprintId !== undefined && (i.sprintId ? "cambia de etapa" : "sin etapa"),
        i.description && `descripción nueva: ${i.description.slice(0, 140)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    }),
    run: async (ctx, { cardId, ...i }) => {
      const patch: Record<string, unknown> = {};
      if (i.title) patch.title = i.title;
      if (i.description !== undefined) patch.description = toDoc(i.description);
      if (i.priority) patch.priority = i.priority;
      if (i.due !== undefined) patch.dueAt = toDue(i.due);
      if (i.ownerId !== undefined) patch.ownerId = i.ownerId;
      if (i.estimatePoints !== undefined) patch.estimatePoints = i.estimatePoints;
      if (i.sprintId !== undefined) patch.sprintId = i.sprintId;
      if (i.completed !== undefined) patch.completed = i.completed;
      return call(ctx, "PATCH", `/cards/${cardId}`, patch);
    },
  }),
  move_card: tool({
    description: "Mueve una tarjeta a otra lista del mismo tablero (queda al final).",
    input: z.object({ cardId: z.uuid(), listId: z.uuid() }),
    write: true,
    describe: async (ctx, i) => ({ title: `Mover ${await cardName(ctx, i.cardId)} a ${await listName(ctx, i.listId)}` }),
    run: async (ctx, i) => call(ctx, "POST", `/cards/${i.cardId}/move`, { listId: i.listId, afterCardId: null }),
  }),
  set_assignees: tool({
    description: "Define los colaboradores de una tarjeta (reemplaza la lista actual). Usá userIds de get_board.",
    input: z.object({ cardId: z.uuid(), userIds: z.array(z.uuid()).max(20) }),
    write: true,
    describe: async (ctx, i) => ({ title: `Asignar ${await cardName(ctx, i.cardId)}`, detail: `Colaboradores: ${await userNames(ctx, i.userIds)}` }),
    run: async (ctx, i) => call(ctx, "PUT", `/cards/${i.cardId}/assignees`, { userIds: i.userIds }),
  }),
  add_comment: tool({
    description: "Agrega un comentario a una tarjeta en nombre de la persona.",
    input: z.object({ cardId: z.uuid(), text: z.string().min(1).max(5000) }),
    write: true,
    describe: async (ctx, i) => ({ title: `Comentar en ${await cardName(ctx, i.cardId)}`, detail: i.text.slice(0, 500) }),
    run: async (ctx, i) => call(ctx, "POST", `/cards/${i.cardId}/comments`, { body: i.text }),
  }),
  add_checklist: tool({
    description: "Agrega una checklist con ítems a una tarjeta.",
    input: z.object({ cardId: z.uuid(), title: z.string().min(1).max(100), items: z.array(z.string().min(1).max(300)).min(1).max(30) }),
    write: true,
    describe: async (ctx, i) => ({ title: `Agregar la checklist «${i.title}» a ${await cardName(ctx, i.cardId)}`, detail: i.items.map((t) => `• ${t}`).join("\n") }),
    run: async (ctx, i) => {
      const { id } = (await call(ctx, "POST", `/cards/${i.cardId}/checklists`, { title: i.title })) as { id: string };
      for (const text of i.items) await call(ctx, "POST", `/checklists/${id}/items`, { text });
      return { checklistId: id, items: i.items.length };
    },
  }),
  add_subtasks: tool({
    description: "Agrega subtareas a una tarjeta.",
    input: z.object({ cardId: z.uuid(), titles: z.array(z.string().min(1).max(100)).min(1).max(20) }),
    write: true,
    describe: async (ctx, i) => ({ title: `Agregar ${i.titles.length} subtareas a ${await cardName(ctx, i.cardId)}`, detail: i.titles.map((t) => `• ${t}`).join("\n") }),
    run: async (ctx, i) => {
      for (const title of i.titles) await call(ctx, "POST", `/cards/${i.cardId}/subtasks`, { title });
      return { added: i.titles.length };
    },
  }),
  create_list: tool({
    description: "Crea una lista (columna) nueva en un tablero.",
    input: z.object({ boardId: z.uuid(), name: z.string().min(1).max(80) }),
    write: true,
    describe: async (ctx, i) => ({ title: `Crear la lista «${i.name}» en ${await boardName(ctx, i.boardId)}` }),
    run: async (ctx, i) => call(ctx, "POST", `/boards/${i.boardId}/lists`, { name: i.name }),
  }),
  create_board: tool({
    description: "Crea un tablero nuevo (Kanban) en un espacio de trabajo.",
    input: z.object({ workspaceId: z.uuid(), name: z.string().min(1).max(80), description: z.string().max(500).optional() }),
    write: true,
    describe: async (ctx, i) => ({ title: `Crear el tablero «${i.name}» en ${await workspaceName(ctx, i.workspaceId)}`, detail: i.description }),
    run: async (ctx, i) => call(ctx, "POST", `/workspaces/${i.workspaceId}/boards`, { name: i.name, description: i.description }),
  }),
  create_sprint: tool({
    description: "Crea una etapa (sprint) en un tablero con fechas de inicio y fin.",
    input: z.object({ boardId: z.uuid(), name: z.string().min(1).max(80), goal: z.string().max(500).optional(), startsOn: date, endsOn: date }),
    write: true,
    describe: async (ctx, i) => ({ title: `Crear la etapa «${i.name}» en ${await boardName(ctx, i.boardId)}`, detail: `Del ${i.startsOn} al ${i.endsOn}${i.goal ? ` · ${i.goal}` : ""}` }),
    run: async (ctx, i) => call(ctx, "POST", `/boards/${i.boardId}/sprints`, { name: i.name, goal: i.goal, startsOn: i.startsOn, endsOn: i.endsOn }),
  }),
  create_design_project: tool({
    description: "Crea un proyecto en el Estudio de software para diseñar un sistema desde cero (en un espacio de trabajo). brief: la idea del sistema, lo más completa posible.",
    input: z.object({ workspaceId: z.uuid(), name: z.string().min(1).max(120), brief: z.string().max(8000) }),
    write: true,
    describe: async (ctx, i) => ({ title: `Crear el proyecto de diseño «${i.name}» en ${await workspaceName(ctx, i.workspaceId)}`, detail: i.brief.slice(0, 400) }),
    run: async (ctx, i) => call(ctx, "POST", `/orgs/${ctx.orgId}/design-projects`, { workspaceId: i.workspaceId, name: i.name, brief: i.brief }),
  }),
  generate_design_doc: tool({
    description:
      "Genera (o regenera) un documento del proyecto de diseño con IA: vision, requirements, use_cases, data_model, architecture, flow, sequence o plan. Para flow y sequence indicá en focus el proceso o caso de uso. Tarda entre 20 y 90 segundos; pedí uno por vez.",
    input: z.object({ projectId: z.uuid(), kind: z.enum(["vision", "requirements", "use_cases", "flow", "sequence", "data_model", "architecture", "plan"]), focus: z.string().max(500).optional() }),
    write: true,
    describe: async (ctx, i) => ({ title: `Generar ${DOC_KIND_ES[i.kind]} de ${await projectName(ctx, i.projectId)}`, detail: i.focus }),
    run: async (ctx, i) => {
      const d = (await call(ctx, "POST", `/design-projects/${i.projectId}/ai/generate`, { kind: i.kind, focus: i.focus })) as { id: string; title: string; source: string };
      return { docId: d.id, title: d.title, preview: d.source.slice(0, 1500) };
    },
  }),
  apply_design_plan: tool({
    description: "Convierte el plan de un proyecto de diseño en un tablero: una etapa por fase y sus tareas estimadas. Si no se indica boardId, crea un tablero nuevo.",
    input: z.object({ projectId: z.uuid(), docId: z.uuid(), boardId: z.uuid().optional(), boardName: z.string().max(80).optional(), startsOn: date.optional() }),
    write: true,
    describe: async (ctx, i) => ({
      title: `Crear las etapas y tareas del plan de ${await projectName(ctx, i.projectId)}`,
      detail: i.boardId ? `En el tablero ${await boardName(ctx, i.boardId)}` : `En un tablero nuevo${i.boardName ? ` «${i.boardName}»` : ""}${i.startsOn ? `, desde ${i.startsOn}` : ""}`,
    }),
    run: async (ctx, i) => call(ctx, "POST", `/design-projects/${i.projectId}/plan/apply`, { docId: i.docId, boardId: i.boardId, boardName: i.boardName, startsOn: i.startsOn }),
  }),
} as const;

export type ToolName = keyof typeof TOOLS;

const withoutMeta = (schema: Record<string, unknown>) => {
  const copy = { ...schema };
  delete copy.$schema;
  return copy as { type: "object"; properties?: Record<string, unknown> };
};

/** Definiciones para la API de Claude (JSON Schema a partir de los esquemas Zod). */
export const toolDefinitions = Object.entries(TOOLS).map(([name, t]) => ({
  name,
  description: `${t.description}${t.write ? " (Requiere confirmación de la persona antes de ejecutarse.)" : ""}`,
  input_schema: withoutMeta(z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>),
}));

export const isTool = (name: string): name is ToolName => name in TOOLS;

/** Error de herramienta en palabras simples (para devolverle a la IA, sin detalles internos). */
export function toolError(err: unknown): string {
  if (err instanceof AppError) return `Error ${err.status}: ${err.message}`;
  if (err instanceof z.ZodError) return `Datos inválidos: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
  return "Error inesperado al ejecutar la acción.";
}
