import { beforeAll, describe, expect, it } from "vitest";
import { Client, inviteAndAccept, newUser, seedBoard } from "../helpers";

describe("campos personalizados", () => {
  let admin: Client;
  let viewer: Client;
  let s: Awaited<ReturnType<typeof seedBoard>>;
  const ids: Record<string, string> = {};
  const board = async () => (await admin.get(`/boards/${s.boardId}`)).body;

  beforeAll(async () => {
    admin = await newUser("Admin");
    viewer = await newUser("Lectora");
    s = await seedBoard(admin);
    await inviteAndAccept(admin, viewer, `/boards/${s.boardId}/invitations`, "viewer");
  });

  it("crea campos de cada tipo y los devuelve con el tablero", async () => {
    for (const [name, type, config] of [
      ["Cliente", "text", undefined],
      ["Presupuesto", "currency", { currency: "usd" }],
      ["Horas", "number", undefined],
      ["Entrega", "date", undefined],
      ["Facturado", "checkbox", undefined],
      ["Versión", "select", { options: [{ name: "1.0", color: "green" }, { name: "2.0", color: "sky" }] }],
    ] as const) {
      const r = await admin.post(`/boards/${s.boardId}/fields`, { name, type, config });
      expect(r.status).toBe(201);
      ids[name] = r.body.id;
    }
    const fields = (await board()).fields;
    expect(fields.map((f: { name: string }) => f.name)).toEqual(["Cliente", "Presupuesto", "Horas", "Entrega", "Facturado", "Versión"]);
    expect(fields[1].config.currency).toBe("USD");
    expect(fields[5].config.options).toHaveLength(2);
    expect((await admin.post(`/boards/${s.boardId}/fields`, { name: "Cliente", type: "text" })).status).toBe(409);
    expect((await admin.post(`/boards/${s.boardId}/fields`, { name: "Vacía", type: "select", config: { options: [] } })).status).toBe(400);
  });

  it("valida el valor según el tipo y lo muestra en la tarjeta", async () => {
    const put = (field: string, value: unknown) => admin.put(`/cards/${s.cardId}/fields/${ids[field]}`, { value });
    expect((await put("Cliente", "ACME")).status).toBe(200);
    expect((await put("Presupuesto", "1500,50")).body.value).toBe(1500.5);
    expect((await put("Horas", "muchas")).status).toBe(400);
    expect((await put("Entrega", "31/12/2026")).status).toBe(400);
    expect((await put("Entrega", "2026-12-31")).status).toBe(200);
    expect((await put("Facturado", true)).status).toBe(200);
    const version = (await board()).fields[5].config.options[1].id;
    expect((await put("Versión", "opcion-inventada")).status).toBe(400);
    expect((await put("Versión", version)).status).toBe(200);

    const card = (await board()).cards.find((c: { id: string }) => c.id === s.cardId);
    expect(card.fieldValues).toMatchObject({ [ids.Cliente!]: "ACME", [ids.Presupuesto!]: 1500.5, [ids.Facturado!]: true, [ids.Versión!]: version });
    const detail = (await admin.get(`/cards/${s.cardId}`)).body.card;
    expect(detail.fieldValues[ids.Entrega!]).toBe("2026-12-31");

    expect((await put("Cliente", null)).status).toBe(200);
    expect((await board()).cards.find((c: { id: string }) => c.id === s.cardId).fieldValues[ids.Cliente!]).toBeUndefined();
  });

  it("quien solo puede ver no crea campos ni carga valores", async () => {
    expect((await viewer.post(`/boards/${s.boardId}/fields`, { name: "X", type: "text" })).status).toBe(403);
    expect((await viewer.put(`/cards/${s.cardId}/fields/${ids.Horas}`, { value: 3 })).status).toBe(403);
  });

  it("no acepta un campo de otro tablero", async () => {
    const other = await seedBoard(admin);
    const f = (await admin.post(`/boards/${other.boardId}/fields`, { name: "Ajeno", type: "text" })).body.id;
    expect((await admin.put(`/cards/${s.cardId}/fields/${f}`, { value: "x" })).status).toBe(404);
    const stranger = await newUser("Extraña");
    expect((await stranger.patch(`/fields/${ids.Cliente}`, { name: "Hackeado" })).status).toBe(404);
  });

  it("quitar una opción vacía los valores que la usaban", async () => {
    const field = (await board()).fields[5];
    await admin.patch(`/fields/${ids.Versión}`, { config: { options: [field.config.options[0]] } });
    const card = (await board()).cards.find((c: { id: string }) => c.id === s.cardId);
    expect(card.fieldValues[ids.Versión!]).toBeUndefined();
  });

  it("se copian al duplicar, en la planilla y al duplicar el tablero", async () => {
    const dup = await admin.post(`/cards/${s.cardId}/duplicate`);
    const copy = (await board()).cards.find((c: { id: string }) => c.id === dup.body.id);
    expect(copy.fieldValues[ids.Presupuesto!]).toBe(1500.5);

    const csv = (await admin.get(`/boards/${s.boardId}/export`)).text;
    expect(csv).toContain("Presupuesto");
    expect(csv).toContain("USD 1500.5");

    const nb = await admin.post(`/boards/${s.boardId}/duplicate`, { name: "Copia", includeCards: true });
    const copied = (await admin.get(`/boards/${nb.body.id}`)).body;
    expect(copied.fields.map((f: { name: string }) => f.name)).toContain("Presupuesto");
    const pres = copied.fields.find((f: { name: string }) => f.name === "Presupuesto").id;
    expect(copied.cards.some((c: { fieldValues: Record<string, unknown> }) => c.fieldValues[pres] === 1500.5)).toBe(true);
  });

  it("eliminar un campo borra sus valores", async () => {
    expect((await admin.del(`/fields/${ids.Horas}`)).status).toBe(200);
    expect((await board()).fields.map((f: { name: string }) => f.name)).not.toContain("Horas");
  });
});
