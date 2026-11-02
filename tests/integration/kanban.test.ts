import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

describe("tablero kanban y colaboración", () => {
  let owner: Client;
  let mate: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;

  beforeAll(async () => {
    owner = await newUser("Kanban");
    mate = await newUser("Compa");
    s = await seedBoard(owner);
    await inviteAndAccept(owner, mate, `/boards/${s.boardId}/invitations`, "editor");
  });

  const board = async () => (await owner.get(`/boards/${s.boardId}`)).body;

  it("crea, ordena y mueve tarjetas entre listas", async () => {
    const [todo, doing] = s.lists;
    const b = (await owner.post(`/lists/${todo!.id}/cards`, { title: "B" })).body.id;
    const c = (await owner.post(`/lists/${todo!.id}/cards`, { title: "C" })).body.id;
    // C entre la primera tarea y B
    expect((await owner.post(`/cards/${c}/move`, { listId: todo!.id, afterCardId: s.cardId })).status).toBe(200);
    let data = await board();
    expect(data.cards.filter((x: { listId: string }) => x.listId === todo!.id).map((x: { title: string }) => x.title)).toEqual(["Primera tarea", "C", "B"]);
    // B al principio de "En curso"
    await owner.post(`/cards/${b}/move`, { listId: doing!.id, afterCardId: null });
    data = await board();
    expect(data.cards.find((x: { id: string }) => x.id === b).listId).toBe(doing!.id);
    // no se puede mover a una lista de otro tablero
    const other = await seedBoard(owner);
    expect((await owner.post(`/cards/${b}/move`, { listId: other.listId, afterCardId: null })).status).toBe(400);
  });

  it("reordena listas", async () => {
    const [todo, doing, done] = s.lists;
    await owner.post(`/lists/${done!.id}/move`, { afterListId: null });
    const data = await board();
    expect(data.lists.map((l: { id: string }) => l.id)).toEqual([done!.id, todo!.id, doing!.id]);
  });

  it("asigna responsables, notifica y valida acceso", async () => {
    const r = await owner.put(`/cards/${s.cardId}/assignees`, { userIds: [mate.id] });
    expect(r.status).toBe(200);
    await owner.patch(`/cards/${s.cardId}`, { ownerId: mate.id, dueAt: new Date(Date.now() + 3600_000).toISOString(), priority: "high" });
    const n = await mate.get("/notifications");
    expect(n.body.notifications.map((x: { type: string }) => x.type)).toEqual(expect.arrayContaining(["card.assigned", "card.owner"]));
    const dash = await mate.get("/dashboard");
    expect(dash.body.stats.pending).toBeGreaterThanOrEqual(1);
    expect(dash.body.myTasks.some((t: { id: string }) => t.id === s.cardId)).toBe(true);
  });

  it("comentarios con menciones notifican al mencionado", async () => {
    await mate.post("/notifications/read", {});
    const r = await owner.post(`/cards/${s.cardId}/comments`, { body: `Mirá esto @[${mate.name}](${mate.id})` });
    expect(r.status).toBe(201);
    const n = await mate.get("/notifications?unread=1");
    expect(n.body.notifications[0].type).toBe("comment.mention");
  });

  it("solo el autor edita su comentario", async () => {
    const id = (await owner.post(`/cards/${s.cardId}/comments`, { body: "mío" })).body.id;
    expect((await mate.patch(`/comments/${id}`, { body: "cambiado" })).status).toBe(403);
    expect((await owner.patch(`/comments/${id}`, { body: "editado" })).status).toBe(200);
  });

  it("checklists, etiquetas, relaciones y descripción enriquecida", async () => {
    const cl = (await owner.post(`/cards/${s.cardId}/checklists`, { title: "Pasos" })).body.id;
    const item = (await owner.post(`/checklists/${cl}/items`, { text: "Paso 1" })).body.id;
    await owner.patch(`/checklist-items/${item}`, { done: true });
    const label = (await owner.post(`/boards/${s.boardId}/labels`, { name: "Diseño", color: "violet" })).body.id;
    expect((await owner.put(`/cards/${s.cardId}/labels`, { labelIds: [label] })).status).toBe(200);
    const other = (await owner.post(`/lists/${s.listId}/cards`, { title: "Bloqueante" })).body.id;
    expect((await owner.post(`/cards/${other}/relations`, { toCardId: s.cardId, type: "blocks" })).status).toBe(201);
    const desc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hola ", marks: [{ type: "bold" }] }, { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com", onclick: "x" } }] }] }] };
    expect((await owner.patch(`/cards/${s.cardId}`, { description: desc })).status).toBe(200);
    const bad = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] };
    expect((await owner.patch(`/cards/${s.cardId}`, { description: bad })).status).toBe(400);

    const card = (await owner.get(`/cards/${s.cardId}`)).body.card;
    expect(card.checklists[0].items[0].done).toBe(true);
    expect(card.labelIds).toEqual([label]);
    expect(card.relations[0]).toMatchObject({ type: "blocks", direction: "in" });
    expect(card.description.content[0].content[1].marks[0].attrs).toEqual({ href: "https://example.com" });
  });

  it("detecta ediciones concurrentes", async () => {
    const card = (await owner.get(`/cards/${s.cardId}`)).body.card;
    await mate.patch(`/cards/${s.cardId}`, { title: "Cambio de mate" });
    const r = await owner.patch(`/cards/${s.cardId}`, { title: "Mío", expectedUpdatedAt: card.updatedAt });
    expect(r.status).toBe(409);
  });

  it("el feed de cambios avanza con las ediciones de otros", async () => {
    const { cursor } = await board();
    await mate.post(`/lists/${s.listId}/cards`, { title: "Nueva de mate" });
    const r = await owner.get(`/boards/${s.boardId}/changes?after=${cursor}`);
    expect(r.body.changes.length).toBe(1);
    expect(r.body.changes[0]).toMatchObject({ action: "card.created", actorId: mate.id });
    expect(r.body.cursor).toBeGreaterThan(cursor);
  });

  it("archiva, restaura y busca", async () => {
    const id = (await owner.post(`/lists/${s.listId}/cards`, { title: "Investigar competidores" })).body.id;
    let found = await owner.get(`/search?q=compet`);
    expect(found.body.cards.map((c: { id: string }) => c.id)).toContain(id);
    await owner.post(`/cards/${id}/archive`, { archived: true });
    found = await owner.get(`/search?q=compet`);
    expect(found.body.cards.map((c: { id: string }) => c.id)).not.toContain(id);
    found = await owner.get(`/search?q=compet&status=archived`);
    expect(found.body.cards.map((c: { id: string }) => c.id)).toContain(id);
    expect((await mate.get(`/search?q=compet&assigneeId=me`)).body.cards).toHaveLength(0);
    expect((await owner.del(`/cards/${id}`)).status).toBe(204);
  });
});
