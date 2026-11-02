import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

describe("roles y permisos", () => {
  let owner: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;

  beforeAll(async () => {
    owner = await newUser("Owner");
    s = await seedBoard(owner);
  });

  async function boardUser(role: string) {
    const u = await newUser(role);
    await inviteAndAccept(owner, u, `/boards/${s.boardId}/invitations`, role);
    return u;
  }

  it("viewer: ve pero no comenta ni edita", async () => {
    const v = await boardUser("viewer");
    expect((await v.get(`/boards/${s.boardId}`)).status).toBe(200);
    expect((await v.post(`/cards/${s.cardId}/comments`, { body: "hola" })).status).toBe(403);
    expect((await v.post(`/lists/${s.listId}/cards`, { title: "x" })).status).toBe(403);
  });

  it("commenter: comenta pero no edita", async () => {
    const c = await boardUser("commenter");
    expect((await c.post(`/cards/${s.cardId}/comments`, { body: "hola" })).status).toBe(201);
    expect((await c.patch(`/cards/${s.cardId}`, { title: "x" })).status).toBe(403);
  });

  it("editor: edita tarjetas pero no administra el tablero", async () => {
    const e = await boardUser("editor");
    expect((await e.post(`/lists/${s.listId}/cards`, { title: "del editor" })).status).toBe(201);
    expect((await e.patch(`/boards/${s.boardId}`, { name: "x" })).status).toBe(403);
    expect((await e.put(`/boards/${s.boardId}/members/${e.id}`, { role: "admin" })).status).toBe(403);
  });

  it("un invitado de tablero no ve otros tableros ni miembros de la organización", async () => {
    const g = await boardUser("viewer");
    const other = (await owner.post(`/workspaces/${s.workspaceId}/boards`, { name: "Secreto", visibility: "workspace" })).body.id;
    expect((await g.get(`/boards/${other}`)).status).toBe(404);
    expect((await g.get(`/orgs/${s.orgId}/members`)).status).toBe(403);
    const ws = (await g.get(`/orgs/${s.orgId}/workspaces`)).body.workspaces;
    expect(ws.flatMap((w: { boards: { id: string }[] }) => w.boards.map((b) => b.id))).toEqual([s.boardId]);
  });

  it("visibilidad de espacio: los miembros del espacio acceden según workspaceAccess", async () => {
    const m = await newUser("ws-member");
    await inviteAndAccept(owner, m, `/workspaces/${s.workspaceId}/invitations`, "member");
    const shared = (await owner.post(`/workspaces/${s.workspaceId}/boards`, { name: "Compartido", visibility: "workspace", workspaceAccess: "commenter" })).body.id;
    const priv = (await owner.post(`/workspaces/${s.workspaceId}/boards`, { name: "Privado", visibility: "private" })).body.id;
    const r = await m.get(`/boards/${shared}`);
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("commenter");
    expect((await m.get(`/boards/${priv}`)).status).toBe(404);
  });

  it("roles de organización: un admin no puede tocar a un dueño ni crear dueños", async () => {
    const admin = await newUser("org-admin");
    await inviteAndAccept(owner, admin, `/orgs/${s.orgId}/invitations`, "admin");
    expect((await admin.patch(`/orgs/${s.orgId}/members/${owner.id}`, { role: "member" })).status).toBe(403);
    expect((await admin.patch(`/orgs/${s.orgId}/members/${admin.id}`, { role: "owner" })).status).toBe(403);
    expect((await admin.del(`/orgs/${s.orgId}/members/${owner.id}`)).status).toBe(403);
  });

  it("no se puede dejar a la organización sin dueño", async () => {
    expect((await owner.patch(`/orgs/${s.orgId}/members/${owner.id}`, { role: "admin" })).status).toBe(409);
    expect((await owner.del(`/orgs/${s.orgId}/members/${owner.id}`)).status).toBe(409);
  });

  it("el acceso administrativo a un tablero ajeno queda auditado", async () => {
    const admin = await newUser("auditor");
    await inviteAndAccept(owner, admin, `/orgs/${s.orgId}/invitations`, "admin");
    expect((await admin.get(`/boards/${s.boardId}`)).status).toBe(200);
    const audit = await owner.get(`/orgs/${s.orgId}/audit`);
    expect(audit.body.entries.some((e: { action: string; actorId: string }) => e.action === "admin.board_override" && e.actorId === admin.id)).toBe(true);
  });

  it("la invitación solo la acepta el correo invitado", async () => {
    const intended = await newUser("intended");
    const other = await newUser("other");
    await owner.post(`/orgs/${s.orgId}/invitations`, { email: intended.email, role: "member" });
    const { tokenFromLastMail } = await import("../helpers");
    const token = tokenFromLastMail(intended.email, "invite");
    expect((await other.post("/invitations/accept", { token })).status).toBe(403);
    expect((await intended.post("/invitations/accept", { token })).status).toBe(200);
    expect((await intended.post("/invitations/accept", { token })).status).toBe(400);
  });

  it("quitar a un miembro de la organización le quita el acceso a todo", async () => {
    const m = await newUser("removed");
    await inviteAndAccept(owner, m, `/orgs/${s.orgId}/invitations`, "member");
    await owner.put(`/boards/${s.boardId}/members/${m.id}`, { role: "editor" });
    expect((await m.get(`/boards/${s.boardId}`)).status).toBe(200);
    expect((await owner.del(`/orgs/${s.orgId}/members/${m.id}`)).status).toBe(204);
    expect((await m.get(`/boards/${s.boardId}`)).status).toBe(404);
  });
});
