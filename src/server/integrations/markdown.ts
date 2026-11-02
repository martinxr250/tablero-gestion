// Conversión acotada entre el texto enriquecido de las tarjetas (JSON de ProseMirror)
// y el Markdown de los issues. Cubre los formatos que permite el editor.
type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Mark[]; content?: Node[] };

function inlineToMd(nodes: Node[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type !== "text") return "";
      let t = n.text ?? "";
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      if (marks.has("code")) t = `\`${t}\``;
      if (marks.has("bold")) t = `**${t}**`;
      if (marks.has("italic")) t = `_${t}_`;
      if (marks.has("strike")) t = `~~${t}~~`;
      const link = n.marks?.find((m) => m.type === "link");
      if (link) t = `[${t}](${String(link.attrs?.href ?? "")})`;
      return t;
    })
    .join("");
}

function blockToMd(node: Node, indent = ""): string {
  switch (node.type) {
    case "paragraph":
      return indent + inlineToMd(node.content);
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 2))} ${inlineToMd(node.content)}`;
    case "bulletList":
    case "orderedList":
      return (node.content ?? [])
        .map((item, i) => {
          const bullet = node.type === "bulletList" ? "-" : `${i + 1}.`;
          const [first, ...rest] = item.content ?? [];
          const head = `${indent}${bullet} ${first ? blockToMd(first).trimStart() : ""}`;
          return [head, ...rest.map((r) => blockToMd(r, `${indent}  `))].join("\n");
        })
        .join("\n");
    case "blockquote":
      return (node.content ?? []).map((c) => `> ${blockToMd(c)}`).join("\n");
    case "codeBlock":
      return `\`\`\`\n${(node.content ?? []).map((c) => c.text ?? "").join("")}\n\`\`\``;
    case "horizontalRule":
      return "---";
    default:
      return inlineToMd(node.content);
  }
}

export function docToMarkdown(doc: unknown): string {
  const d = doc as Node | null;
  if (!d || d.type !== "doc") return "";
  return (d.content ?? []).map((n) => blockToMd(n)).join("\n\n").trim();
}

function parseInline(text: string): Node[] {
  const out: Node[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|_[^_]+_|\*[^*]+\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ type: "text", text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) out.push({ type: "text", text: tok.slice(2, -2), marks: [{ type: "bold" }] });
    else if (tok.startsWith("~~")) out.push({ type: "text", text: tok.slice(2, -2), marks: [{ type: "strike" }] });
    else if (tok.startsWith("`")) out.push({ type: "text", text: tok.slice(1, -1), marks: [{ type: "code" }] });
    else if (tok.startsWith("[")) {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      // Solo enlaces seguros; el resto queda como texto.
      if (/^(https?:\/\/|mailto:)/i.test(href!)) out.push({ type: "text", text: label!, marks: [{ type: "link", attrs: { href } }] });
      else out.push({ type: "text", text: label! });
    } else out.push({ type: "text", text: tok.slice(1, -1), marks: [{ type: "italic" }] });
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((n) => n.text);
}

const para = (text: string): Node => {
  const content = parseInline(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

export function markdownToDoc(md: string): Node | null {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push({ type: "codeBlock", content: code.length ? [{ type: "text", text: code.join("\n") }] : undefined });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", attrs: { level: Math.min(3, heading[1]!.length) }, content: parseInline(heading[2]!) });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    const listMatch = line.match(/^\s*([-*+]|\d+\.)\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]!);
      const items: Node[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)) {
        const text = lines[i]!.replace(/^\s*([-*+]|\d+\.)\s+/, "").replace(/^\[[ xX]\]\s+/, "");
        items.push({ type: "listItem", content: [para(text)] });
        i++;
      }
      blocks.push({ type: ordered ? "orderedList" : "bulletList", content: items });
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push({ type: "blockquote", content: [para(quote.join(" "))] });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i]!)) paragraph.push(lines[i++]!.trim());
    blocks.push(para(paragraph.join(" ")));
  }
  return blocks.length ? { type: "doc", content: blocks } : null;
}
