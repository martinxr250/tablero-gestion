import { describe, expect, it } from "vitest";
import { parseCsv, parseDate, parsePasted, parseRows } from "@/lib/bulk-parse";

describe("carga masiva: interpretación", () => {
  it("lista pegada con subtareas por sangría y campos con barra", () => {
    const rows = parsePasted("Módulo de usuarios | Ana | alta | 15/11/2026 | 8\n  - Tabla de usuarios\n  - Roles\nDocumentación");
    expect(rows.map((r) => [r.title, r.isSubtask])).toEqual([
      ["Módulo de usuarios", false],
      ["Tabla de usuarios", true],
      ["Roles", true],
      ["Documentación", false],
    ]);
    expect(rows[0]).toMatchObject({ ownerName: "Ana", priority: "high", due: "2026-11-15", estimate: "8" });
  });

  it("tabla copiada desde Excel con encabezado en español", () => {
    const rows = parsePasted("Tarea\tResponsable\tPrioridad\tVencimiento\tPuntos\tEtiquetas\nLogin\tAna\tUrgente\t2026-12-01\t5\tBackend, Seguridad");
    expect(rows[0]).toMatchObject({ title: "Login", ownerName: "Ana", priority: "urgent", due: "2026-12-01", estimate: "5", labels: "Backend, Seguridad" });
  });

  it("CSV con punto y coma y comillas", () => {
    const rows = parseRows(parseCsv('Título;Descripción;Lista\n"Diseño; versión 2";"Dice ""hola""";En curso\n'));
    expect(rows[0]).toMatchObject({ title: "Diseño; versión 2", description: 'Dice "hola"', listName: "En curso" });
  });

  it("fechas de planilla", () => {
    expect(parseDate(new Date("2026-03-04T00:00:00Z"))).toBe("2026-03-04");
    expect(parseDate("4/3/26")).toBe("2026-03-04");
    expect(parseDate("mañana")).toBe("");
  });
});
