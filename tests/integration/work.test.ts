import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

describe("mi trabajo: planificador y bandeja personal", () => {
  let ana: Client;
  let beto: Client;
  let a: Awaited<ReturnType<typeof seedBoard>>;
  let b: Awaited<ReturnType<typeof seedBoard>>;

  beforeAll(async () => {
    ana = await newUser("Ana");
    beto = await newUser("Beto");
    a = await seedBoard(ana); // organización de Ana
    b = await seedBoard(beto); // organización de Beto
    await inviteAndAccept(beto, ana, `/boards/${b.boardId}/invitations`, "editor");
  });

  it("junta las tareas de varias organizaciones donde soy responsable o colaborador", async () => {
    const mine = (await ana.post(`/lists/${a.listId}/cards`, { title: "Mía en mi org" })).body.id;
    await ana.patch(`/cards/${mine}`, { ownerId: ana.id, dueAt: "2026-11-10T12:00:00.000Z", priority: "high" });
    const helping = (await beto.post(`/lists/${b.listId}/cards`, { title: "Ayudo en la de Beto" })).body.id;
    await beto.put(`/cards/${helping}/assignees`, { userIds: [ana.id] });
    const notMine = (await beto.post(`/lists/${b.listId}/cards`, { title: "De Beto solo" })).body.id;
    await beto.patch(`/cards/${notMine}`, { ownerId: beto.id });

    const r = await ana.get("/me/work");
    expect(r.status).toBe(200);
    const titles = r.body.cards.map((c: { title: string }) => c.title);
    expect(titles).toEqual(expect.arrayContaining(["Mía en mi org", "Ayudo en la de Beto"]));
    expect(titles).not.toContain("De Beto solo");
    const first = r.body.cards.find((c: { title: string }) => c.title === "Mía en mi org");
    expect(first).toMatchObject({ isOwner: true, priority: "high", board: { id: a.boardId } });
    expect(r.body.cards[0].title).toBe("Mía en mi org"); // primero lo que tiene fecha
  });

  it("las completadas solo aparecen si se piden", async () => {
    const id = (await ana.get("/me/work")).body.cards.find((c: { title: string }) => c.title === "Mía en mi org").id;
    await ana.patch(`/cards/${id}`, { completed: true });
    expect((await ana.get("/me/work")).body.cards.some((c: { id: string }) => c.id === id)).toBe(false);
    expect((await ana.get("/me/work?completed=week")).body.cards.some((c: { id: string }) => c.id === id)).toBe(true);
  });

  it("si pierdo el acceso al tablero, sus tareas desaparecen de mi trabajo", async () => {
    await beto.del(`/boards/${b.boardId}/members/${ana.id}`);
    const titles = (await ana.get("/me/work")).body.cards.map((c: { title: string }) => c.title);
    expect(titles).not.toContain("Ayudo en la de Beto");
  });

  it("bandeja: anotar, editar, completar y borrar; cada uno ve solo la suya", async () => {
    const id = (await ana.post("/me/inbox", { title: "Llamar al cliente", dueOn: "2026-11-05" })).body.id;
    expect((await ana.post("/me/inbox", { title: "" })).status).toBe(400);
    expect((await ana.patch(`/me/inbox/${id}`, { title: "Llamar a ACME" })).status).toBe(200);
    expect((await ana.get("/me/inbox")).body.items[0]).toMatchObject({ title: "Llamar a ACME", dueOn: "2026-11-05", done: false });

    expect((await beto.get("/me/inbox")).body.items).toHaveLength(0);
    expect((await beto.patch(`/me/inbox/${id}`, { done: true })).status).toBe(404);
    expect((await beto.del(`/me/inbox/${id}`)).status).toBe(404);

    expect((await ana.patch(`/me/inbox/${id}`, { done: true })).status).toBe(200);
    expect((await ana.get("/me/inbox")).body.items[0].done).toBe(true);
    expect((await ana.del(`/me/inbox/${id}`)).status).toBe(200);
  });

  it("bandeja: mandar una nota a un tablero la convierte en tarjeta mía", async () => {
    const id = (await ana.post("/me/inbox", { title: "Preparar demo", dueOn: "2026-11-20" })).body.id;
    expect((await ana.post(`/me/inbox/${id}/move`, { listId: b.listId })).status).toBe(404); // ya no tiene acceso a ese tablero
    const r = await ana.post(`/me/inbox/${id}/move`, { listId: a.listId });
    expect(r.status).toBe(200);
    const card = (await ana.get(`/cards/${r.body.cardId}`)).body.card;
    expect(card).toMatchObject({ title: "Preparar demo", ownerId: ana.id });
    expect(card.dueAt.slice(0, 10)).toBe("2026-11-20");
    expect((await ana.get("/me/inbox")).body.items.some((i: { id: string }) => i.id === id)).toBe(false);
  });
});
