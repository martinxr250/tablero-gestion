import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withSystem } from "@/server/db/client";
import { aiUsage } from "@/server/db/schema";
import { uuidv7 } from "@/server/core/ids";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

process.env.ANTHROPIC_API_KEY = "sk-ant-api03-clave-de-prueba-que-no-es-real";

// API de Anthropic simulada: responde según la función y guarda los pedidos para revisarlos.
const sent: { url: string; body: Record<string, any> }[] = [];
let nextReply: Record<string, unknown> | "refusal" | null = null;
const realFetch = globalThis.fetch;

function fakeAnthropic(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith("https://api.anthropic.com/")) return realFetch(input, init);
  const body = JSON.parse(String(init?.body));
  sent.push({ url, body });
  const reply = nextReply;
  nextReply = null;
  const message = {
    id: "msg_prueba",
    type: "message",
    role: "assistant",
    model: body.model,
    content: reply === "refusal" ? [] : [{ type: "text", text: JSON.stringify(reply) }],
    stop_reason: reply === "refusal" ? "refusal" : "end_turn",
    stop_details: reply === "refusal" ? { type: "refusal", category: null, explanation: null } : null,
    usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
  return Promise.resolve(new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } }));
}

const pdf = () => {
  const form = new FormData();
  // PDF mínimo válido: el tipo se valida por contenido, no por la extensión.
  form.set("file", new File([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")], "requisitos.pdf", { type: "application/pdf" }));
  return form;
};
const zip = () => {
  const form = new FormData();
  form.set("file", new File([Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(30).fill(0)])], "datos.zip", { type: "application/zip" }));
  return form;
};

describe("archivos del tablero e IA", () => {
  let lead: Client;
  let viewer: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let fileId: string;

  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeAnthropic));
    lead = await newUser("Líder");
    viewer = await newUser("Lectora");
    s = await seedBoard(lead);
    await inviteAndAccept(lead, viewer, `/boards/${s.boardId}/invitations`, "viewer");
  });
  afterAll(() => vi.unstubAllGlobals());

  it("sube un PDF al tablero; quien solo ve no puede subir ni borrar", async () => {
    const up = await lead.req("POST", `/boards/${s.boardId}/files`, undefined, { form: pdf() });
    expect(up.status).toBe(201);
    expect(up.body.aiReadable).toBe(true);
    fileId = up.body.id;
    expect((await viewer.req("POST", `/boards/${s.boardId}/files`, undefined, { form: pdf() })).status).toBe(403);
    const list = (await viewer.get(`/boards/${s.boardId}/files`)).body.files;
    expect(list[0]).toMatchObject({ fileName: "requisitos.pdf", canPreview: true, aiReadable: true });
    const dl = await viewer.get(`/board-files/${fileId}/download?inline=1`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toContain("application/pdf");
    expect((await viewer.del(`/board-files/${fileId}`)).status).toBe(403);
  });

  it("propone tareas desde el PDF: lo envía como documento, trata el contenido como datos y valida la salida", async () => {
    nextReply = {
      tasks: [
        { title: "Diseñar el login", description: "Pantalla de acceso", priority: "high", due: "2026-12-01", estimatePoints: 5, owner: lead.name, labels: ["Frontend"], subtasks: ["Maqueta", "Validaciones"] },
        { title: "Migrar la base", description: "", priority: "medium", due: "31/12", estimatePoints: 5000, owner: "Persona inventada", labels: [], subtasks: [] },
      ],
    };
    const r = await lead.post(`/boards/${s.boardId}/ai/tasks`, { fileId });
    expect(r.status).toBe(200);
    const req = sent.at(-1)!.body;
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.output_config.effort).toBe("medium");
    expect(req.system).toContain("ignoralas");
    expect(req.messages[0].content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    // Fecha y estimación inválidas y responsables inexistentes se descartan.
    expect(r.body.tasks[0]).toMatchObject({ title: "Diseñar el login", due: "2026-12-01", estimatePoints: 5, owner: lead.name, subtasks: ["Maqueta", "Validaciones"] });
    expect(r.body.tasks[1]).toMatchObject({ due: "", estimatePoints: null, owner: "" });
    // No crea nada por sí sola: las tareas se revisan antes.
    const titles = (await lead.get(`/boards/${s.boardId}`)).body.cards.map((c: { title: string }) => c.title);
    expect(titles).not.toContain("Diseñar el login");
  });

  it("también acepta texto pegado y rechaza archivos que no puede leer", async () => {
    nextReply = { tasks: [{ title: "Llamar al cliente", description: "", priority: "none", due: "", estimatePoints: null, owner: "", labels: [], subtasks: [] }] };
    const r = await lead.post(`/boards/${s.boardId}/ai/tasks`, { text: "- llamar al cliente" });
    expect(r.body.tasks).toHaveLength(1);
    const z = await lead.req("POST", `/boards/${s.boardId}/files`, undefined, { form: zip() });
    expect(z.status).toBe(201);
    expect(z.body.aiReadable).toBe(false);
    expect((await lead.post(`/boards/${s.boardId}/ai/tasks`, { fileId: z.body.id })).status).toBe(400);
    expect((await lead.post(`/board-files/${z.body.id}/ai/summary`)).status).toBe(400);
  });

  it("asistente de tarjeta: lee sus adjuntos y no repite subtareas existentes", async () => {
    await lead.post(`/cards/${s.cardId}/subtasks`, { title: "Maqueta" });
    await lead.req("POST", `/cards/${s.cardId}/attachments`, undefined, { form: pdf() });
    nextReply = { summary: "Hay que terminar el login.", subtasks: ["Maqueta", "Pruebas"], checklist: ["Probar en celular"], risks: ["Falta el diseño"] };
    const r = await lead.post(`/cards/${s.cardId}/ai/assist`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ summary: "Hay que terminar el login.", subtasks: ["Pruebas"], checklist: ["Probar en celular"], filesRead: 1 });
    expect(sent.at(-1)!.body.messages[0].content[0].type).toBe("document");
    // Quien solo ve recibe la explicación y los riesgos, sin sugerencias para aplicar.
    nextReply = { summary: "Explicación", subtasks: ["X"], checklist: ["Y"], risks: ["Z"] };
    const v = await viewer.post(`/cards/${s.cardId}/ai/assist`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ summary: "Explicación", canApply: false, subtasks: [], checklist: [], risks: ["Z"] });
  });

  it("resumen de archivo: queda guardado para todos", async () => {
    nextReply = { summary: "Documento de requisitos del login.", keyPoints: ["Entrega en diciembre"] };
    expect((await lead.post(`/board-files/${fileId}/ai/summary`)).status).toBe(200);
    const f = (await viewer.get(`/boards/${s.boardId}/files`)).body.files.find((x: { id: string }) => x.id === fileId);
    expect(f.aiSummary).toContain("Entrega en diciembre");
  });

  it("resumen para el líder: solo envía indicadores, no descripciones ni comentarios", async () => {
    await lead.patch(`/cards/${s.cardId}`, { description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "SECRETO-INTERNO" }] }] } });
    nextReply = { headline: "Todo en marcha", highlights: ["2 tareas"], risks: [], nextActions: ["Estimar tareas"] };
    const r = await lead.post(`/boards/${s.boardId}/ai/briefing`);
    expect(r.status).toBe(200);
    expect(r.body.headline).toBe("Todo en marcha");
    expect(JSON.stringify(sent.at(-1)!.body)).not.toContain("SECRETO-INTERNO");
  });

  it("preguntale al tablero: disponible para quien solo ve, con tarjetas válidas y solo datos del tablero", async () => {
    nextReply = { answer: "Hay una tarea vencida.", cards: [1, 999, 1] };
    const r = await viewer.post(`/boards/${s.boardId}/ai/ask`, { question: "¿Qué está vencido?" });
    expect(r.status).toBe(200);
    expect(r.body.answer).toBe("Hay una tarea vencida.");
    expect(r.body.cards).toHaveLength(1); // números inexistentes o repetidos se descartan
    expect(typeof r.body.cards[0].id).toBe("string");
    const req = sent.at(-1)!.body;
    expect(req.messages[0].content.at(-1).text).toContain("¿Qué está vencido?");
    expect((await viewer.post(`/boards/${s.boardId}/ai/ask`, { question: "?" })).status).toBe(400);
    // Las citas [[n]] del texto se convierten en referencias a la tarjeta; las inexistentes se quitan.
    nextReply = { answer: "Mirá [[1]] y también [[999]].", cards: [] };
    const cited = await viewer.post(`/boards/${s.boardId}/ai/ask`, { question: "¿Qué miro primero?" });
    expect(cited.body.cards).toHaveLength(1);
    expect(cited.body.answer).toBe(`Mirá [[card:${cited.body.cards[0].id}]] y también .`);
    expect(sent.at(-1)!.body.system).toContain("[[n]]");
  });

  it("si la IA rechaza el pedido, responde un error claro", async () => {
    nextReply = "refusal";
    const r = await lead.post(`/boards/${s.boardId}/ai/tasks`, { text: "algo" });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("ai_refused");
  });

  it("registra el consumo y corta al llegar al tope mensual", async () => {
    const usage = await lead.get(`/orgs/${s.orgId}/ai/usage`);
    expect(usage.status).toBe(200);
    expect(usage.body.usedTokens).toBeGreaterThan(0);
    expect((await viewer.get(`/orgs/${s.orgId}/ai/usage`)).status).toBe(403); // solo administradores
    await withSystem((tx) => tx.insert(aiUsage).values({ id: uuidv7(), orgId: s.orgId, feature: "prueba", model: "x", inputTokens: 5_000_000, outputTokens: 0 }));
    const before = sent.length;
    const r = await lead.post(`/boards/${s.boardId}/ai/tasks`, { text: "más tareas" });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("ai_quota_exceeded");
    expect(sent.length).toBe(before); // ni siquiera se llamó a la API
  });

  it("otra organización no ve archivos ni usa la IA sobre este tablero, y la clave nunca aparece", async () => {
    const intruder = await newUser("Intruso");
    for (const r of [
      await intruder.get(`/boards/${s.boardId}/files`),
      await intruder.get(`/board-files/${fileId}/download`),
      await intruder.post(`/board-files/${fileId}/ai/summary`),
      await intruder.post(`/boards/${s.boardId}/ai/tasks`, { fileId }),
      await intruder.post(`/cards/${s.cardId}/ai/assist`),
      await intruder.post(`/boards/${s.boardId}/ai/ask`, { question: "¿Qué hay acá?" }),
    ]) {
      expect(r.status).toBe(404);
      expect(r.text).not.toContain("sk-ant");
    }
    // Un archivo de otro tablero no se puede usar para generar tareas en este.
    const other = await seedBoard(intruder);
    const theirs = (await intruder.req("POST", `/boards/${other.boardId}/files`, undefined, { form: pdf() })).body.id;
    expect((await lead.post(`/boards/${s.boardId}/ai/tasks`, { fileId: theirs })).status).toBe(404);
  });
});
