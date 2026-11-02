import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

describe("tarjetas espejo", () => {
  let lead: Client;
  let qa: Client;
  let dev: Awaited<ReturnType<typeof seedBoard>>;
  let qaBoard: { id: string; listId: string; lists: { id: string }[] };
  let mirrorId: string;
  const get = async (c: Client, boardId: string) => (await c.get(`/boards/${boardId}`)).body;

  beforeAll(async () => {
    lead = await newUser("Líder");
    qa = await newUser("QA");
    dev = await seedBoard(lead); // tablero "Desarrollo" con la tarjeta original
    const b = (await lead.post(`/workspaces/${dev.workspaceId}/boards`, { name: "QA", visibility: "private" })).body;
    const detail = await get(lead, b.id);
    qaBoard = { id: b.id, listId: detail.lists[0].id, lists: detail.lists };
    // QA participa solo del tablero de QA.
    await inviteAndAccept(lead, qa, `/boards/${qaBoard.id}/invitations`, "editor");
  });

  it("espeja una tarjeta en otro tablero y muestra los mismos datos", async () => {
    await lead.patch(`/cards/${dev.cardId}`, { priority: "high" });
    const r = await lead.post(`/cards/${dev.cardId}/mirrors`, { boardId: qaBoard.id });
    expect(r.status).toBe(201);
    mirrorId = r.body.id;
    expect((await lead.post(`/cards/${dev.cardId}/mirrors`, { boardId: qaBoard.id })).status).toBe(409);
    expect((await lead.post(`/cards/${dev.cardId}/mirrors`, { boardId: dev.boardId })).status).toBe(400);

    const board = await get(lead, qaBoard.id);
    const m = board.cards.find((c: { id: string }) => c.id === mirrorId);
    expect(m).toMatchObject({ title: "Primera tarea", priority: "high", listId: qaBoard.listId, mirror: { cardId: dev.cardId, boardId: dev.boardId } });
    const detail = (await lead.get(`/cards/${dev.cardId}`)).body.card;
    expect(detail.mirrors.map((x: { boardId: string }) => x.boardId)).toEqual([qaBoard.id]);
  });

  it("los cambios en la original se ven en el espejo y avisan al tablero del espejo", async () => {
    const cursor = (await get(lead, qaBoard.id)).cursor;
    await lead.patch(`/cards/${dev.cardId}`, { title: "Login con Google" });
    const m = (await get(lead, qaBoard.id)).cards.find((c: { id: string }) => c.id === mirrorId);
    expect(m.title).toBe("Login con Google");
    const changes = (await lead.get(`/boards/${qaBoard.id}/changes?after=${cursor}`)).body.changes;
    expect(changes.some((c: { cardId: string }) => c.cardId === dev.cardId)).toBe(true);
  });

  it("quien no ve el tablero original no ve el espejo ni sus cambios", async () => {
    const board = await get(qa, qaBoard.id);
    expect(board.cards.some((c: { id: string }) => c.id === mirrorId)).toBe(false);
    expect(JSON.stringify(board)).not.toContain("Login con Google");
    expect((await qa.get(`/cards/${dev.cardId}`)).status).toBe(404);
    const changes = (await qa.get(`/boards/${qaBoard.id}/changes?after=0`)).body.changes;
    expect(changes.some((c: { cardId: string }) => c.cardId === dev.cardId)).toBe(false);
    // Tampoco puede espejar tarjetas que no ve.
    expect((await qa.post(`/cards/${dev.cardId}/mirrors`, { boardId: qaBoard.id })).status).toBe(404);
  });

  it("el espejo se ordena junto con las tarjetas de su lista", async () => {
    const own = (await lead.post(`/lists/${qaBoard.listId}/cards`, { title: "Tarjeta propia de QA" })).body.id;
    expect((await lead.post(`/mirrors/${mirrorId}/move`, { listId: qaBoard.listId, afterCardId: own })).status).toBe(200);
    let order = (await get(lead, qaBoard.id)).cards.filter((c: { listId: string }) => c.listId === qaBoard.listId).map((c: { id: string }) => c.id);
    expect(order.indexOf(own)).toBeLessThan(order.indexOf(mirrorId));
    // Una tarjeta común puede ubicarse después del espejo.
    expect((await lead.post(`/cards/${own}/move`, { listId: qaBoard.listId, afterCardId: mirrorId })).status).toBe(200);
    order = (await get(lead, qaBoard.id)).cards.filter((c: { listId: string }) => c.listId === qaBoard.listId).map((c: { id: string }) => c.id);
    expect(order.indexOf(mirrorId)).toBeLessThan(order.indexOf(own));
    // Mover el espejo de lista no cambia la lista de la original.
    await lead.post(`/mirrors/${mirrorId}/move`, { listId: qaBoard.lists[1]!.id, afterCardId: null });
    expect((await lead.get(`/cards/${dev.cardId}`)).body.card.listId).toBe(dev.listId);
  });

  it("no se puede espejar en otra organización", async () => {
    const otherOrg = await seedBoard(lead);
    expect((await lead.post(`/cards/${dev.cardId}/mirrors`, { boardId: otherOrg.boardId })).status).toBe(400);
  });

  it("quitar el espejo no toca la original; archivar la original oculta el espejo", async () => {
    const extra = (await lead.post(`/lists/${dev.listId}/cards`, { title: "Diseño de pantallas" })).body.id;
    const m2 = (await lead.post(`/cards/${extra}/mirrors`, { boardId: qaBoard.id })).body.id;
    expect((await qa.del(`/mirrors/${mirrorId}`)).status).toBe(200); // QA edita su tablero
    expect((await lead.get(`/cards/${dev.cardId}`)).status).toBe(200);
    expect((await lead.get(`/cards/${dev.cardId}`)).body.card.mirrors).toHaveLength(0);

    await lead.post(`/cards/${extra}/archive`, { archived: true });
    expect((await get(lead, qaBoard.id)).cards.some((c: { id: string }) => c.id === m2)).toBe(false);
    await lead.del(`/cards/${extra}`);
    expect((await lead.del(`/mirrors/${m2}`)).status).toBe(404); // se borró junto con la tarjeta
  });
});
