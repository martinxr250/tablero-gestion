import "server-only";
import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { route } from "../api/router";
import { badRequest } from "../core/errors";
import { withUser } from "../db/client";
import { activityLogs, attachments, boardFiles, cards, checklistItems, checklists, comments, labels, lists, sprints, users } from "../db/schema";
import { storage } from "../storage/storage";
import { aiEnabled, generate, monthlyUsage, type AiInput } from "../ai/claude";
import { AI_READABLE, fileToContent, UNTRUSTED_NOTE } from "../ai/content";
import { env } from "../core/env";
import { boardAccess, cardAccess, orgAccess } from "./access";
import { boardFileFor } from "./board-files";
import { boardCards, boardPeople } from "./boards";
import { boardSignals } from "./signals";
import { logActivity } from "./shared";

// Esquemas de respuesta: sin restricciones de largo (no todas son admitidas por las salidas
// estructuradas); los límites se aplican al recibir la respuesta.
const TaskSchema = z.object({
  title: z.string(),
  description: z.string(),
  priority: z.enum(["none", "low", "medium", "high", "urgent"]),
  due: z.string().describe("Fecha de vencimiento AAAA-MM-DD si el material la indica; si no, cadena vacía"),
  estimatePoints: z.number().nullable().describe("Puntos de esfuerzo solo si el material los indica; si no, null"),
  owner: z.string().describe("Nombre de la persona responsable solo si coincide con una de la lista; si no, cadena vacía"),
  labels: z.array(z.string()),
  subtasks: z.array(z.string()),
});
const TasksSchema = z.object({ tasks: z.array(TaskSchema) });
const AssistSchema = z.object({
  summary: z.string(),
  subtasks: z.array(z.string()),
  checklist: z.array(z.string()),
  risks: z.array(z.string()),
});
const FileSummarySchema = z.object({ summary: z.string(), keyPoints: z.array(z.string()) });
const AskSchema = z.object({ answer: z.string(), cards: z.array(z.number().int()) });
const BriefingSchema = z.object({
  headline: z.string(),
  highlights: z.array(z.string()),
  risks: z.array(z.string()),
  nextActions: z.array(z.string()),
});

const clip = (s: string, n: number) => s.trim().slice(0, n);
const clipList = (a: string[], items: number, chars: number) => a.map((x) => clip(x, chars)).filter(Boolean).slice(0, items);
const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : "");

async function readFile(storageKey: string, mime: string, name: string) {
  const bytes = await storage().get(storageKey);
  return fileToContent({ bytes, mime, name });
}

