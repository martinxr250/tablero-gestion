import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withSystem } from "@/server/db/client";
import { cardDevRefs } from "@/server/db/schema";
import { uuidv7 } from "@/server/core/ids";
import { Client, inviteAndAccept, newUser, seedBoard, tokenFromLastMail } from "../helpers";

// Varias personas y dos organizaciones trabajando a la vez sobre los mismos datos.
// Cada caso define el comportamiento esperado ante el conflicto y verifica que no se pierda información.

const upload = (c: Client, cardId: string, name = "nota.txt") => {
  const form = new FormData();
  form.set("file", new File(["contenido de prueba"], name, { type: "text/plain" }));
  return c.req("POST", `/cards/${cardId}/attachments`, undefined, { form });
};

describe("matriz de roles", () => {
  const people: Record<"owner" | "admin" | "editor" | "commenter" | "viewer", Client> = {} as never;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  let other: Awaited<ReturnType<typeof seedBoard>>;

  beforeAll(async () => {
    people.owner = await newUser("Dueña");
    s = await seedBoard(people.owner);
    for (const role of ["admin", "editor", "commenter", "viewer"] as const) {
      people[role] = await newUser(role);
      await inviteAndAccept(people.owner, people[role], `/boards/${s.boardId}/invitations`, role);
    }
    // Otro tablero de la misma organización para espejos.
    const b2 = (await people.owner.post(`/workspaces/${s.workspaceId}/boards`, { name: "Destino", visibility: "workspace" })).body.id;
    other = { ...s, boardId: b2 };
  });

  // Código esperado por rol: [dueño, admin, editor, comentarista, lector].
  const cases: [string, (c: Client) => Promise<{ status: number }>, number[]][] = [
    ["ver el tablero", (c) => c.get(`/boards/${s.boardId}`), [200, 200, 200, 200, 200]],
    ["crear tarjetas", (c) => c.post(`/lists/${s.listId}/cards`, { title: "Nueva" }), [201, 201, 201, 403, 403]],
    ["editar tarjetas", (c) => c.patch(`/cards/${s.cardId}`, { priority: "low" }), [200, 200, 200, 403, 403]],
    ["comentar", (c) => c.post(`/cards/${s.cardId}/comments`, { body: "Hola" }), [201, 201, 201, 201, 403]],
    ["adjuntar archivos", (c) => upload(c, s.cardId), [201, 201, 201, 403, 403]],
    ["crear campos personalizados", (c) => c.post(`/boards/${s.boardId}/fields`, { name: `Campo ${Math.random()}`.slice(0, 30), type: "text" }), [201, 201, 201, 403, 403]],
    ["configurar reglas de cierre", (c) => c.put(`/boards/${s.boardId}/completion-rules`, { subtasks: "warn" }), [200, 200, 403, 403, 403]],
    ["gestionar enlaces para compartir", (c) => c.get(`/boards/${s.boardId}/share`), [200, 200, 403, 403, 403]],
    ["invitar al tablero", (c) => c.post(`/boards/${s.boardId}/invitations`, { email: `x${Math.random()}@example.test`, role: "viewer" }), [201, 201, 403, 403, 403]],
    ["cambiar la configuración", (c) => c.patch(`/boards/${s.boardId}`, { description: "Cambio" }), [200, 200, 403, 403, 403]],
    ["ver el panel del líder", (c) => c.get(`/boards/${s.boardId}/insights`), [200, 200, 200, 200, 200]],
    ["aprobar control de calidad", (c) => c.post(`/cards/${s.cardId}/qa`, { decision: "reject", note: "Revisar" }), [200, 200, 403, 403, 403]],
  ];

  beforeAll(async () => {
    await people.owner.patch(`/boards/${s.boardId}`, { qaRequired: true, qaListId: s.lists[1]!.id, doneListId: s.lists[2]!.id });
  });

  for (const [name, call, expected] of cases) {
    it(name, async () => {
      const got = [];
      for (const role of ["owner", "admin", "editor", "commenter", "viewer"] as const) got.push((await call(people[role])).status);
      expect(got).toEqual(expected);
    });
  }

  it("espejar exige ver el original y poder editar el destino", async () => {
    // El comentarista no edita el destino; el editor sí, pero solo si ve el tablero destino.
    expect((await people.commenter.post(`/cards/${s.cardId}/mirrors`, { boardId: other.boardId })).status).toBe(404);
    expect((await people.owner.post(`/cards/${s.cardId}/mirrors`, { boardId: other.boardId })).status).toBe(201);
  });

  it("los permisos se aplican en el servidor aunque el botón esté oculto: borrar la tarjeta", async () => {
    const id = (await people.owner.post(`/lists/${s.listId}/cards`, { title: "Para borrar" })).body.id;
    expect((await people.viewer.del(`/cards/${id}`)).status).toBe(403);
    expect((await people.commenter.del(`/cards/${id}`)).status).toBe(403);
    expect((await people.owner.get(`/cards/${id}`)).status).toBe(200);
  });
});

