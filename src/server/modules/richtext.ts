import { z } from "zod";
import { badRequest } from "../core/errors";

/**
 * Descripción enriquecida: se guarda como JSON de ProseMirror (TipTap), nunca como HTML.
 * Se valida contra una lista blanca de nodos y marcas; los links solo admiten http(s) y mailto.
 */
const NODE_TYPES = new Set([
  "doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "taskList", "taskItem",
  "blockquote", "codeBlock", "hardBreak", "horizontalRule",
]);
const MARK_TYPES = new Set(["bold", "italic", "strike", "code", "underline", "link"]);
const MAX_JSON_CHARS = 60_000;
const MAX_DEPTH = 12;

const SAFE_HREF = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;

type Node = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Mark[]; content?: Node[] };
type Mark = { type: string; attrs?: Record<string, unknown> };

function cleanMarks(marks: unknown): Mark[] | undefined {
  if (!Array.isArray(marks)) return undefined;
  const out: Mark[] = [];
  for (const m of marks) {
    if (!m || typeof m !== "object" || !MARK_TYPES.has((m as Mark).type)) throw badRequest("Formato de descripción no permitido");
    const mark = m as Mark;
    if (mark.type === "link") {
      const href = mark.attrs?.href;
      if (typeof href !== "string" || !SAFE_HREF.test(href)) throw badRequest("Solo se permiten enlaces http, https o mailto");
      out.push({ type: "link", attrs: { href } });
    } else {
      out.push({ type: mark.type });
    }
  }
  return out;
}

function cleanNode(node: unknown, depth: number): Node {
  if (depth > MAX_DEPTH) throw badRequest("La descripción está demasiado anidada");
  if (!node || typeof node !== "object") throw badRequest("Formato de descripción no permitido");
  const n = node as Node;
  if (!NODE_TYPES.has(n.type)) throw badRequest("Formato de descripción no permitido");
  const out: Node = { type: n.type };
  if (n.type === "text") {
    if (typeof n.text !== "string") throw badRequest("Formato de descripción no permitido");
    out.text = n.text;
  }
  if (n.type === "heading") {
    const level = Number(n.attrs?.level);
    out.attrs = { level: [1, 2, 3].includes(level) ? level : 2 };
  }
  if (n.type === "taskItem") out.attrs = { checked: n.attrs?.checked === true };
  if (n.type === "orderedList") {
    const start = Number(n.attrs?.start ?? 1);
    out.attrs = { start: Number.isInteger(start) && start > 0 && start < 10000 ? start : 1 };
  }
  const marks = cleanMarks(n.marks);
  if (marks?.length) out.marks = marks;
  if (Array.isArray(n.content)) out.content = n.content.map((c) => cleanNode(c, depth + 1));
  return out;
}

export const richTextInput = z.unknown().nullable();

export function sanitizeRichText(value: unknown): { json: Node | null; text: string } {
  if (value === null || value === undefined) return { json: null, text: "" };
  if (JSON.stringify(value).length > MAX_JSON_CHARS) throw badRequest("La descripción es demasiado larga");
  const json = cleanNode(value, 0);
  if (json.type !== "doc") throw badRequest("Formato de descripción no permitido");
  return { json, text: extractText(json).slice(0, 20_000) };
}

function extractText(node: Node): string {
  if (node.type === "text") return node.text ?? "";
  const parts = (node.content ?? []).map(extractText);
  return parts.join(node.type === "doc" || node.type.endsWith("List") ? "\n" : " ").trim();
}