export const aiRoutes = [
  route({
    method: "GET",
    path: "/ai/status",
    summary: "Si la IA está disponible en este servidor",
    tag: "IA",
    handler: async () => ({ enabled: aiEnabled() }),
  }),

  route({
    method: "GET",
    path: "/orgs/:orgId/ai/usage",
    summary: "Consumo de IA de la organización en el mes (administradores)",
    tag: "IA",
    handler: async ({ me, params }) => {
      await withUser(me.id, (tx) => orgAccess(tx, me.id, params.orgId, "admin"));
      return { usedTokens: await monthlyUsage(params.orgId), monthlyLimit: env().AI_MONTHLY_TOKENS, enabled: aiEnabled() };
    },
  }),

  route({
    method: "POST",
    path: "/boards/:boardId/ai/tasks",
    summary: "Proponer tareas a partir de un archivo del tablero o de un texto (se revisan antes de crearlas)",
    tag: "IA",
    rateLimit: [{ name: "ai", by: "user", limit: 30, windowSec: 3600 }],
    body: z.object({ fileId: z.uuid().optional(), text: z.string().trim().max(20_000).optional() }).refine((b) => b.fileId || b.text, "Indicá un archivo o un texto"),
    handler: async ({ me, params, body }) => {
      const ctx = await withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "edit");
        const [listRows, labelRows, people] = await Promise.all([
          tx.select({ name: lists.name }).from(lists).where(and(eq(lists.boardId, board.id), isNull(lists.archivedAt))).orderBy(asc(lists.position)),
          tx.select({ name: labels.name }).from(labels).where(eq(labels.boardId, board.id)),
          boardPeople(tx, board.id),
        ]);
        return { board, lists: listRows.map((l) => l.name), labels: labelRows.map((l) => l.name), people: people.map((p) => p.name) };
      });
      const content: AiInput[] = [];
      if (body.fileId) {
        const { file } = await boardFileFor(me.id, body.fileId, "view");
        if (file.boardId !== ctx.board.id) throw badRequest("El archivo es de otro tablero");
        if (!AI_READABLE.has(file.mime)) throw badRequest("La IA lee PDF, imágenes y archivos de texto. Este tipo de archivo no lo puede leer.");
        const block = await readFile(file.storageKey, file.mime, file.fileName);
        if (block) content.push(block);
      }
      if (body.text) content.push({ type: "document", source: { type: "text", media_type: "text/plain", data: body.text }, title: "Texto pegado" });
      content.push({
        type: "text",
        text: [
          `Tablero: "${ctx.board.name}". Listas: ${ctx.lists.join(", ") || "—"}. Etiquetas existentes: ${ctx.labels.join(", ") || "—"}.`,
          `Personas del tablero: ${ctx.people.join(", ") || "—"}.`,
          `Hoy es ${new Date().toISOString().slice(0, 10)}.`,
          "Convertí el material en una lista de tareas concretas y accionables para este tablero. Agrupá el trabajo grande en una tarea con subtareas.",
          "Usá etiquetas existentes cuando correspondan. No inventes fechas, responsables ni estimaciones que el material no indique.",
        ].join("\n"),
      });
      const out = await generate(
        { orgId: ctx.board.orgId, userId: me.id, boardId: ctx.board.id, feature: "tasks_from_file" },
        { system: `Sos un asistente de planificación de proyectos. ${UNTRUSTED_NOTE}`, content, schema: TasksSchema, maxTokens: 12000 },
      );
      const peopleSet = new Set(ctx.people.map((p) => p.toLowerCase()));
      return {
        tasks: out.tasks.slice(0, 60).map((t) => ({
          title: clip(t.title, 200),
          description: clip(t.description, 1000),
          priority: t.priority,
          due: isoDate(t.due),
          estimatePoints: t.estimatePoints !== null && t.estimatePoints >= 0 && t.estimatePoints <= 1000 ? Math.round(t.estimatePoints * 2) / 2 : null,
          owner: peopleSet.has(t.owner.toLowerCase()) ? t.owner : "",
          labels: clipList(t.labels, 5, 40),
          subtasks: clipList(t.subtasks, 15, 200),
        })).filter((t) => t.title),
      };
    },
  }),

  route({
    method: "POST",
    path: "/cards/:cardId/ai/assist",
    summary: "Resumen de la tarjeta, riesgos y (para quien edita) subtareas y checklist sugeridas; lee sus PDF e imágenes",
    tag: "IA",
    rateLimit: [{ name: "ai", by: "user", limit: 30, windowSec: 3600 }],
    handler: async ({ me, params }) => {
      const data = await withUser(me.id, async (tx) => {
        const { card, board, role } = await cardAccess(tx, { actorId: me.id }, params.cardId, "view");
        const [items, recent, subtasks, files] = await Promise.all([
          tx.select({ list: checklists.title, text: checklistItems.text, doneAt: checklistItems.doneAt }).from(checklistItems).innerJoin(checklists, eq(checklists.id, checklistItems.checklistId)).where(eq(checklists.cardId, card.id)),
          tx.select({ body: comments.body }).from(comments).where(and(eq(comments.cardId, card.id), isNull(comments.deletedAt))).orderBy(desc(comments.createdAt)).limit(20),
          tx.select({ title: cards.title }).from(cards).where(and(eq(cards.parentId, card.id), isNull(cards.archivedAt))),
          tx.select().from(attachments).where(eq(attachments.cardId, card.id)).orderBy(desc(attachments.createdAt)),
        ]);
        return { card, board, items, recent, subtasks, files, canApply: (role === "editor" || role === "admin") && !board.archivedAt };
      });
      const content: AiInput[] = [];
      // Hasta 3 archivos legibles (PDF, imágenes, texto) de la tarjeta.
      for (const f of data.files.filter((f) => AI_READABLE.has(f.mime)).slice(0, 3)) {
        const block = await readFile(f.storageKey, f.mime, f.fileName).catch(() => null);
        if (block) content.push(block);
      }
      const plain = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 2000);
      content.push({
        type: "text",
        text: [
          `Tarjeta: "${data.card.title}" (tablero "${data.board.name}").`,
          `Descripción: ${data.card.descriptionText || "(sin descripción)"}`,
          data.subtasks.length ? `Subtareas que ya existen: ${data.subtasks.map((s) => s.title).join("; ")}` : "Sin subtareas.",
          data.items.length ? `Checklist actual: ${data.items.map((i) => `${i.doneAt ? "[x]" : "[ ]"} ${i.text}`).join("; ")}` : "Sin checklist.",
          data.recent.length ? `Comentarios recientes:\n${data.recent.map((c) => `- ${plain(c.body)}`).join("\n")}` : "Sin comentarios.",
          "Resumí en pocas líneas qué hay que hacer y su estado. Proponé subtareas nuevas (no repitas las existentes), ítems de checklist para verificar el trabajo y riesgos concretos.",
        ].join("\n\n"),
      });
      const out = await generate(
        { orgId: data.board.orgId, userId: me.id, boardId: data.board.id, feature: "card_assist" },
        { system: `Sos un asistente de gestión de proyectos que ayuda a ordenar el trabajo de una tarea. ${UNTRUSTED_NOTE}`, content, schema: AssistSchema },
      );
      const existing = new Set(data.subtasks.map((s) => s.title.toLowerCase()));
      return {
        summary: clip(out.summary, 1500),
        // Quien solo ve recibe la explicación y los riesgos; las sugerencias para aplicar son de quien edita.
        canApply: data.canApply,
        subtasks: data.canApply ? clipList(out.subtasks, 10, 200).filter((s) => !existing.has(s.toLowerCase())) : [],
        checklist: data.canApply ? clipList(out.checklist, 12, 300) : [],
        risks: clipList(out.risks, 5, 300),
        filesRead: Math.min(3, data.files.filter((f) => AI_READABLE.has(f.mime)).length),
      };
    },
  }),

  route({
    method: "POST",
    path: "/board-files/:fileId/ai/summary",
    summary: "Resumir un archivo del tablero (queda guardado)",
    tag: "IA",
    rateLimit: [{ name: "ai", by: "user", limit: 30, windowSec: 3600 }],
    handler: async ({ me, params }) => {
      const { file, board } = await boardFileFor(me.id, params.fileId, "edit");
      if (!AI_READABLE.has(file.mime)) throw badRequest("La IA lee PDF, imágenes y archivos de texto. Este tipo de archivo no lo puede leer.");
      const block = await readFile(file.storageKey, file.mime, file.fileName);
      const out = await generate(
        { orgId: board.orgId, userId: me.id, boardId: board.id, feature: "file_summary" },
        {
          system: `Sos un asistente que resume documentos de trabajo para un equipo. ${UNTRUSTED_NOTE}`,
          content: [block!, { type: "text", text: "Resumí este material para el equipo: de qué se trata y los puntos clave (decisiones, fechas, requisitos, pendientes)." }],
          schema: FileSummarySchema,
        },
      );
      const points = clipList(out.keyPoints, 8, 300);
      const text = clip([clip(out.summary, 1500), ...points.map((p) => `• ${p}`)].join("\n"), 4000);
      await withUser(me.id, async (tx) => {
        await tx.update(boardFiles).set({ aiSummary: text, aiSummaryAt: new Date() }).where(eq(boardFiles.id, file.id));
        await logActivity(tx, { orgId: board.orgId, boardId: board.id, actorId: me.id, action: "board_file.summarized", data: { file: file.fileName } });
      });
      return { summary: text };
    },
  }),

  route({
    method: "POST",
    path: "/boards/:boardId/ai/ask",
    summary: "Preguntale al tablero: respuestas con los datos que la persona puede ver (para todos los roles)",
    tag: "IA",
    rateLimit: [{ name: "ai", by: "user", limit: 30, windowSec: 3600 }],
    body: z.object({ question: z.string().trim().min(3).max(500) }),
    handler: async ({ me, params, body }) => {
      const snap = await withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "view", { allowArchived: true });
        const [cardRows, listRows, people, labelRows, sprintRows, activity] = await Promise.all([
          boardCards(tx, board.id),
          tx.select({ id: lists.id, name: lists.name }).from(lists).where(and(eq(lists.boardId, board.id), isNull(lists.archivedAt))),
          boardPeople(tx, board.id),
          tx.select({ id: labels.id, name: labels.name }).from(labels).where(eq(labels.boardId, board.id)),
          tx.select({ id: sprints.id, name: sprints.name, status: sprints.status, endsOn: sprints.endsOn }).from(sprints).where(eq(sprints.boardId, board.id)),
          tx
            .select({ at: activityLogs.createdAt, action: activityLogs.action, data: activityLogs.data, who: users.name })
            .from(activityLogs)
            .leftJoin(users, eq(users.id, activityLogs.actorId))
            .where(and(eq(activityLogs.boardId, board.id), gt(activityLogs.createdAt, new Date(Date.now() - 14 * 86_400_000))))
            .orderBy(desc(activityLogs.id))
            .limit(80),
        ]);
        return { board, cardRows, listRows, people, labelRows, sprintRows, activity };
      });
      const list = new Map(snap.listRows.map((l) => [l.id, l.name]));
      const person = new Map(snap.people.map((p) => [p.user_id, p.name]));
      const label = new Map(snap.labelRows.map((l) => [l.id, l.name]));
      const sprint = new Map(snap.sprintRows.map((s) => [s.id, s.name]));
      // Tarjetas abiertas y las terminadas en los últimos 30 días (hasta 300), numeradas.
      const recentDone = Date.now() - 30 * 86_400_000;
      const pool = snap.cardRows.filter((c) => (!c.completedAt || new Date(c.completedAt).getTime() > recentDone)).slice(0, 300);
      const rows = pool.map((c, i) => ({
        n: i + 1,
        titulo: c.title,
        lista: list.get(c.listId) ?? "",
        responsable: c.ownerId ? (person.get(c.ownerId) ?? "") : "",
        colaboradores: c.assigneeIds.map((a) => person.get(a)).filter(Boolean),
        prioridad: c.priority,
        vence: c.dueAt ? new Date(c.dueAt).toISOString().slice(0, 10) : null,
        terminada: !!c.completedAt,
        bloqueada: c.blocked,
        qa: c.qaStatus,
        etapa: c.sprintId ? (sprint.get(c.sprintId) ?? null) : null,
        etiquetas: c.labelIds.map((l) => label.get(l)).filter(Boolean),
        puntos: c.estimatePoints,
        subtareas: c.subtaskTotal ? `${c.subtaskDone}/${c.subtaskTotal}` : null,
        resumen: c.excerpt || null,
      }));
      const activity = snap.activity.map((a) => ({
        fecha: a.at.toISOString().slice(0, 16).replace("T", " "),
        persona: a.who ?? "Sistema",
        accion: a.action,
        tarjeta: typeof a.data?.title === "string" ? a.data.title : undefined,
      }));
      const me_ = person.get(me.id) ?? "";
      const out = await generate(
        { orgId: snap.board.orgId, userId: me.id, boardId: snap.board.id, feature: "board_ask" },
        {
          system: `Respondés preguntas sobre un tablero de proyecto usando solo los datos que te pasan (tarjetas y actividad de los últimos 14 días). Si los datos no alcanzan para responder, decilo. Sé concreto y fácil de escanear. Formato (Markdown simple): empezá con una o dos oraciones que respondan directo; después, si hace falta detalle, usá subtítulos "### " cortos y viñetas "- " (una idea por viñeta), y **negrita** solo para lo clave (personas, fechas, estados). Nada de tablas ni bloques de código. Para citar una tarjeta escribí [[n]] con su número, en lugar de repetir el título. ${UNTRUSTED_NOTE}`,
          content: [
            {
              type: "text",
              text: `Tablero "${snap.board.name}". Hoy es ${new Date().toISOString().slice(0, 10)}. Quien pregunta: ${me_ || "una persona del equipo"}.\n\nTarjetas (JSON):\n${JSON.stringify(rows)}\n\nActividad reciente (JSON):\n${JSON.stringify(activity)}`,
            },
            { type: "text", text: `Pregunta: ${body.question}\n\nEn "cards" devolvé los números (n) de las tarjetas que mencionás.` },
          ],
          schema: AskSchema,
        },
      );
      // Las citas [[n]] del texto se cambian por el id de la tarjeta; números inexistentes se quitan.
      const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= pool.length;
      const cited = [...out.answer.matchAll(/\[\[(\d{1,4})\]\]/g)].map((m) => Number(m[1]));
      const cardsOut = [...new Set([...cited, ...out.cards])]
        .filter(valid)
        .slice(0, 20)
        .map((n) => ({ n, id: pool[n - 1]!.id, title: pool[n - 1]!.title }));
      const kept = new Map(cardsOut.map((c) => [c.n, c.id]));
      const answer = out.answer.replace(/\[\[(\d{1,4})\]\]/g, (_, n: string) => (kept.has(Number(n)) ? `[[card:${kept.get(Number(n))}]]` : ""));
      return { answer: clip(answer, 5000), cards: cardsOut.map(({ id, title }) => ({ id, title })) };
    },
  }),

  route({
    method: "POST",
    path: "/boards/:boardId/ai/briefing",
    summary: "Resumen del estado del tablero para el líder, basado en los indicadores reales",
    tag: "IA",
    rateLimit: [{ name: "ai", by: "user", limit: 30, windowSec: 3600 }],
    handler: async ({ me, params }) => {
      const { board, signals } = await withUser(me.id, async (tx) => {
        const { board } = await boardAccess(tx, { actorId: me.id }, params.boardId, "edit");
        return { board, signals: await boardSignals(tx, board) };
      });
      // Solo indicadores calculados: sin descripciones ni comentarios.
      const facts = {
        resumen: signals.summary,
        entregas: signals.health,
        etapas: signals.sprints.map((s) => ({ nombre: s.name, estado: s.status, riesgo: s.level, motivos: s.reasons })),
        personas: signals.people.map((p) => ({ nombre: p.name, puntos: p.points, capacidad: p.capacity, sinEstimar: p.unestimated, estado: p.status })),
        dependencias: { criticas: signals.dependencies.critical.length, cadenas: signals.dependencies.chains.length, ciclos: signals.dependencies.cycles.length },
        riesgos: signals.risks.map((r) => ({ problema: r.problem, causa: r.cause, accion: r.action, severidad: r.severity })),
      };
      const out = await generate(
        { orgId: board.orgId, userId: me.id, boardId: board.id, feature: "leader_briefing" },
        {
          system: `Sos un asistente para líderes de proyecto. Redactás un resumen ejecutivo a partir de indicadores ya calculados. Usá solo esos datos: si algo no está, no lo supongas. ${UNTRUSTED_NOTE}`,
          content: [{ type: "text", text: `Tablero "${board.name}". Indicadores (JSON):\n${JSON.stringify(facts)}\n\nEscribí un titular, lo más importante, los riesgos y las próximas acciones recomendadas.` }],
          schema: BriefingSchema,
        },
      );
      return {
        headline: clip(out.headline, 300),
        highlights: clipList(out.highlights, 6, 400),
        risks: clipList(out.risks, 6, 400),
        nextActions: clipList(out.nextActions, 6, 400),
        generatedAt: new Date().toISOString(),
      };
    },
  }),
];
