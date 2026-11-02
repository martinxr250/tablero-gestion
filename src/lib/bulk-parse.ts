// Interpretación de listas pegadas, CSV y planillas para la carga masiva de tareas.
// Todo ocurre en el navegador; el servidor vuelve a validar cada fila antes de crear.

export type Cell = string | number | boolean | Date | null | undefined;

export type DraftRow = {
  title: string;
  description: string;
  listName: string;
  ownerName: string;
  priority: "none" | "low" | "medium" | "high" | "urgent";
  due: string; // yyyy-mm-dd
  estimate: string;
  labels: string;
  parentTitle: string;
  sprintName: string;
  /** Subtarea de la fila anterior de primer nivel (listas pegadas con sangría o viñeta). */
  isSubtask: boolean;
};

const empty = (): DraftRow => ({
  title: "", description: "", listName: "", ownerName: "", priority: "none", due: "", estimate: "", labels: "", parentTitle: "", sprintName: "", isSubtask: false,
});

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const COLUMNS: Record<string, keyof DraftRow> = {};
for (const [field, names] of Object.entries({
  title: ["titulo", "tarea", "title", "nombre", "task", "resumen"],
  description: ["descripcion", "detalle", "description", "notas"],
  listName: ["lista", "columna", "estado", "list", "status"],
  ownerName: ["responsable", "asignado", "owner", "assignee", "persona"],
  priority: ["prioridad", "priority"],
  due: ["vencimiento", "fecha", "vence", "due", "fecha limite", "entrega"],
  estimate: ["estimacion", "puntos", "points", "estimate", "pts"],
  labels: ["etiquetas", "labels", "tags", "etiqueta"],
  parentTitle: ["padre", "tarea principal", "parent", "epica"],
  sprintName: ["etapa", "sprint", "iteracion"],
} as Record<keyof DraftRow, string[]>)) {
  for (const n of names) COLUMNS[n] = field as keyof DraftRow;
}

export function parsePriority(v: string): DraftRow["priority"] {
  const s = norm(v);
  if (/^(urgente|urgent|critica|critical|p0)$/.test(s)) return "urgent";
  if (/^(alta|high|p1)$/.test(s)) return "high";
  if (/^(media|medium|normal|p2)$/.test(s)) return "medium";
  if (/^(baja|low|p3)$/.test(s)) return "low";
  return "none";
}

/** Acepta fechas de planilla, "aaaa-mm-dd" y "dd/mm/aaaa". Devuelve "" si no se reconoce. */
export function parseDate(v: Cell): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  }
  return "";
}

function fromTable(rows: Cell[][]): DraftRow[] {
  const nonEmpty = rows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0]!.map((c) => COLUMNS[norm(String(c ?? ""))]);
  const hasHeader = header.some(Boolean);
  // Sin encabezado reconocible: título, responsable, prioridad, vencimiento, puntos, etiquetas.
  const fields: (keyof DraftRow | undefined)[] = hasHeader ? header : ["title", "ownerName", "priority", "due", "estimate", "labels", "description"];
  return (hasHeader ? nonEmpty.slice(1) : nonEmpty)
    .map((r) => {
      const row = empty();
      fields.forEach((f, i) => {
        const cell = r[i];
        if (!f || cell === null || cell === undefined) return;
        if (f === "due") row.due = parseDate(cell);
        else if (f === "priority") row.priority = parsePriority(String(cell));
        else if (f === "isSubtask") return;
        else (row[f] as string) = String(cell).trim();
      });
      return row;
    })
    .filter((r) => r.title);
}

/** CSV con comillas, separado por coma o punto y coma (detectado en la primera línea). */
export function parseCsv(text: string): Cell[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Texto pegado: una tarea por línea; con tabulaciones se trata como tabla (copiado desde Excel). */
export function parsePasted(text: string): DraftRow[] {
  const clean = text.replace(/^﻿/, "");
  if (clean.split(/\r?\n/).some((l) => l.includes("\t"))) return fromTable(clean.split(/\r?\n/).map((l) => l.split("\t")));
  const out: DraftRow[] = [];
  for (const raw of clean.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indented = /^(\s{2,}|\t)/.test(raw);
    const text = raw.replace(/^\s*([-*•·]|\d+[.)])?\s*/, "").trim();
    if (!text) continue;
    // "Título | responsable | prioridad | vencimiento | puntos" también se acepta en una línea.
    const parts = text.split("|").map((p) => p.trim());
    const row = { ...empty(), title: parts[0]!.slice(0, 200) };
    if (parts[1]) row.ownerName = parts[1];
    if (parts[2]) row.priority = parsePriority(parts[2]);
    if (parts[3]) row.due = parseDate(parts[3]);
    if (parts[4]) row.estimate = parts[4].replace(/[^\d.,]/g, "").replace(",", ".");
    // Con sangría (y opcionalmente viñeta) es subtarea de la última tarea de primer nivel.
    row.isSubtask = indented && out.some((r) => !r.isSubtask);
    out.push(row);
  }
  return out;
}

export function parseRows(rows: Cell[][]): DraftRow[] {
  return fromTable(rows);
}
