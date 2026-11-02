import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

const tokenOf = (url: string) => url.split("/").pop()!;

describe("enlaces para compartir un tablero", () => {
  let admin: Client;
  let editor: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;

  beforeAll(async () => {
    admin = await newUser("Admin");
    editor = await newUser("Editora");
    s = await seedBoard(admin);
    await inviteAndAccept(admin, editor, `/boards/${s.boardId}/invitations`, "editor");
    await admin.patch(`/cards/${s.cardId}`, { description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Detalle" }] }] } });
  });

  it("solo administradores ven y gestionan los enlaces", async () => {
    expect((await editor.get(`/boards/${s.boardId}/share`)).status).toBe(403);
    expect((await editor.put(`/boards/${s.boardId}/share/public`, { enabled: true })).status).toBe(403);
    const r = await admin.get(`/boards/${s.boardId}/share`);
    expect(r.status).toBe(200);
    expect(r.body.public.enabled).toBe(false);
    expect(r.body.join.enabled).toBe(false);
  });

  it("enlace público: muestra el tablero sin sesión y sin datos internos", async () => {
    const on = await admin.put(`/boards/${s.boardId}/share/public`, { enabled: true, role: "editor" });
    expect(on.status).toBe(200);
    expect(on.body.url).toMatch(/\/p\/[A-Za-z0-9_-]{20,}$/);
    expect(on.body.role).toBe("viewer"); // el público siempre es solo lectura

    const anon = new Client();
    const r = await anon.get(`/public/boards/${tokenOf(on.body.url)}`);
    expect(r.status).toBe(200);
    expect(r.body.board.name).toBe("Tablero");
    expect(r.body.cards.map((c: { title: string }) => c.title)).toContain("Primera tarea");
    expect(JSON.stringify(r.body)).not.toContain(admin.email);
    expect(r.body.people[0]).not.toHaveProperty("email");

    const card = await anon.get(`/public/boards/${tokenOf(on.body.url)}/cards/${s.cardId}`);
    expect(card.status).toBe(200);
    expect(JSON.stringify(card.body.description)).toContain("Detalle");
    expect(card.body).not.toHaveProperty("comments");
  });

  it("enlace público: no permite escribir ni ver tarjetas de otros tableros", async () => {
    const { url } = (await admin.get(`/boards/${s.boardId}/share`)).body.public;
    const anon = new Client();
    expect((await anon.post(`/lists/${s.listId}/cards`, { title: "Intruso" })).status).toBe(401);
    const other = await seedBoard(await newUser("Otro"));
    expect((await anon.get(`/public/boards/${tokenOf(url)}/cards/${other.cardId}`)).status).toBe(404);
    expect((await anon.get(`/public/boards/token-inventado-que-no-existe-123/cards/${s.cardId}`)).status).toBe(404);
  });

  it("regenerar invalida el enlace anterior y desactivar lo corta", async () => {
    const old = (await admin.get(`/boards/${s.boardId}/share`)).body.public.url;
    const fresh = (await admin.put(`/boards/${s.boardId}/share/public`, { enabled: true, regenerate: true })).body.url;
    expect(fresh).not.toBe(old);
    const anon = new Client();
    expect((await anon.get(`/public/boards/${tokenOf(old)}`)).status).toBe(404);
    expect((await anon.get(`/public/boards/${tokenOf(fresh)}`)).status).toBe(200);
    await admin.put(`/boards/${s.boardId}/share/public`, { enabled: false });
    expect((await anon.get(`/public/boards/${tokenOf(fresh)}`)).status).toBe(404);
  });

  it("enlace para unirse: pide sesión y suma a alguien de otra organización como invitado", async () => {
    const on = await admin.put(`/boards/${s.boardId}/share/join`, { enabled: true, role: "commenter" });
    expect(on.body.url).toMatch(/\/join\//);
    const token = tokenOf(on.body.url);

    expect((await new Client().post(`/share/join/${token}`)).status).toBe(401);
    // Un enlace público no sirve para unirse.
    const pub = (await admin.put(`/boards/${s.boardId}/share/public`, { enabled: true })).body.url;
    const stranger = await newUser("Externa");
    expect((await stranger.post(`/share/join/${tokenOf(pub)}`)).status).toBe(404);

    const look = await stranger.get(`/share/join/${token}`);
    expect(look.body).toMatchObject({ boardName: "Tablero", role: "commenter", currentRole: null });
    expect((await stranger.get(`/boards/${s.boardId}`)).status).toBe(404);
    expect((await stranger.post(`/share/join/${token}`)).status).toBe(200);

    const board = await stranger.get(`/boards/${s.boardId}`);
    expect(board.status).toBe(200);
    expect(board.body.role).toBe("commenter");
    // Comentar sí, editar no.
    expect((await stranger.post(`/cards/${s.cardId}/comments`, { body: "Hola" })).status).toBe(201);
    expect((await stranger.patch(`/cards/${s.cardId}`, { title: "Cambio" })).status).toBe(403);
  });

  it("unirse nunca baja el rol que ya se tenía", async () => {
    const token = tokenOf((await admin.put(`/boards/${s.boardId}/share/join`, { enabled: true, role: "viewer" })).body.url);
    expect((await editor.post(`/share/join/${token}`)).status).toBe(200);
    expect((await editor.get(`/boards/${s.boardId}`)).body.role).toBe("editor");
  });
});
