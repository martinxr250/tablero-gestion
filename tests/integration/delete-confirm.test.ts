import { describe, expect, it } from "vitest";
import { newUser, seedBoard } from "../helpers";

// Los borrados definitivos piden confirmación en el cuerpo del DELETE.
describe("borrados con confirmación", () => {
  it("tablero: exige el nombre exacto y luego lo borra", async () => {
    const u = await newUser("Dueña");
    const s = await seedBoard(u);
    expect((await u.del(`/boards/${s.boardId}`, { confirmName: "Otro nombre" })).status).toBe(400);
    expect((await u.get(`/boards/${s.boardId}`)).status).toBe(200);
    expect((await u.del(`/boards/${s.boardId}`, { confirmName: "Tablero" })).status).toBe(204);
    expect((await u.get(`/boards/${s.boardId}`)).status).toBe(404);
  });

  it("espacio de trabajo: exige el nombre exacto", async () => {
    const u = await newUser("Dueño");
    const s = await seedBoard(u);
    const ws = (await u.post(`/orgs/${s.orgId}/workspaces`, { name: "Para borrar" })).body;
    expect((await u.del(`/workspaces/${ws.id}`, { confirmName: "otro" })).status).toBe(400);
    expect((await u.del(`/workspaces/${ws.id}`, { confirmName: "Para borrar" })).status).toBe(204);
  });
});
