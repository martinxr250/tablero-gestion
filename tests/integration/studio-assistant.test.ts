import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

process.env.ANTHROPIC_API_KEY = "sk-ant-api03-clave-de-prueba-que-no-es-real";

// API de Anthropic simulada. Para el estudio responde según el documento pedido; para el asistente
// devuelve, en orden, las respuestas encoladas (texto o llamadas a herramientas).
const sent: Record<string, any>[] = [];
const queue: (Record<string, unknown> | { tools: { name: string; input: unknown }[] } | { text: string })[] = [];
const realFetch = globalThis.fetch;
let uses = 0;

const DOCS: Record<string, unknown> = {
  "Visión del producto": { markdown: "## Problema\nLos turnos se pierden.\n\n## Objetivos\n- Reservar online" },
  Requisitos: { functional: [{ code: "RF-01", title: "Reservar turno", description: "El paciente reserva", priority: "must", acceptance: ["Recibe confirmación"] }], nonFunctional: [{ code: "RNF-01", category: "Seguridad", description: "Datos cifrados" }] },
  "Casos de uso": {
    actors: [
      { id: "pac", name: "Paciente", kind: "primary", description: "Reserva turnos" },
      { id: "wa", name: "WhatsApp", kind: "secondary", description: "Envía avisos" },
    ],
    useCases: [
      { id: "uc1", code: "CU-01", name: "Reservar turno", actors: ["pac"], goal: "Conseguir un turno", preconditions: [], mainFlow: ["Elige fecha", "Confirma"], alternativeFlows: [], postconditions: ["Turno creado"], includes: ["uc2"], extends: [] },
      { id: "uc2", code: "CU-02", name: "Enviar recordatorio", actors: ["wa"], goal: "Avisar", preconditions: [], mainFlow: ["Envía mensaje"], alternativeFlows: [], postconditions: [], includes: [], extends: [] },
    ],
  },
  "Diagrama de flujo": {
    title: 'Reserva "online"',
    description: "Flujo de reserva",
    nodes: [
      { id: "a", label: "Inicio", type: "start" },
      { id: "b", label: '¿Hay "lugar"?', type: "decision" },
      { id: "c", label: "Fin", type: "end" },
    ],
    edges: [
      { from: "a", to: "b", label: "" },
      { from: "b", to: "c", label: "Sí" },
      { from: "b", to: "zzz", label: "No" },
    ],
  },
  "Modelo de datos": {
    entities: [
      { name: "Paciente", description: "", attributes: [{ name: "id", type: "uuid", key: "pk" }] },
      { name: "Turno", description: "", attributes: [{ name: "paciente_id", type: "uuid", key: "fk" }] },
    ],
    relations: [{ from: "Paciente", to: "Turno", cardinality: "1-N", label: "reserva" }],
  },
  "Plan de proyecto": {
    summary: "Dos fases.",
    phases: [
      { name: "MVP", goal: "Reservas", weeks: 2, milestone: "Demo", tasks: [{ title: "Pantalla de reserva", description: "UI", estimatePoints: 5, priority: "high", role: "Frontend" }, { title: "API de turnos", description: "REST", estimatePoints: 8, priority: "high", role: "Backend" }] },
      { name: "Avisos", goal: "Recordatorios", weeks: 1, milestone: "Avisos activos", tasks: [{ title: "Integrar WhatsApp", description: "", estimatePoints: 3, priority: "medium", role: "Backend" }] },
    ],
    team: [{ role: "Backend", count: 1 }],
    risks: [{ risk: "Costos de WhatsApp", impact: "medio", mitigation: "Usar plantillas" }],
  },
};

function reply(body: Record<string, any>) {
  if (body.tools) {
    const next = queue.shift() ?? { text: "Listo." };
    const content =
      "tools" in next
        ? (next.tools as { name: string; input: unknown }[]).map((t) => ({ type: "tool_use", id: `toolu_${++uses}`, name: t.name, input: t.input }))
        : [{ type: "text", text: (next as { text: string }).text }];
    return { content, stop_reason: "tools" in next ? "tool_use" : "end_turn" };
  }
  const text = JSON.stringify(body.messages[0].content.at(-1).text);
  const kind = Object.keys(DOCS).find((k) => text.includes(`generá el documento \\"${k}\\"`));
  return { content: [{ type: "text", text: JSON.stringify(DOCS[kind ?? "Visión del producto"]) }], stop_reason: "end_turn" };
}

