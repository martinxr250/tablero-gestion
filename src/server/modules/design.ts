import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { route, invokeAs } from "../api/router";
import { audit } from "../core/audit";
import { badRequest, notFound } from "../core/errors";
import { uuidv7 } from "../core/ids";
import { withUser } from "../db/client";
import { boardFiles, boards, designDocs, designProjects, myBoards, myWorkspaces, users, workspaces, type DesignDocKind } from "../db/schema";
import { storage } from "../storage/storage";
import { generate, type AiInput } from "../ai/claude";
import { AI_READABLE, fileToContent, UNTRUSTED_NOTE } from "../ai/content";
import { digest, KIND_INFO, MERMAID_KINDS, phaseName, Schemas, toSource, type Content } from "../design/artifacts";
import { workspaceAccess } from "./access";
import type { SessionUser } from "../auth/session";
import type { AuditContext } from "../core/audit";

// Estudio de software: proyectos de diseño (visión, requisitos, casos de uso, diagramas, arquitectura
// y plan) dentro de un espacio de trabajo. Quien ve el espacio, ve el proyecto; quien puede crear
// tableros en él, puede editarlo y generar con IA.

const KINDS = ["vision", "requirements", "use_cases", "flow", "sequence", "data_model", "architecture", "plan", "note"] as const;
const SINGLE = new Set<DesignDocKind>(["vision", "requirements", "use_cases", "data_model", "architecture", "plan"]);
const ORDER: Record<DesignDocKind, number> = { vision: 0, requirements: 1, use_cases: 2, data_model: 3, architecture: 4, flow: 5, sequence: 6, plan: 7, note: 8 };
const MAX_DOCS = 60;

/** Proyecto de diseño con el permiso de la persona (lanza 404 si no lo puede ver). */
export async function projectFor(userId: string, projectId: string, need: "view" | "edit") {
  return withUser(userId, async (tx) => {
    if (!z.uuid().safeParse(projectId).success) throw notFound("Proyecto");
    const [project] = await tx.select().from(designProjects).where(eq(designProjects.id, projectId));
    if (!project) throw notFound("Proyecto");
    const ws = await workspaceAccess(tx, userId, project.workspaceId, need === "edit" ? "create_board" : "view");
    if (!ws.role) throw notFound("Proyecto"); // invitados de un tablero puntual no ven el espacio
    return { project, workspace: ws.workspace, canEdit: ws.role === "admin" || ws.role === "member" };
  });
}

async function docFor(userId: string, docId: string, need: "view" | "edit") {
  if (!z.uuid().safeParse(docId).success) throw notFound("Documento");
  const [doc] = await withUser(userId, (tx) => tx.select().from(designDocs).where(eq(designDocs.id, docId)));
  if (!doc) throw notFound("Documento");
  const access = await projectFor(userId, doc.projectId, need);
  return { doc, ...access };
}

const docOut = (d: typeof designDocs.$inferSelect) => ({
  id: d.id,
  kind: d.kind,
  title: d.title,
  content: d.content,
  source: d.source,
  format: MERMAID_KINDS.has(d.kind) ? "mermaid" : "markdown",
  aiGenerated: d.aiGenerated,
  updatedAt: d.updatedAt,
});

/** Archivos legibles por la IA de los tableros del espacio que la persona puede ver. */
async function workspaceFiles(userId: string, workspaceId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({ id: boardFiles.id, fileName: boardFiles.fileName, mime: boardFiles.mime, boardName: boards.name })
      .from(boardFiles)
      .innerJoin(myBoards, eq(myBoards.boardId, boardFiles.boardId))
      .innerJoin(boards, eq(boards.id, boardFiles.boardId))
      .where(eq(myBoards.workspaceId, workspaceId))
      .orderBy(desc(boardFiles.createdAt))
      .limit(100),
  ).then((rows) => rows.filter((f) => AI_READABLE.has(f.mime)));
}

// ---------------------------------------------------------------------------------------------
// Generación con IA

