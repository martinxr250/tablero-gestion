import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withUser } from "@/server/db/client";
import { Client, newUser, seedBoard } from "../helpers";

// Pruebas BOLA/IDOR: un usuario de otra organización nunca debe ver ni modificar recursos ajenos.
describe("aislamiento entre organizaciones", () => {
  let alice: Client;
  let mallory: Client;
  let a: Awaited<ReturnType<typeof seedBoard>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    alice = await newUser("Alice");
    mallory = await newUser("Mallory");
    await seedBoard(mallory);
    a = await seedBoard(alice);
    ids.label = (await alice.post(`/boards/${a.boardId}/labels`, { name: "Urgente", color: "red" })).body.id;
    ids.checklist = (await alice.post(`/cards/${a.cardId}/checklists`, { title: "Pasos" })).body.id;
    ids.item = (await alice.post(`/checklists/${ids.checklist}/items`, { text: "Uno" })).body.id;
    ids.comment = (await alice.post(`/cards/${a.cardId}/comments`, { body: "Hola" })).body.id;
    const form = new FormData();
    form.set("file", new File([new TextEncoder().encode("hola mundo")], "nota.txt"));
    ids.attachment = (await alice.req("POST", `/cards/${a.cardId}/attachments`, undefined, { form })).body.id;
    ids.invitation = (await alice.post(`/orgs/${a.orgId}/invitations`, { email: "x@example.test", role: "member" })).body.id;
  });

  const probes = (): [string, string, unknown?][] => [
    ["GET", `/orgs/${a.orgId}`],
    ["PATCH", `/orgs/${a.orgId}`, { name: "hack" }],
    ["GET", `/orgs/${a.orgId}/members`],
    ["GET", `/orgs/${a.orgId}/workspaces`],
    ["GET", `/orgs/${a.orgId}/audit`],
    ["GET", `/orgs/${a.orgId}/invitations`],
    ["POST", `/orgs/${a.orgId}/invitations`, { email: "m@example.test", role: "admin" }],
    ["POST", `/orgs/${a.orgId}/workspaces`, { name: "hack" }],
    ["DELETE", `/invitations/${ids.invitation}`],
    ["GET", `/workspaces/${a.workspaceId}`],
    ["POST", `/workspaces/${a.workspaceId}/boards`, { name: "hack" }],
    ["GET", `/boards/${a.boardId}`],
    ["PATCH", `/boards/${a.boardId}`, { name: "hack" }],
    ["GET", `/boards/${a.boardId}/changes`],
    ["GET", `/boards/${a.boardId}/activity`],
    ["POST", `/boards/${a.boardId}/lists`, { name: "hack" }],
    ["PATCH", `/lists/${a.listId}`, { name: "hack" }],
    ["POST", `/lists/${a.listId}/cards`, { title: "hack" }],
    ["GET", `/cards/${a.cardId}`],
    ["PATCH", `/cards/${a.cardId}`, { title: "hack" }],
    ["POST", `/cards/${a.cardId}/move`, { listId: a.listId, afterCardId: null }],
    ["PUT", `/cards/${a.cardId}/assignees`, { userIds: [] }],
    ["GET", `/cards/${a.cardId}/comments`],
    ["POST", `/cards/${a.cardId}/comments`, { body: "hack" }],
    ["PATCH", `/comments/${ids.comment}`, { body: "hack" }],
    ["DELETE", `/comments/${ids.comment}`],
    ["PATCH", `/labels/${ids.label}`, { name: "hack" }],
    ["PATCH", `/checklists/${ids.checklist}`, { title: "hack" }],
    ["PATCH", `/checklist-items/${ids.item}`, { done: true }],
    ["GET", `/attachments/${ids.attachment}/download`],
    ["DELETE", `/attachments/${ids.attachment}`],
  ];

  it("devuelve 404 en todos los recursos de otra organización", async () => {
    for (const [method, path, body] of probes()) {
      const r = await mallory.req(method, path, body);
      expect([403, 404], `${method} ${path} → ${r.status}`).toContain(r.status);
    }
  });

  it("no permite relacionar una tarjeta ajena ni asignar usuarios ajenos", async () => {
    const m = await seedBoard(mallory);
    expect((await mallory.post(`/cards/${m.cardId}/relations`, { toCardId: a.cardId, type: "relates" })).status).toBe(404);
    expect((await alice.put(`/cards/${a.cardId}/assignees`, { userIds: [mallory.id] })).status).toBe(400);
  });

  it("los datos siguen intactos tras los intentos", async () => {
    const r = await alice.get(`/cards/${a.cardId}`);
    expect(r.body.card.title).toBe("Primera tarea");
  });

  it("RLS bloquea el acceso aunque la consulta no filtre por organización", async () => {
    const rows = await withUser(mallory.id, (tx) => tx.execute(sql`select id from app.cards where id = ${a.cardId}`));
    expect(rows.length).toBe(0);
    const all = await withUser(mallory.id, (tx) => tx.execute<{ org_id: string }>(sql`select distinct org_id from app.cards`));
    expect(all.every((r) => r.org_id !== a.orgId)).toBe(true);
  });

  it("RLS impide insertar filas en una organización ajena", async () => {
    await expect(
      withUser(mallory.id, (tx) =>
        tx.execute(sql`insert into app.labels (id, org_id, board_id, name, color) values (gen_random_uuid(), ${a.orgId}, ${a.boardId}, 'x', 'red')`),
      ),
    ).rejects.toThrow();
  });
});