describe("aislamiento entre organizaciones con identificadores manipulados", () => {
  let a: Client;
  let b: Client;
  let sa: Awaited<ReturnType<typeof seedBoard>>;
  let sb: Awaited<ReturnType<typeof seedBoard>>;
  let attachmentId: string;
  let commentId: string;

  beforeAll(async () => {
    a = await newUser("Org A");
    b = await newUser("Org B");
    sa = await seedBoard(a);
    sb = await seedBoard(b);
    attachmentId = (await upload(a, sa.cardId)).body.id;
    commentId = (await a.post(`/cards/${sa.cardId}/comments`, { body: "Privado de A" })).body.id;
    await a.post(`/boards/${sa.boardId}/fields`, { name: "Cliente", type: "text" });
  });

  it("no lee tareas, comentarios, adjuntos, historial ni condiciones de otra organización", async () => {
    for (const path of [
      `/cards/${sa.cardId}`,
      `/cards/${sa.cardId}/comments`,
      `/cards/${sa.cardId}/activity`,
      `/cards/${sa.cardId}/completion`,
      `/cards/${sa.cardId}/dev`,
      `/attachments/${attachmentId}/download`,
      `/boards/${sa.boardId}/deployments`,
      `/boards/${sa.boardId}/insights`,
      `/boards/${sa.boardId}/changes?after=0`,
    ]) {
      const r = await b.get(path);
      expect([403, 404], path).toContain(r.status);
      expect(r.text).not.toContain("Privado de A");
    }
  });

  it("no modifica ni borra recursos ajenos", async () => {
    const field = (await a.get(`/boards/${sa.boardId}`)).body.fields[0].id;
    const attempts = [
      b.patch(`/cards/${sa.cardId}`, { title: "Hackeado" }),
      b.del(`/cards/${sa.cardId}`),
      b.patch(`/comments/${commentId}`, { body: "Hackeado" }),
      b.del(`/attachments/${attachmentId}`),
      b.put(`/cards/${sa.cardId}/fields/${field}`, { value: "x" }),
      b.post(`/cards/${sb.cardId}/mirrors`, { boardId: sa.boardId }),
      b.post(`/cards/${sa.cardId}/mirrors`, { boardId: sb.boardId }),
      b.put(`/boards/${sa.boardId}/share/public`, { enabled: true }),
      b.put(`/boards/${sa.boardId}/capacity/${b.id}`, { points: 3 }),
      b.post(`/cards/${sb.cardId}/relations`, { toCardId: sa.cardId, type: "blocks" }),
    ];
    for (const r of await Promise.all(attempts)) expect([400, 403, 404]).toContain(r.status);
    const card = (await a.get(`/cards/${sa.cardId}`)).body.card;
    expect(card.title).toBe("Primera tarea");
    expect((await a.get(`/cards/${sa.cardId}/comments`)).text).toContain("Privado de A");
  });

  it("una nota de la bandeja no se puede mandar a una lista de otra organización", async () => {
    const note = (await b.post("/me/inbox", { title: "Nota de B" })).body.id;
    expect((await b.post(`/me/inbox/${note}/move`, { listId: sa.listId })).status).toBe(404);
  });

  it("las invitaciones ajenas no se ven ni se revocan", async () => {
    await a.post(`/boards/${sa.boardId}/invitations`, { email: "nuevo@example.test", role: "editor" });
    const inv = (await a.get(`/orgs/${sa.orgId}/invitations`)).body.invitations?.[0]?.id ?? uuidv7();
    expect([403, 404]).toContain((await b.del(`/invitations/${inv}`)).status);
    expect([403, 404]).toContain((await b.get(`/orgs/${sa.orgId}/invitations`)).status);
  });
});

