import { describe, expect, it } from "vitest";
import { plural } from "@/lib/plural";
import { overdueSeverity } from "@/server/modules/signals";

describe("riesgo por tareas vencidas", () => {
  it("pesa según la parte del trabajo abierto que ya está atrasada", () => {
    expect(overdueSeverity(6, 11)).toBe(3); // 55 % del trabajo abierto: alta
    expect(overdueSeverity(2, 15)).toBe(2); // 13 %: media
    expect(overdueSeverity(1, 40)).toBe(1); // 2,5 %: baja
    expect(overdueSeverity(3, 100)).toBe(2); // pocas en proporción, pero ya son varias
    expect(overdueSeverity(12, 200)).toBe(3); // muchas en número absoluto
  });
});

describe("plurales", () => {
  it("usa singular solo para 1", () => {
    expect(plural(1, "tarea vencida", "tareas vencidas")).toBe("1 tarea vencida");
    expect(plural(0, "tarea vencida", "tareas vencidas")).toBe("0 tareas vencidas");
    expect(plural(6, "tarea vencida", "tareas vencidas")).toBe("6 tareas vencidas");
  });
});
