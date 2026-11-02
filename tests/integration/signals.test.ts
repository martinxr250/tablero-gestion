import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

describe("dependencias, riesgo, capacidad y avisos", () => {
  let lead: Client;
  let dev: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  const card = async (title: string, extra: Record<string, unknown> = {}) => {
    const id = (await lead.post(`/lists/${s.listId}/cards`, { title })).body.id as string;
    if (Object.keys(extra).length) await lead.patch(`/cards/${id}`, extra);
    return id;
  };
  const block = (from: string, to: string) => lead.post(`/cards/${from}/relations`, { toCardId: to, type: "blocks" });
  const insights = async () => (await lead.get(`/boards/${s.boardId}/insights`)).body;
  const notes = async (c: Client) => (await c.get("/notifications")).body.notifications as { type: string; cardId: string }[];

  beforeAll(async () => {
    lead = await newUser("Líder");
    dev = await newUser("Dev");
    s = await seedBoard(lead);
    await inviteAndAccept(lead, dev, `/boards/${s.boardId}/invitations`, "editor");
  });

  it("rechaza dependencias circulares, también indirectas", async () => {
    const a = await card("A");
    const b = await card("B");
    const c = await card("C");
    expect((await block(a, b)).status).toBe(201);
    expect((await block(b, c)).status).toBe(201);
    const r = await block(c, a);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain("ciclo");
    // "relacionada" no participa de los ciclos.
    expect((await lead.post(`/cards/${c}/relations`, { toCardId: a, type: "relates" })).status).toBe(201);
  });

  it("avisa cuando una tarea queda bloqueada y cuando se libera, sin duplicar", async () => {
    const api = await card("API de pagos");
    const ui = await card("Pantalla de pagos", { ownerId: dev.id });
    await block(api, ui);
    await lead.del(`/cards/${api}/relations/${ui}?type=blocks`);
    await block(api, ui); // misma relación otra vez: no repite el aviso
    expect((await notes(dev)).filter((n) => n.type === "card.blocked" && n.cardId === ui)).toHaveLength(1);
    await lead.patch(`/cards/${api}`, { completed: true });
    expect((await notes(dev)).some((n) => n.type === "dependency.resolved" && n.cardId === ui)).toBe(true);
  });

  it("quien silencia un tipo de aviso deja de recibirlo; los esenciales no se silencian", async () => {
    expect((await dev.put("/me/notification-settings", { muted: ["card.blocked"] })).status).toBe(200);
    expect((await dev.put("/me/notification-settings", { muted: ["card.assigned"] })).status).toBe(400);
    const x = await card("Infra");
    const y = await card("Deploy", { ownerId: dev.id });
    await block(x, y);
    expect((await notes(dev)).some((n) => n.type === "card.blocked" && n.cardId === y)).toBe(false);
    await dev.put("/me/notification-settings", { muted: [] });
  });

  it("detecta bloqueos en cadena y tareas críticas", async () => {
    const base = await card("Base de datos");
    const svc = await card("Servicio");
    const web = await card("Web");
    const app = await card("App");
    await block(base, svc);
    await block(svc, web);
    await block(base, app);
    const deps = (await insights()).dependencies;
    expect(deps.chains.find((c: { id: string }) => c.id === web)?.depth).toBe(2);
    expect(deps.critical.find((c: { id: string }) => c.id === base)?.dependents).toBe(2);
    expect(deps.cycles).toHaveLength(0);
  });

  it("riesgo de etapa: sin estimaciones informa datos insuficientes; con capacidad explica el cálculo", async () => {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    const sp = (await lead.post(`/boards/${s.boardId}/sprints`, { name: "Etapa 1", startsOn: start, endsOn: end })).body.id;
    await lead.patch(`/sprints/${sp}`, { status: "active" });
    const t = await card("Sin estimar", { sprintId: sp });
    let risk = (await insights()).sprints.find((x: { id: string }) => x.id === sp);
    expect(risk.level).toBe("insufficient");

    await lead.patch(`/cards/${t}`, { estimatePoints: 40 });
    risk = (await insights()).sprints.find((x: { id: string }) => x.id === sp);
    expect(risk.level).toBe("insufficient"); // sin capacidad ni historial

    await lead.patch(`/sprints/${sp}`, { capacityPoints: 10 });
    const body = await insights();
    risk = body.sprints.find((x: { id: string }) => x.id === sp);
    expect(risk.level).toBe("high");
    expect(risk.reasons.join(" ")).toContain("Quedan 40 pts");
    expect(body.risks[0].severity).toBe(3);
    expect(body.summary.sprintsAtRisk).toBeGreaterThanOrEqual(1);
  });

  it("la tarea diaria avisa una sola vez a los administradores cuando una etapa corre riesgo", async () => {
    const cron = () => new Client().req("GET", "/cron/daily", undefined, { origin: null, headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect((await cron()).status).toBe(200);
    expect((await cron()).status).toBe(200);
    const risk = (await notes(lead)).filter((n) => n.type === "sprint.risk");
    expect(risk).toHaveLength(1);
  });

  it("capacidad por persona: solo administradores, y detecta sobrecarga separando lo no estimado", async () => {
    expect((await dev.put(`/boards/${s.boardId}/capacity/${dev.id}`, { points: 5 })).status).toBe(403);
    const outsider = await newUser("Externo");
    expect((await lead.put(`/boards/${s.boardId}/capacity/${outsider.id}`, { points: 5 })).status).toBe(400);
    expect((await lead.put(`/boards/${s.boardId}/capacity/${dev.id}`, { points: 5 })).status).toBe(200);
    const sp = (await insights()).sprints[0].id;
    await card("Grande", { ownerId: dev.id, sprintId: sp, estimatePoints: 8 });
    await card("Sin puntos", { ownerId: dev.id, sprintId: sp });
    const me = (await insights()).people.find((p: { userId: string }) => p.userId === dev.id);
    expect(me).toMatchObject({ points: 8, capacity: 5, status: "over", unestimated: 1 });
  });

  it("otra organización no ve los indicadores ni cambia capacidades", async () => {
    const intruder = await newUser("Intruso");
    expect((await intruder.get(`/boards/${s.boardId}/insights`)).status).toBe(404);
    expect((await intruder.put(`/boards/${s.boardId}/capacity/${intruder.id}`, { points: 1 })).status).toBe(404);
  });
});