const SYSTEM = `Sos arquitecto/a de software y analista funcional senior. Ayudás a diseñar sistemas desde cero con documentación profesional, coherente entre sí y realista para un equipo chico o mediano. Usá la terminología habitual (UML, MoSCoW, puntos de historia) en español. Mantené coherencia con los documentos ya existentes del proyecto: mismos nombres de actores, entidades y módulos. ${UNTRUSTED_NOTE}`;

type GenInput = { kind: DesignDocKind; focus?: string; instruction?: string; current?: { content: unknown; source: string }; fileIds?: string[] };

async function runGeneration(me: SessionUser, project: typeof designProjects.$inferSelect, input: GenInput) {
  const docs = await withUser(me.id, (tx) => tx.select().from(designDocs).where(eq(designDocs.projectId, project.id)).orderBy(asc(designDocs.position)));
  const context = docs
    .filter((d) => !(input.current && d.kind === input.kind && SINGLE.has(d.kind)))
    .map((d) => `- ${digest(d.kind, d.title, d.content, d.source)}`)
    .join("\n")
    .slice(0, 12000);
  const files: AiInput[] = [];
  for (const fileId of (input.fileIds ?? []).slice(0, 3)) {
    const [f] = await withUser(me.id, (tx) =>
      tx.select({ f: boardFiles }).from(boardFiles).innerJoin(myBoards, eq(myBoards.boardId, boardFiles.boardId)).where(and(eq(boardFiles.id, fileId), eq(myBoards.workspaceId, project.workspaceId))),
    );
    if (!f) throw notFound("Archivo");
    const block = AI_READABLE.has(f.f.mime) ? fileToContent({ bytes: await storage().get(f.f.storageKey), mime: f.f.mime, name: f.f.fileName }) : null;
    if (!block) throw badRequest(`La IA no puede leer "${f.f.fileName}"`);
    files.push(block);
  }
  const info = KIND_INFO[input.kind];
  const parts = [
    `Proyecto: "${project.name}".`,
    `Idea y contexto del sistema (escrito por el equipo):\n${project.brief || "(sin descripción)"}`,
    context ? `Documentos que ya existen en el proyecto (resumen):\n${context}` : "Todavía no hay otros documentos.",
    `Tarea: generá el documento "${info.title}". ${info.brief}`,
  ];
  if (input.focus) parts.push(`Enfoque pedido: ${input.focus}`);
  if (input.current) {
    parts.push(`Versión actual del documento (estructura):\n${JSON.stringify(input.current.content).slice(0, 30000)}`);
    if (input.current.source) parts.push(`Texto actual (puede tener ediciones manuales que hay que respetar):\n${input.current.source.slice(0, 20000)}`);
    parts.push(`Cambio pedido: ${input.instruction}\nDevolvé el documento completo actualizado, conservando lo que no hay que cambiar.`);
  }
  const big = input.kind === "use_cases" || input.kind === "plan" || input.kind === "requirements";
  return generate(
    { orgId: project.orgId, userId: me.id, feature: `design_${input.kind}` },
    {
      system: SYSTEM,
      content: [...files, { type: "text", text: parts.join("\n\n") }],
      schema: Schemas[input.kind],
      maxTokens: big ? 16000 : 8000,
      timeoutMs: 240_000,
    },
  );
}

/** Título del documento generado (los diagramas de flujo y secuencia toman el de la IA). */
function titleFor(kind: DesignDocKind, content: unknown, focus?: string) {
  const c = content as { title?: string };
  if ((kind === "flow" || kind === "sequence") && c.title) return c.title.slice(0, 160);
  return (focus && kind === "note" ? focus : KIND_INFO[kind].title).slice(0, 160);
}

// ---------------------------------------------------------------------------------------------
// Aplicar el plan: crea (o usa) un tablero, una etapa por fase y las tareas estimadas.