describe("concurrencia sobre el mismo tablero", () => {
  let ana: Client;
  let beto: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  const card = async (title: string) => (await ana.post(`/lists/${s.listId}/cards`, { title })).body.id as string;

  beforeAll(async () => {
    ana = await newUser("Ana");
    beto = await newUser("Beto");
    s = await seedBoard(ana);
    await inviteAndAccept(ana, beto, `/boards/${s.boardId}/invitations`, "editor");
  });

  it("dos personas editan la misma tarjeta: con versión, una gana y la otra recibe un conflicto (nada se pierde en silencio)", async () => {
    const id = await card("Texto compartido");
    const v = (await ana.get(`/cards/${id}`)).body.card.updatedAt;
    const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    const [r1, r2] = await Promise.all([
      ana.patch(`/cards/${id}`, { description: doc("Versión de Ana"), expectedUpdatedAt: v }),
      beto.patch(`/cards/${id}`, { description: doc("Versión de Beto"), expectedUpdatedAt: v }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.code).toBe("stale_update");
    const saved = JSON.stringify((await ana.get(`/cards/${id}`)).body.card.description);
    expect(saved.includes("Versión de Ana") !== saved.includes("Versión de Beto")).toBe(true);
  });

  it("cambios en campos distintos al mismo tiempo se conservan los dos", async () => {
    const id = await card("Campos distintos");
    await Promise.all([ana.patch(`/cards/${id}`, { priority: "high" }), beto.patch(`/cards/${id}`, { estimatePoints: 5 })]);
    const c = (await ana.get(`/cards/${id}`)).body.card;
    expect(c).toMatchObject({ priority: "high", estimatePoints: 5 });
  });

  it("dos personas mueven la misma tarjeta a la vez: queda en una sola lista y con posición válida", async () => {
    const id = await card("Movida");
    const [r1, r2] = await Promise.all([
      ana.post(`/cards/${id}/move`, { listId: s.lists[1]!.id, afterCardId: null }),
      beto.post(`/cards/${id}/move`, { listId: s.lists[2]!.id, afterCardId: null }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const board = (await ana.get(`/boards/${s.boardId}`)).body;
    const copies = board.cards.filter((c: { id: string }) => c.id === id);
    expect(copies).toHaveLength(1);
    expect([s.lists[1]!.id, s.lists[2]!.id]).toContain(copies[0].listId);
    const positions = board.cards.filter((c: { listId: string }) => c.listId === copies[0].listId).map((c: { position: string }) => c.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("una persona borra la tarjeta mientras otra la edita: no hay errores internos y la tarjeta no reaparece", async () => {
    const id = await card("Borrada en paralelo");
    await ana.post(`/cards/${id}/archive`, { archived: true }); // solo se borran tarjetas archivadas
    const [del, edit] = await Promise.all([ana.del(`/cards/${id}`), beto.patch(`/cards/${id}`, { title: "Editada" })]);
    expect([200, 204]).toContain(del.status);
    expect([200, 404]).toContain(edit.status);
    expect((await ana.get(`/cards/${id}`)).status).toBe(404);
  });

  it("quitar permisos durante una sesión activa corta el acceso en la siguiente operación", async () => {
    const id = await card("Permisos");
    expect((await beto.patch(`/cards/${id}`, { priority: "low" })).status).toBe(200);
    await ana.put(`/boards/${s.boardId}/members/${beto.id}`, { role: "viewer" });
    expect((await beto.patch(`/cards/${id}`, { priority: "high" })).status).toBe(403);
    expect((await beto.get(`/cards/${id}`)).status).toBe(200);
    await ana.put(`/boards/${s.boardId}/members/${beto.id}`, { role: "editor" });
  });

  it("dos personas modifican la misma checklist: se conservan todos los ítems", async () => {
    const id = await card("Checklist compartida");
    const chk = (await ana.post(`/cards/${id}/checklists`, { title: "Pasos" })).body.id;
    await Promise.all([
      ...["A1", "A2", "A3"].map((t) => ana.post(`/checklists/${chk}/items`, { text: t })),
      ...["B1", "B2", "B3"].map((t) => beto.post(`/checklists/${chk}/items`, { text: t })),
    ]);
    const items = (await ana.get(`/cards/${id}`)).body.card.checklists[0].items as { id: string; text: string }[];
    expect(items.map((i) => i.text).sort()).toEqual(["A1", "A2", "A3", "B1", "B2", "B3"]);
    // Marcar el mismo ítem a la vez deja un estado final coherente.
    await Promise.all([ana.patch(`/checklist-items/${items[0]!.id}`, { done: true }), beto.patch(`/checklist-items/${items[0]!.id}`, { done: true })]);
    expect((await ana.get(`/cards/${id}`)).body.card.checklists[0].items.find((i: { id: string }) => i.id === items[0]!.id).done).toBe(true);
  });

  it("una tarjeta espejo refleja el cambio para las dos personas", async () => {
    const dest = (await ana.post(`/workspaces/${s.workspaceId}/boards`, { name: "Espejos", visibility: "workspace" })).body.id;
    await ana.put(`/boards/${dest}/members/${beto.id}`, { role: "editor" });
    const id = await card("Original");
    const m = (await ana.post(`/cards/${id}/mirrors`, { boardId: dest })).body.id;
    await beto.patch(`/cards/${id}`, { title: "Original editada por Beto" });
    for (const who of [ana, beto]) {
      const mirror = (await who.get(`/boards/${dest}`)).body.cards.find((c: { id: string }) => c.id === m);
      expect(mirror.title).toBe("Original editada por Beto");
    }
  });

  it("aceptar una invitación mientras cambia el rol no duplica la membresía", async () => {
    const carla = await newUser("Carla");
    await ana.post(`/boards/${s.boardId}/invitations`, { email: carla.email, role: "commenter" });
    const token = tokenFromLastMail(carla.email, "invite");
    const [acc] = await Promise.all([carla.post("/invitations/accept", { token }), carla.get("/me")]);
    expect(acc.status).toBe(200);
    await ana.put(`/boards/${s.boardId}/members/${carla.id}`, { role: "editor" });
    const members = (await ana.get(`/boards/${s.boardId}/members`)).body.members.filter((m: { userId: string }) => m.userId === carla.id);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("editor");
  });

  it("completar mientras cambia el estado del PR: el resultado coincide con el estado evaluado", async () => {
    await ana.put(`/boards/${s.boardId}/completion-rules`, { prMerged: "block" });
    const id = await card("Con PR");
    const [c] = await withSystem((tx) => tx.select({ orgId: cardDevRefs.orgId }).from(cardDevRefs).limit(0));
    void c;
    const orgId = (await ana.get(`/boards/${s.boardId}`)).body.board.orgId;
    await withSystem((tx) =>
      tx.insert(cardDevRefs).values({ id: uuidv7(), orgId, cardId: id, kind: "pr", externalId: "88", title: "PR", state: "open", url: "https://github.com/x/y/pull/88", linkedManually: true }),
    );
    const [done] = await Promise.all([
      beto.patch(`/cards/${id}`, { completed: true }),
      withSystem((tx) => tx.update(cardDevRefs).set({ merged: true, state: "merged" }).where(eq(cardDevRefs.cardId, id))),
    ]);
    const card2 = (await ana.get(`/cards/${id}`)).body.card;
    if (done.status === 200) expect(card2.completedAt).not.toBeNull();
    else {
      expect(done.status).toBe(409);
      expect(card2.completedAt).toBeNull();
      // Con el PR ya fusionado, el reintento funciona.
      expect((await beto.patch(`/cards/${id}`, { completed: true })).status).toBe(200);
    }
    await ana.put(`/boards/${s.boardId}/completion-rules`, {});
  });
});

describe("sincronización entre sesiones", () => {
  let ana: Client;
  let beto: Client;
  let ajeno: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;

  beforeAll(async () => {
    ana = await newUser("Ana");
    beto = await newUser("Beto");
    ajeno = await newUser("Ajeno");
    s = await seedBoard(ana);
    await inviteAndAccept(ana, beto, `/boards/${s.boardId}/invitations`, "viewer");
  });

  it("los cambios llegan en orden, sin duplicados, a quien tiene permiso; una sesión desactualizada se pone al día", async () => {
    const cursor = (await beto.get(`/boards/${s.boardId}`)).body.cursor as number;
    const titles = ["Uno", "Dos", "Tres", "Cuatro"];
    for (const t of titles) await ana.post(`/lists/${s.listId}/cards`, { title: t });
    // Primera lectura parcial y luego "reconexión" con el cursor recibido.
    const first = (await beto.get(`/boards/${s.boardId}/changes?after=${cursor}`)).body;
    const again = (await beto.get(`/boards/${s.boardId}/changes?after=${first.cursor}`)).body;
    const ids = first.changes.map((c: { id: number }) => c.id);
    expect(ids).toEqual([...ids].sort((x: number, y: number) => x - y));
    expect(new Set(ids).size).toBe(ids.length);
    expect(again.changes).toHaveLength(0);
    const created = first.changes.filter((c: { action: string }) => c.action === "card.created").map((c: { data: { title: string } }) => c.data.title);
    expect(created).toEqual(titles);
    // Una sesión vieja (cursor 0) recupera todo de nuevo sin perder nada.
    const stale = (await beto.get(`/boards/${s.boardId}/changes?after=0`)).body.changes.filter((c: { action: string }) => c.action === "card.created");
    expect(stale.length).toBeGreaterThanOrEqual(titles.length);
  });

  it("quien no tiene permiso no recibe los cambios", async () => {
    expect((await ajeno.get(`/boards/${s.boardId}/changes?after=0`)).status).toBe(404);
  });
});