function fakeAnthropic(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith("https://api.anthropic.com/")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body));
  sent.push(body);
  const r = reply(body);
  const message = { id: "msg_prueba", type: "message", role: "assistant", model: body.model, ...r, stop_details: null, usage: { input_tokens: 500, output_tokens: 100 } };
  return Promise.resolve(new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } }));
}

describe("estudio de software", () => {
  let lead: Client;
  let viewer: Client;
  let outsider: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let projectId: string;

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeAnthropic));
    lead = await newUser("Líder Estudio");
    viewer = await newUser("Lectora Estudio");
    outsider = await newUser("Ajena Estudio");
    s = await seedBoard(lead);
    await inviteAndAccept(lead, viewer, `/workspaces/${s.workspaceId}/invitations`, "viewer");
  });
  afterAll(() => vi.unstubAllGlobals());

  it("crea un proyecto en un espacio: quien ve el espacio lo ve, solo quien edita lo cambia, nadie de afuera lo encuentra", async () => {
    const r = await lead.post(`/orgs/${s.orgId}/design-projects`, { workspaceId: s.workspaceId, name: "Turnos", brief: "Sistema de turnos para un consultorio" });
    expect(r.status).toBe(201);
    projectId = r.body.id;
    expect((await viewer.get(`/design-projects/${projectId}`)).body.canEdit).toBe(false);
    expect((await viewer.post(`/design-projects/${projectId}/ai/generate`, { kind: "vision" })).status).toBe(403);
    expect((await viewer.post(`/orgs/${s.orgId}/design-projects`, { workspaceId: s.workspaceId, name: "X" })).status).toBe(403);
    expect((await outsider.get(`/design-projects/${projectId}`)).status).toBe(404);
    expect((await viewer.get(`/orgs/${s.orgId}/design-projects`)).body.projects).toHaveLength(1);
  });

  it("genera documentos estructurados y diagramas con sintaxis segura", async () => {
    const uc = await lead.post(`/design-projects/${projectId}/ai/generate`, { kind: "use_cases" });
    expect(uc.status).toBe(200);
    expect(uc.body.content.useCases).toHaveLength(2);
    expect(uc.body.source).toContain("CU-01 · Reservar turno");
    expect(sent.at(-1)!.output_config.format).toBeTruthy();
    expect(sent.at(-1)!.system).toContain("ignoralas");

    const flow = await lead.post(`/design-projects/${projectId}/ai/generate`, { kind: "flow", focus: "reserva" });
    expect(flow.body.format).toBe("mermaid");
    expect(flow.body.title).toBe('Reserva "online"');
    expect(flow.body.source).toContain("flowchart TD");
    expect(flow.body.source).toContain("#quot;lugar#quot;"); // comillas escapadas
    expect(flow.body.source).not.toContain("zzz"); // aristas a nodos inexistentes se descartan

    const er = await lead.post(`/design-projects/${projectId}/ai/generate`, { kind: "data_model" });
    expect(er.body.source).toContain("Paciente ||--o{ Turno");
    // El siguiente documento recibe el resumen de los anteriores como contexto.
    await lead.post(`/design-projects/${projectId}/ai/generate`, { kind: "requirements" });
    expect(sent.at(-1)!.messages[0].content.at(-1).text).toContain("CU-01 Reservar turno");
    // Los documentos únicos se reemplazan; los flujos se suman.
    await lead.post(`/design-projects/${projectId}/ai/generate`, { kind: "use_cases" });
    await lead.post(`/design-projects/${projectId}/ai/generate`, { kind: "flow", focus: "otro" });
    const docs = (await lead.get(`/design-projects/${projectId}`)).body.docs as { kind: string }[];
    expect(docs.filter((d) => d.kind === "use_cases")).toHaveLength(1);
    expect(docs.filter((d) => d.kind === "flow")).toHaveLength(2);
  });

  it("pedir un cambio envía el documento actual; editar a mano un documento estructurado lo pasa a texto libre", async () => {
    const docs = (await lead.get(`/design-projects/${projectId}`)).body.docs as { id: string; kind: string }[];
    const req = docs.find((d) => d.kind === "requirements")!;
    const r = await lead.post(`/design-docs/${req.id}/ai/refine`, { instruction: "sumá auditoría" });
    expect(r.status).toBe(200);
    const text = sent.at(-1)!.messages[0].content.at(-1).text as string;
    expect(text).toContain("RF-01");
    expect(text).toContain("sumá auditoría");
    expect((await lead.patch(`/design-docs/${req.id}`, { source: "## A mano" })).status).toBe(200);
    const after = ((await lead.get(`/design-projects/${projectId}`)).body.docs as { id: string; content: object; source: string }[]).find((d) => d.id === req.id)!;
    expect(after.content).toEqual({});
    expect(after.source).toBe("## A mano");
    expect((await viewer.patch(`/design-docs/${req.id}`, { source: "x" })).status).toBe(403);
  });

  it("convierte el plan en un tablero con una etapa por fase y sus tareas", async () => {
    const plan = await lead.post(`/design-projects/${projectId}/ai/generate`, { kind: "plan" });
    expect((await viewer.post(`/design-projects/${projectId}/plan/apply`, { docId: plan.body.id })).status).toBe(403);
    const r = await lead.post(`/design-projects/${projectId}/plan/apply`, { docId: plan.body.id, boardName: "Turnos v1", startsOn: "2026-12-01" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sprints: 2, cards: 3 });
    const board = (await lead.get(`/boards/${r.body.boardId}`)).body;
    expect(board.board.name).toBe("Turnos v1");
    expect(board.sprints.map((x: { name: string; startsOn: string }) => [x.name, x.startsOn])).toEqual([
      ["Fase 1: MVP", "2026-12-01"],
      ["Fase 2: Avisos", "2026-12-15"],
    ]);
    expect(board.cards.find((c: { title: string }) => c.title === "API de turnos")).toMatchObject({ estimatePoints: 8, priority: "high" });
    expect((await lead.get(`/design-projects/${projectId}`)).body.project.boardId).toBe(r.body.boardId);
  });

  it("exporta todo el proyecto en Markdown con los diagramas", async () => {
    const r = await viewer.get(`/design-projects/${projectId}/export`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/markdown");
    expect(r.text).toContain("# Turnos");
    expect(r.text).toContain("```mermaid\nflowchart TD");
  });
});