export async function applyPlan(me: SessionUser, actx: AuditContext, projectId: string, docId: string, opts: { boardId?: string; boardName?: string; startsOn?: string }) {
  const { project } = await projectFor(me.id, projectId, "edit");
  const [doc] = await withUser(me.id, (tx) => tx.select().from(designDocs).where(and(eq(designDocs.id, docId), eq(designDocs.projectId, project.id))));
  if (!doc || doc.kind !== "plan") throw notFound("Plan");
  const plan = Schemas.plan.safeParse(doc.content);
  if (!plan.success || plan.data.phases.length === 0) throw badRequest("El plan no tiene fases para crear");
  const { compiledRoutes } = await import("../api");
  const call = (method: "POST" | "PATCH", path: string, body?: unknown) => invokeAs(compiledRoutes, me, actx, method, path, body);

  let boardId = opts.boardId ?? project.boardId ?? undefined;
  if (!boardId) {
    const r = await call("POST", `/workspaces/${project.workspaceId}/boards`, { name: (opts.boardName || project.name).slice(0, 80), description: `Plan del proyecto de diseño "${project.name}"`.slice(0, 500) });
    boardId = (r.data as { id: string }).id;
  }
  let start = opts.startsOn ? new Date(`${opts.startsOn}T00:00:00Z`) : new Date();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const items: unknown[] = [];
  const sprintIds: string[] = [];
  for (const [i, phase] of plan.data.phases.entries()) {
    const weeks = Math.min(12, Math.max(1, Math.round(phase.weeks || 1)));
    const end = new Date(start.getTime() + (weeks * 7 - 1) * 86_400_000);
    const points = phase.tasks.reduce((s, t) => s + (t.estimatePoints || 0), 0);
    const s = await call("POST", `/boards/${boardId}/sprints`, {
      name: `Fase ${i + 1}: ${phaseName(phase.name)}`.slice(0, 80),
      goal: `${phase.goal} · Hito: ${phase.milestone}`.slice(0, 500),
      startsOn: day(start),
      endsOn: day(end),
      capacityPoints: points || null,
    });
    const sprintId = (s.data as { id: string }).id;
    sprintIds.push(sprintId);
    for (const t of phase.tasks) {
      items.push({
        title: t.title.slice(0, 200),
        description: `${t.description}\n\nRol sugerido: ${t.role}`.slice(0, 5000),
        priority: t.priority,
        estimatePoints: Math.min(1000, Math.max(0, Math.round(t.estimatePoints || 0))) || null,
        labels: [t.role.slice(0, 40)].filter(Boolean),
        sprintId,
      });
    }
    start = new Date(end.getTime() + 86_400_000);
  }
  let created = 0;
  for (let i = 0; i < items.length; i += 200) {
    const r = await call("POST", `/boards/${boardId}/cards/bulk`, { items: items.slice(i, i + 200) });
    created += (r.data as { created: number }).created ?? 0;
  }
  await withUser(me.id, async (tx) => {
    await tx.update(designProjects).set({ boardId, updatedAt: new Date() }).where(eq(designProjects.id, project.id));
    await audit(tx, actx, "design.plan_applied", { orgId: project.orgId, targetType: "board", targetId: boardId!, data: { project: project.name, cards: created } });
  });
  return { boardId: boardId!, sprints: sprintIds.length, cards: created };
}

