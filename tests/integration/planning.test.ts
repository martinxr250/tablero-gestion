import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

describe("herramientas del líder y comodidades", () => {
  let pm: Client;
  let dev: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  const board = async () => (await pm.get(`/boards/${s.boardId}`)).body;
  const cardBy = async (title: string) => (await board()).cards.find((c: { title: string }) => c.title === title);

  beforeAll(async () => {
    pm = await newUser("Líder");
    dev = await newUser("Dev");
    s = await seedBoard(pm);
    await inviteAndAccept(pm, dev, `/boards/${s.boardId}/invitations`, "editor");
  });

  it("carga masiva: crea todo junto, con subtareas y etiquetas nuevas", async () => {
    const r = await pm.post(`/boards/${s.boardId}/cards/bulk`, {
      items: [
        { title: "Módulo de usuarios", priority: "high", ownerId: dev.id, estimatePoints: 8, labels: ["Backend"] },
        { title: "Tabla de usuarios", parentIndex: 0, estimatePoints: 3 },
        { title: "Pantalla de alta", listId: s.lists[1]!.id, labels: ["Frontend", "Backend"] },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(3);
    const data = await board();
    const parent = data.cards.find((c: { title: string }) => c.title === "Módulo de usuarios");
    const child = data.cards.find((c: { title: string }) => c.title === "Tabla de usuarios");
    expect(child.parentId).toBe(parent.id);
    expect(child.listId).toBe(parent.listId);
    expect(parent.subtaskTotal).toBe(1);
    expect(parent.estimatePoints).toBe(8);
    expect(data.labels.map((l: { name: string }) => l.name)).toEqual(expect.arrayContaining(["Backend", "Frontend"]));
  });

  it("carga masiva: si una fila es inválida no se crea ninguna", async () => {
    const before = (await board()).cards.length;
    const outsider = await newUser("Externo");
    const r = await pm.post(`/boards/${s.boardId}/cards/bulk`, { items: [{ title: "Ok" }, { title: "Mal", ownerId: outsider.id }] });
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe("items.1");
    expect((await board()).cards.length).toBe(before);
  });

  it("subtareas de un solo nivel", async () => {
    const parent = await cardBy("Módulo de usuarios");
    const sub = await pm.post(`/cards/${parent.id}/subtasks`, { title: "Roles y permisos" });
    expect(sub.status).toBe(201);
    expect((await pm.post(`/cards/${sub.body.id}/subtasks`, { title: "Nieta" })).status).toBe(400);
    expect((await pm.patch(`/cards/${parent.id}`, { parentId: sub.body.id })).status).toBe(400);
    const detail = (await pm.get(`/cards/${parent.id}`)).body.card;
    expect(detail.subtasks.map((t: { title: string }) => t.title)).toContain("Roles y permisos");
  });

  it("aviso de bloqueo mientras la tarea que bloquea no termina", async () => {
    const blocker = await cardBy("Tabla de usuarios");
    const blocked = await cardBy("Pantalla de alta");
    await pm.post(`/cards/${blocker.id}/relations`, { toCardId: blocked.id, type: "blocks" });
    expect((await cardBy("Pantalla de alta")).blocked).toBe(true);
    await pm.patch(`/cards/${blocker.id}`, { completed: true });
    expect((await cardBy("Pantalla de alta")).blocked).toBe(false);
  });

  it("control de calidad: no se termina sin aprobación y solo revisores aprueban", async () => {
    const [, review, done] = s.lists;
    expect((await pm.patch(`/boards/${s.boardId}`, { qaRequired: true, qaListId: review!.id, doneListId: done!.id })).status).toBe(200);
    const id = (await pm.post(`/lists/${s.listId}/cards`, { title: "Revisar login" })).body.id;

    expect((await dev.post(`/cards/${id}/move`, { listId: done!.id, afterCardId: null })).status).toBe(409);
    expect((await dev.patch(`/cards/${id}`, { completed: true })).status).toBe(409);

    await dev.post(`/cards/${id}/move`, { listId: review!.id, afterCardId: null });
    expect((await cardBy("Revisar login")).qaStatus).toBe("pending");

    expect((await dev.post(`/cards/${id}/qa`, { decision: "approve" })).status).toBe(403);
    expect((await pm.post(`/cards/${id}/qa`, { decision: "reject" })).status).toBe(400); // falta el motivo
    await pm.post(`/cards/${id}/qa`, { decision: "reject", note: "Falta validar el correo" });
    expect((await cardBy("Revisar login")).qaStatus).toBe("rejected");
    expect((await dev.get("/notifications")).body.notifications.some((n: { type: string }) => n.type === "qa.rejected")).toBe(false); // dev no es responsable

    await pm.put(`/boards/${s.boardId}/members/${dev.id}`, { role: "editor", canReview: true });
    await dev.post(`/cards/${id}/move`, { listId: review!.id, afterCardId: null });
    expect((await dev.post(`/cards/${id}/qa`, { decision: "approve" })).status).toBe(200);
    const after = await cardBy("Revisar login");
    expect(after.listId).toBe(done!.id);
    expect(after.completedAt).not.toBeNull();
    await pm.patch(`/boards/${s.boardId}`, { qaRequired: false });
  });

  it("etapas: una sola activa y al cerrar lo pendiente vuelve a pendientes", async () => {
    const a = (await pm.post(`/boards/${s.boardId}/sprints`, { name: "Etapa 1", startsOn: "2026-11-02", endsOn: "2026-11-15", capacityPoints: 20 })).body.id;
    const b = (await pm.post(`/boards/${s.boardId}/sprints`, { name: "Etapa 2", startsOn: "2026-11-16", endsOn: "2026-11-29" })).body.id;
    expect((await pm.post(`/boards/${s.boardId}/sprints`, { name: "Mal", startsOn: "2026-11-10", endsOn: "2026-11-01" })).status).toBe(400);
    expect((await pm.patch(`/sprints/${a}`, { status: "active" })).status).toBe(200);
    expect((await pm.patch(`/sprints/${b}`, { status: "active" })).status).toBe(409);
    const parent = await cardBy("Módulo de usuarios");
    await pm.patch(`/cards/${parent.id}`, { sprintId: a });
    const insights = (await pm.get(`/boards/${s.boardId}/insights`)).body;
    expect(insights.sprint).toMatchObject({ name: "Etapa 1", totalPoints: 8, capacityPoints: 20 });
    await pm.patch(`/sprints/${a}`, { status: "closed" });
    expect((await cardBy("Módulo de usuarios")).sprintId).toBeNull();
  });

  it("panel del líder: carga por persona y tiempos", async () => {
    const r = await pm.get(`/boards/${s.boardId}/insights`);
    expect(r.status).toBe(200);
    const devRow = r.body.workload.find((w: { userId: string }) => w.userId === dev.id);
    expect(devRow.open).toBeGreaterThanOrEqual(1);
    expect(r.body.resolution.completed).toBeGreaterThanOrEqual(1);
  });

  it("tareas que se repiten crean la siguiente al completarse", async () => {
    const id = (await pm.post(`/lists/${s.listId}/cards`, { title: "Reporte semanal" })).body.id;
    await pm.patch(`/cards/${id}`, { dueAt: "2026-11-06T15:00:00.000Z", recurrence: "weekly" });
    await pm.patch(`/cards/${id}`, { completed: true });
    const copies = (await board()).cards.filter((c: { title: string }) => c.title === "Reporte semanal");
    const next = copies.find((c: { completedAt: string | null }) => c.completedAt === null);
    expect(new Date(next.dueAt).toISOString()).toBe("2026-11-13T15:00:00.000Z");
    expect(next.recurrence).toBe("weekly");
    expect(copies.find((c: { id: string }) => c.id === id).recurrence).toBeNull();
  });

  it("duplicar tarjeta y seguirla", async () => {
    const card = await cardBy("Pantalla de alta");
    const r = await pm.post(`/cards/${card.id}/duplicate`);
    expect(r.status).toBe(201);
    const copy = await cardBy("Pantalla de alta (copia)");
    expect(copy.labelIds.length).toBe(card.labelIds.length);

    expect((await dev.put(`/cards/${copy.id}/watch`, { watching: true })).status).toBe(200);
    await dev.post("/notifications/read", {});
    await pm.post(`/cards/${copy.id}/move`, { listId: s.lists[0]!.id, afterCardId: null });
    await pm.post(`/cards/${copy.id}/comments`, { body: "Avances" });
    const types = (await dev.get("/notifications?unread=1")).body.notifications.map((n: { type: string }) => n.type);
    expect(types).toEqual(expect.arrayContaining(["card.moved", "comment.created"]));
    expect((await dev.get(`/cards/${copy.id}`)).body.card.watching).toBe(true);
  });

  it("plantillas: guardar un tablero como plantilla y crear desde plantillas", async () => {
    const tpl = await pm.post(`/boards/${s.boardId}/duplicate`, { name: "Plantilla equipo", asTemplate: true, includeCards: true });
    expect(tpl.status).toBe(201);
    const list = (await pm.get(`/workspaces/${s.workspaceId}/board-templates`)).body;
    expect(list.builtin.map((t: { key: string }) => t.key)).toEqual(expect.arrayContaining(["kanban", "sprint", "marketing", "bugs"]));
    expect(list.boards.map((b: { name: string }) => b.name)).toContain("Plantilla equipo");

    const fromTpl = (await pm.post(`/workspaces/${s.workspaceId}/boards`, { name: "Nuevo", template: { kind: "board", boardId: tpl.body.id, includeCards: true } })).body.id;
    const copied = (await pm.get(`/boards/${fromTpl}`)).body;
    expect(copied.lists.length).toBe((await board()).lists.length);
    expect(copied.cards.some((c: { title: string; parentId: string | null }) => c.title === "Tabla de usuarios" && c.parentId)).toBe(true);

    const sprintBoard = (await pm.post(`/workspaces/${s.workspaceId}/boards`, { name: "Dev", template: { kind: "builtin", key: "sprint" } })).body.id;
    const sb = (await pm.get(`/boards/${sprintBoard}`)).body;
    expect(sb.lists.map((l: { name: string }) => l.name)).toEqual(["Pendientes", "Por hacer", "En curso", "Revisión", "Hecho"]);
    expect(sb.board.qaRequired).toBe(true);
  });

  it("exporta a planilla sin permitir fórmulas", async () => {
    await pm.post(`/lists/${s.listId}/cards`, { title: "=HYPERLINK(\"http://x\")" });
    const r = await pm.req("GET", `/boards/${s.boardId}/export`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    // (el BOM para Excel se quita al decodificar el texto)
    const lines = r.text.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("Título,Lista,Prioridad,Responsable,Colaboradores,Etiquetas,Vencimiento,Estimación,Etapa,Control de calidad,Completada,Tarea principal,Descripción,Issue,Creada");
    expect(lines.some((l) => l.startsWith(`"'=HYPERLINK`))).toBe(true);
    expect(lines.some((l) => l.startsWith("Módulo de usuarios,"))).toBe(true);
  });

  it("los PDF se pueden ver en el navegador sin descargarlos", async () => {
    const card = await cardBy("Pantalla de alta");
    const form = new FormData();
    form.set("file", new File([new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")], "informe.pdf"));
    const up = await pm.req("POST", `/cards/${card.id}/attachments`, undefined, { form });
    expect(up.status).toBe(201);
    const d = await pm.req("GET", `/attachments/${up.body.id}/download?inline=1`);
    expect(d.headers.get("content-type")).toBe("application/pdf");
    expect(d.headers.get("content-disposition")).toMatch(/^inline/);
    expect(d.headers.get("content-security-policy")).not.toContain("sandbox");
    expect(d.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await pm.get(`/cards/${card.id}`)).body.card.attachments[0].canPreview).toBe(true);
  });

  it("otra organización no ve el panel ni la exportación", async () => {
    const outsider = await newUser("Ajeno");
    expect((await outsider.get(`/boards/${s.boardId}/insights`)).status).toBe(404);
    expect((await outsider.req("GET", `/boards/${s.boardId}/export`)).status).toBe(404);
    expect((await outsider.post(`/boards/${s.boardId}/cards/bulk`, { items: [{ title: "x" }] })).status).toBe(404);
  });
});