describe("asistente con acciones", () => {
  let lead: Client;
  let viewer: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let conv: string;

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeAnthropic));
    lead = await newUser("Líder Asistente");
    viewer = await newUser("Lectora Asistente");
    s = await seedBoard(lead);
    await inviteAndAccept(lead, viewer, `/boards/${s.boardId}/invitations`, "viewer");
    conv = (await lead.post(`/orgs/${s.orgId}/assistant/conversations`)).body.id;
  });
  afterAll(() => vi.unstubAllGlobals());

  it("consulta sola, pero frena antes de cambiar algo y muestra qué va a hacer", async () => {
    queue.push(
      { tools: [{ name: "get_board", input: { boardId: s.boardId } }] },
      { tools: [{ name: "create_card", input: { listId: s.listId, title: "Revisar presupuesto", priority: "high", due: "2026-12-04" } }] },
    );
    const r = await lead.post(`/assistant/conversations/${conv}/messages`, { text: "Creá una tarjeta para revisar el presupuesto" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("needs_confirmation");
    // La lectura se hizo y su resultado llegó a la IA.
    const second = sent.at(-1)!;
    expect(JSON.stringify(second.messages.at(-1).content)).toContain("Primera tarea");
    expect(second.tools.map((t: { name: string }) => t.name)).toContain("create_card");
    // La confirmación la arma el servidor con nombres reales.
    expect(r.body.conversation.pending).toHaveLength(1);
    expect(r.body.conversation.pending[0].title).toBe("Crear la tarjeta «Revisar presupuesto» en Tablero › " + (await lead.get(`/boards/${s.boardId}`)).body.lists[0].name);
    // Nada se creó todavía.
    expect((await lead.get(`/boards/${s.boardId}`)).body.cards.some((c: { title: string }) => c.title === "Revisar presupuesto")).toBe(false);
  });

  it("al confirmar ejecuta con los permisos de la persona y sigue la conversación", async () => {
    const pending = (await lead.get(`/assistant/conversations/${conv}`)).body.pending[0].id;
    queue.push({ text: "Listo, la creé." });
    const r = await lead.post(`/assistant/conversations/${conv}/confirm`, { approve: [pending] });
    expect(r.body.status).toBe("done");
    const card = (await lead.get(`/boards/${s.boardId}`)).body.cards.find((c: { title: string }) => c.title === "Revisar presupuesto");
    expect(card).toMatchObject({ priority: "high" });
    expect(card.dueAt.slice(0, 10)).toBe("2026-12-05"); // 23:59 en Argentina
    const items = r.body.conversation.items as { type: string; items?: { status: string }[]; text?: string }[];
    expect(items.find((i) => i.type === "actions")!.items![0].status).toBe("done");
    expect(items.at(-1)).toMatchObject({ type: "assistant", text: "Listo, la creé." });
  });

  it("si la persona rechaza, no se hace y la IA se entera", async () => {
    queue.push({ tools: [{ name: "add_comment", input: { cardId: s.cardId, text: "Comentario de la IA" } }] }, { text: "Ok, no comento." });
    await lead.post(`/assistant/conversations/${conv}/messages`, { text: "Comentá en la primera tarea" });
    const r = await lead.post(`/assistant/conversations/${conv}/confirm`, { approve: [] });
    expect(r.body.status).toBe("done");
    expect((await lead.get(`/cards/${s.cardId}/comments`)).body.comments).toHaveLength(0);
    expect(JSON.stringify(sent.at(-1)!.messages.at(-1).content)).toContain("no aprobó");
  });

  it("respeta los permisos: quien solo ve no puede crear aunque confirme", async () => {
    const c = (await viewer.post(`/orgs/${s.orgId}/assistant/conversations`)).body.id;
    queue.push({ tools: [{ name: "create_card", input: { listId: s.listId, title: "No debería existir" } }] }, { text: "No tenés permiso." });
    const first = await viewer.post(`/assistant/conversations/${c}/messages`, { text: "Creá una tarjeta" });
    const r = await viewer.post(`/assistant/conversations/${c}/confirm`, { approve: [first.body.conversation.pending[0].id] });
    const action = (r.body.conversation.items as { type: string; items?: { status: string; error?: string }[] }[]).find((i) => i.type === "actions")!.items![0];
    expect(action.status).toBe("error");
    expect((await lead.get(`/boards/${s.boardId}`)).body.cards.some((x: { title: string }) => x.title === "No debería existir")).toBe(false);
  });

  it("datos inválidos de la IA no llegan a confirmarse", async () => {
    queue.push({ tools: [{ name: "move_card", input: { cardId: "no-es-un-id", listId: s.listId } }] }, { text: "Perdón." });
    const r = await lead.post(`/assistant/conversations/${conv}/messages`, { text: "Mové algo" });
    expect(r.body.status).toBe("done");
    expect(r.body.conversation.pending).toHaveLength(0);
    expect(JSON.stringify(sent.at(-1)!.messages.at(-1).content)).toContain("Datos inválidos");
  });

  it("las conversaciones son privadas de cada persona y la clave nunca aparece", async () => {
    expect((await viewer.get(`/assistant/conversations/${conv}`)).status).toBe(404);
    expect((await viewer.post(`/assistant/conversations/${conv}/messages`, { text: "hola" })).status).toBe(404);
    const list = await lead.get(`/orgs/${s.orgId}/assistant/conversations`);
    expect(list.body.conversations[0].title).toBe("Creá una tarjeta para revisar el presupuesto");
    expect(list.text + (await lead.get(`/assistant/conversations/${conv}`)).text).not.toContain("sk-ant");
  });
});