/** Todo el proyecto como un único Markdown (los diagramas van como bloques Mermaid). */
function exportMarkdown(project: typeof designProjects.$inferSelect, docs: (typeof designDocs.$inferSelect)[]) {
  const parts = [`# ${project.name}`, project.brief ? `> ${project.brief.replace(/\n/g, "\n> ")}` : ""];
  for (const d of docs) {
    parts.push(`\n# ${d.title}\n`);
    if (MERMAID_KINDS.has(d.kind)) {
      const desc = (d.content as { description?: string; summary?: string }).description ?? (d.content as { summary?: string }).summary;
      if (desc) parts.push(desc);
      parts.push("```mermaid\n" + d.source + "\n```");
      if (d.kind === "architecture") {
        const a = Schemas.architecture.safeParse(d.content);
        if (a.success && a.data.decisions.length) parts.push("## Decisiones\n\n" + a.data.decisions.map((x) => `- **${x.title}:** ${x.choice}. ${x.reason}`).join("\n"));
      }
    } else parts.push(d.source);
  }
  return parts.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------------------------

const projectBody = z.object({
  name: z.string().trim().min(1, "Ingresá un nombre").max(120),
  brief: z.string().trim().max(8000).default(""),
});

const aiRate = [{ name: "ai_design", by: "user" as const, limit: 60, windowSec: 3600 }];

export const designRoutes = [
  route({
    method: "GET",
    path: "/orgs/:orgId/design-projects",
    summary: "Proyectos de diseño de software que la persona puede ver",
    tag: "Estudio",
    handler: async ({ me, params }) =>
      withUser(me.id, async (tx) => {
        const rows = await tx
          .select({ p: designProjects, workspace: workspaces.name, role: myWorkspaces.role })
          .from(designProjects)
          .innerJoin(myWorkspaces, eq(myWorkspaces.workspaceId, designProjects.workspaceId))
          .innerJoin(workspaces, eq(workspaces.id, designProjects.workspaceId))
          .where(eq(designProjects.orgId, params.orgId))
          .orderBy(desc(designProjects.updatedAt));
        const counts = rows.length
          ? await tx.select({ projectId: designDocs.projectId, kind: designDocs.kind }).from(designDocs).where(inArray(designDocs.projectId, rows.map((r) => r.p.id)))
          : [];
        return {
          projects: rows.map(({ p, workspace, role }) => ({
            id: p.id,
            name: p.name,
            brief: p.brief.slice(0, 300),
            workspaceId: p.workspaceId,
            workspaceName: workspace,
            boardId: p.boardId,
            canEdit: role === "admin" || role === "member",
            kinds: [...new Set(counts.filter((c) => c.projectId === p.id).map((c) => c.kind))],
            updatedAt: p.updatedAt,
          })),
        };
      }),
  }),

  route({
    method: "POST",
    path: "/orgs/:orgId/design-projects",
    summary: "Crear un proyecto de diseño en un espacio de trabajo",
    tag: "Estudio",
    status: 201,
    body: projectBody.extend({ workspaceId: z.uuid() }),
    handler: async ({ me, params, body, audit: actx }) =>
      withUser(me.id, async (tx) => {
        const ws = await workspaceAccess(tx, me.id, body.workspaceId, "create_board");
        if (ws.workspace.orgId !== params.orgId) throw notFound("Espacio de trabajo");
        const id = uuidv7();
        await tx.insert(designProjects).values({ id, orgId: params.orgId, workspaceId: body.workspaceId, name: body.name, brief: body.brief, createdBy: me.id });
        await audit(tx, actx, "design.project_created", { orgId: params.orgId, targetType: "workspace", targetId: body.workspaceId, data: { name: body.name } });
        return { id };
      }),
  }),

  route({
    method: "GET",
    path: "/design-projects/:projectId",
    summary: "Proyecto de diseño con sus documentos",
    tag: "Estudio",
    handler: async ({ me, params }) => {
      const { project, workspace, canEdit } = await projectFor(me.id, params.projectId, "view");
      const [docs, author, board] = await withUser(me.id, (tx) =>
        Promise.all([
          tx.select().from(designDocs).where(eq(designDocs.projectId, project.id)).orderBy(asc(designDocs.position), asc(designDocs.createdAt)),
          project.createdBy ? tx.select({ name: users.name }).from(users).where(eq(users.id, project.createdBy)) : Promise.resolve([]),
          project.boardId ? tx.select({ id: myBoards.boardId }).from(myBoards).where(eq(myBoards.boardId, project.boardId)) : Promise.resolve([]),
        ]),
      );
      return {
        project: { id: project.id, orgId: project.orgId, name: project.name, brief: project.brief, workspaceId: workspace.id, workspaceName: workspace.name, boardId: board.length ? project.boardId : null, createdBy: author[0]?.name ?? null, updatedAt: project.updatedAt },
        canEdit,
        docs: docs.map(docOut),
        files: canEdit ? await workspaceFiles(me.id, workspace.id) : [],
      };
    },
  }),

  route({
    method: "PATCH",
    path: "/design-projects/:projectId",
    summary: "Renombrar o cambiar la idea del proyecto",
    tag: "Estudio",
    body: projectBody.partial(),
    handler: async ({ me, params, body }) => {
      const { project } = await projectFor(me.id, params.projectId, "edit");
      await withUser(me.id, (tx) => tx.update(designProjects).set({ ...body, updatedAt: new Date() }).where(eq(designProjects.id, project.id)));
      return { ok: true };
    },
  }),

  route({
    method: "DELETE",
    path: "/design-projects/:projectId",
    summary: "Eliminar un proyecto de diseño y sus documentos",
    tag: "Estudio",
    handler: async ({ me, params, audit: actx }) => {
      const { project } = await projectFor(me.id, params.projectId, "edit");
      await withUser(me.id, async (tx) => {
        await tx.delete(designProjects).where(eq(designProjects.id, project.id));
        await audit(tx, actx, "design.project_deleted", { orgId: project.orgId, targetType: "workspace", targetId: project.workspaceId, data: { name: project.name } });
      });
      return undefined;
    },
  }),

  route({
    method: "POST",
    path: "/design-projects/:projectId/docs",
    summary: "Agregar un documento escrito a mano (nota o diagrama en Mermaid)",
    tag: "Estudio",
    status: 201,
    body: z.object({ kind: z.enum(["note", "flow", "sequence", "data_model", "architecture"]), title: z.string().trim().min(1).max(160), source: z.string().max(60000).default("") }),
    handler: async ({ me, params, body }) => {
      const { project } = await projectFor(me.id, params.projectId, "edit");
      return withUser(me.id, async (tx) => {
        if ((await tx.$count(designDocs, eq(designDocs.projectId, project.id))) >= MAX_DOCS) throw badRequest(`El proyecto ya tiene ${MAX_DOCS} documentos`);
        const id = uuidv7();
        await tx.insert(designDocs).values({ id, orgId: project.orgId, projectId: project.id, kind: body.kind, title: body.title, source: body.source, position: ORDER[body.kind], updatedBy: me.id });
        await tx.update(designProjects).set({ updatedAt: new Date() }).where(eq(designProjects.id, project.id));
        return { id };
      });
    },
  }),

  route({
    method: "PATCH",
    path: "/design-docs/:docId",
    summary: "Editar el título o el texto (Markdown o Mermaid) de un documento",
    tag: "Estudio",
    body: z.object({ title: z.string().trim().min(1).max(160).optional(), source: z.string().max(60000).optional() }),
    handler: async ({ me, params, body }) => {
      const { doc } = await docFor(me.id, params.docId, "edit");
      await withUser(me.id, async (tx) => {
        // En los documentos estructurados (requisitos, casos de uso, plan), editar el texto a mano lo
        // convierte en texto libre: la vista estructurada deja de aplicar hasta que la IA lo reestructure.
        const structured = body.source !== undefined && body.source !== doc.source && (doc.kind === "requirements" || doc.kind === "use_cases" || doc.kind === "plan");
        await tx
          .update(designDocs)
          .set({ ...body, ...(structured ? { content: {} } : {}), updatedBy: me.id, updatedAt: new Date() })
          .where(eq(designDocs.id, doc.id));
        await tx.update(designProjects).set({ updatedAt: new Date() }).where(eq(designProjects.id, doc.projectId));
      });
      return { ok: true };
    },
  }),

  route({
    method: "DELETE",
    path: "/design-docs/:docId",
    summary: "Eliminar un documento del proyecto",
    tag: "Estudio",
    handler: async ({ me, params }) => {
      const { doc } = await docFor(me.id, params.docId, "edit");
      await withUser(me.id, (tx) => tx.delete(designDocs).where(eq(designDocs.id, doc.id)));
      return undefined;
    },
  }),

  route({
    method: "POST",
    path: "/design-projects/:projectId/ai/generate",
    summary: "Generar un documento del proyecto con IA (visión, requisitos, casos de uso, diagramas, arquitectura o plan)",
    tag: "Estudio",
    rateLimit: aiRate,
    body: z.object({ kind: z.enum(KINDS), focus: z.string().trim().max(500).optional(), fileIds: z.array(z.uuid()).max(3).optional() }),
    handler: async ({ me, params, body }) => {
      const { project } = await projectFor(me.id, params.projectId, "edit");
      const content = await runGeneration(me, project, body);
      const source = toSource(body.kind, content);
      const title = titleFor(body.kind, content, body.focus);
      return withUser(me.id, async (tx) => {
        const [existing] = SINGLE.has(body.kind)
          ? await tx.select({ id: designDocs.id }).from(designDocs).where(and(eq(designDocs.projectId, project.id), eq(designDocs.kind, body.kind)))
          : [];
        const id = existing?.id ?? uuidv7();
        if (existing) await tx.update(designDocs).set({ content, source, title, aiGenerated: true, updatedBy: me.id, updatedAt: new Date() }).where(eq(designDocs.id, id));
        else {
          if ((await tx.$count(designDocs, eq(designDocs.projectId, project.id))) >= MAX_DOCS) throw badRequest(`El proyecto ya tiene ${MAX_DOCS} documentos`);
          await tx.insert(designDocs).values({ id, orgId: project.orgId, projectId: project.id, kind: body.kind, title, content, source, position: ORDER[body.kind], aiGenerated: true, updatedBy: me.id });
        }
        await tx.update(designProjects).set({ updatedAt: new Date() }).where(eq(designProjects.id, project.id));
        const [doc] = await tx.select().from(designDocs).where(eq(designDocs.id, id));
        return docOut(doc!);
      });
    },
  }),

  route({
    method: "POST",
    path: "/design-docs/:docId/ai/refine",
    summary: "Pedirle a la IA un cambio sobre un documento existente",
    tag: "Estudio",
    rateLimit: aiRate,
    body: z.object({ instruction: z.string().trim().min(3).max(1000) }),
    handler: async ({ me, params, body }) => {
      const { doc, project } = await docFor(me.id, params.docId, "edit");
      const content = await runGeneration(me, project, { kind: doc.kind, instruction: body.instruction, current: { content: doc.content, source: doc.source } });
      const source = toSource(doc.kind, content);
      return withUser(me.id, async (tx) => {
        await tx
          .update(designDocs)
          .set({ content, source, title: doc.kind === "flow" || doc.kind === "sequence" ? titleFor(doc.kind, content) : doc.title, aiGenerated: true, updatedBy: me.id, updatedAt: new Date() })
          .where(eq(designDocs.id, doc.id));
        const [d] = await tx.select().from(designDocs).where(eq(designDocs.id, doc.id));
        return docOut(d!);
      });
    },
  }),

  route({
    method: "POST",
    path: "/design-projects/:projectId/plan/apply",
    summary: "Convertir el plan en un tablero: una etapa por fase y sus tareas estimadas",
    tag: "Estudio",
    rateLimit: [{ name: "design_apply", by: "user", limit: 10, windowSec: 3600 }],
    body: z.object({ docId: z.uuid(), boardId: z.uuid().optional(), boardName: z.string().trim().max(80).optional(), startsOn: z.iso.date().optional() }),
    handler: async ({ me, params, body, audit: actx }) => applyPlan(me, actx, params.projectId, body.docId, body),
  }),

  route({
    method: "GET",
    path: "/design-projects/:projectId/export",
    summary: "Exportar el proyecto completo en Markdown (con diagramas Mermaid)",
    tag: "Estudio",
    handler: async ({ me, params }) => {
      const { project } = await projectFor(me.id, params.projectId, "view");
      const docs = await withUser(me.id, (tx) => tx.select().from(designDocs).where(eq(designDocs.projectId, project.id)).orderBy(asc(designDocs.position), asc(designDocs.createdAt)));
      const name = project.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-") || "proyecto";
      return new Response(exportMarkdown(project, docs), {
        headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}.md"; filename*=UTF-8''${encodeURIComponent(name)}.md` },
      });
    },
  }),
];

export type { Content };
