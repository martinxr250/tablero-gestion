import "server-only";
import { z } from "zod";
import type { DesignDocKind } from "../db/schema";

// Cada documento del estudio tiene una forma fija que pide la IA. Los diagramas se arman
// desde esa estructura (no se le pide a la IA que escriba Mermaid), así la sintaxis siempre es válida.

const id = z.string().describe("Identificador corto sin espacios, por ejemplo uc1 o pedido");

export const Schemas = {
  vision: z.object({ markdown: z.string() }),
  note: z.object({ markdown: z.string() }),
  requirements: z.object({
    functional: z.array(
      z.object({ code: z.string().describe("RF-01, RF-02…"), title: z.string(), description: z.string(), priority: z.enum(["must", "should", "could"]), acceptance: z.array(z.string()) }),
    ),
    nonFunctional: z.array(z.object({ code: z.string().describe("RNF-01…"), category: z.string().describe("Rendimiento, Seguridad, Usabilidad…"), description: z.string() })),
  }),
  use_cases: z.object({
    actors: z.array(z.object({ id, name: z.string(), kind: z.enum(["primary", "secondary"]), description: z.string() })),
    useCases: z.array(
      z.object({
        id,
        code: z.string().describe("CU-01…"),
        name: z.string().describe("Verbo en infinitivo + objeto, por ejemplo 'Registrar pedido'"),
        actors: z.array(z.string()).describe("ids de actores"),
        goal: z.string(),
        preconditions: z.array(z.string()),
        mainFlow: z.array(z.string()),
        alternativeFlows: z.array(z.object({ name: z.string(), steps: z.array(z.string()) })),
        postconditions: z.array(z.string()),
        includes: z.array(z.string()).describe("ids de casos de uso incluidos"),
        extends: z.array(z.string()).describe("ids de casos de uso que este extiende"),
      }),
    ),
  }),
  flow: z.object({
    title: z.string(),
    description: z.string(),
    nodes: z.array(z.object({ id, label: z.string(), type: z.enum(["start", "end", "process", "decision", "input", "subprocess"]) })),
    edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().describe("Vacío o la condición, por ejemplo 'Sí' / 'No'") })),
  }),
  sequence: z.object({
    title: z.string(),
    description: z.string(),
    participants: z.array(z.object({ id, name: z.string(), kind: z.enum(["actor", "participant", "database"]) })),
    messages: z.array(z.object({ from: z.string(), to: z.string(), text: z.string(), kind: z.enum(["sync", "async", "reply"]) })),
  }),
  data_model: z.object({
    entities: z.array(
      z.object({
        name: z.string().describe("Singular, sin espacios, por ejemplo Pedido"),
        description: z.string(),
        attributes: z.array(z.object({ name: z.string(), type: z.string().describe("string, int, decimal, date, datetime, bool, uuid…"), key: z.enum(["pk", "fk", "uk", "none"]) })),
      }),
    ),
    relations: z.array(z.object({ from: z.string(), to: z.string(), cardinality: z.enum(["1-1", "1-N", "N-N"]), label: z.string() })),
  }),
  architecture: z.object({
    summary: z.string().describe("Explicación breve de la arquitectura elegida y por qué"),
    groups: z.array(z.object({ id, name: z.string() })),
    components: z.array(
      z.object({ id, name: z.string(), type: z.enum(["client", "service", "database", "queue", "storage", "external"]), tech: z.string(), group: z.string().describe("id del grupo o vacío") }),
    ),
    connections: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })),
    decisions: z.array(z.object({ title: z.string(), choice: z.string(), reason: z.string() })),
  }),
  plan: z.object({
    summary: z.string(),
    phases: z.array(
      z.object({
        name: z.string().describe("Nombre corto de la fase, sin numerarla (por ejemplo 'Descubrimiento')"),
        goal: z.string(),
        weeks: z.number().int().describe("Duración en semanas (1 a 12)"),
        milestone: z.string().describe("Entregable al cerrar la fase"),
        tasks: z.array(
          z.object({
            title: z.string(),
            description: z.string(),
            estimatePoints: z.number().describe("Puntos de historia: 1, 2, 3, 5, 8 o 13"),
            priority: z.enum(["low", "medium", "high", "urgent"]),
            role: z.string().describe("Rol sugerido: Backend, Frontend, Diseño, QA…"),
          }),
        ),
      }),
    ),
    team: z.array(z.object({ role: z.string(), count: z.number().int() })),
    risks: z.array(z.object({ risk: z.string(), impact: z.enum(["bajo", "medio", "alto"]), mitigation: z.string() })),
  }),
} satisfies Record<DesignDocKind, z.ZodType>;

export type Content<K extends DesignDocKind> = z.infer<(typeof Schemas)[K]>;

export const KIND_INFO: Record<DesignDocKind, { title: string; brief: string }> = {
  vision: {
    title: "Visión del producto",
    brief:
      "Documento de visión en Markdown con secciones ## : Problema, Objetivos, Usuarios y necesidades, Alcance (incluye / no incluye), Métricas de éxito, Supuestos y restricciones. Concreto, sin relleno.",
  },
  requirements: { title: "Requisitos", brief: "Requisitos funcionales (con criterios de aceptación verificables, priorizados MoSCoW) y no funcionales. Entre 8 y 20 funcionales." },
  use_cases: {
    title: "Casos de uso",
    brief: "Actores y casos de uso UML con su especificación (precondiciones, flujo principal numerado, flujos alternativos, postcondiciones, include/extend). Entre 5 y 12 casos de uso.",
  },
  flow: { title: "Diagrama de flujo", brief: "Diagrama de flujo de un proceso: un inicio, al menos un fin, decisiones con salidas etiquetadas (Sí/No), entre 6 y 25 nodos con textos cortos (hasta 8 palabras)." },
  sequence: { title: "Diagrama de secuencia", brief: "Diagrama de secuencia de un escenario: participantes (actor, frontend, servicios, base de datos) y mensajes en orden, con respuestas." },
  data_model: { title: "Modelo de datos", brief: "Modelo entidad-relación: entidades con atributos tipados y claves, y relaciones con cardinalidad." },
  architecture: { title: "Arquitectura", brief: "Arquitectura del sistema: entre 6 y 12 componentes agrupados en 2 a 4 capas, tecnologías sugeridas y realistas, solo las conexiones principales (etiquetas de 2 a 4 palabras) y decisiones clave con su justificación." },
  plan: {
    title: "Plan de proyecto",
    brief: "Plan por fases (descubrimiento, MVP, iteraciones, lanzamiento) con objetivos, duración, hito y tareas estimadas en puntos. Equipo sugerido y riesgos con mitigación.",
  },
  note: { title: "Nota", brief: "Documento libre en Markdown." },
};

// ---------------------------------------------------------------------------------------------
// Estructura → texto (Markdown o Mermaid)

const sid = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "n$1").slice(0, 40) || "n";
const lbl = (s: string, max = 120) => {
  const t = s.replace(/[\r\n]+/g, " ").trim();
  return (t.length > max ? `${t.slice(0, max - 1)}…` : t).replace(/"/g, "#quot;");
};
const lines = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

function flowToMermaid(c: Content<"flow">) {
  const shape = (n: Content<"flow">["nodes"][number]) => {
    const t = `"${lbl(n.label)}"`;
    switch (n.type) {
      case "start":
      case "end":
        return `([${t}])`;
      case "decision":
        return `{${t}}`;
      case "input":
        return `[/${t}/]`;
      case "subprocess":
        return `[[${t}]]`;
      default:
        return `[${t}]`;
    }
  };
  const ids = new Set(c.nodes.map((n) => n.id));
  const out = ["flowchart TD"];
  for (const n of c.nodes) out.push(`  ${sid(n.id)}${shape(n)}`);
  for (const e of c.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    out.push(e.label.trim() ? `  ${sid(e.from)} -->|"${lbl(e.label, 36)}"| ${sid(e.to)}` : `  ${sid(e.from)} --> ${sid(e.to)}`);
  }
  const starts = c.nodes.filter((n) => n.type === "start" || n.type === "end").map((n) => sid(n.id));
  const decisions = c.nodes.filter((n) => n.type === "decision").map((n) => sid(n.id));
  out.push("  classDef term fill:#ede9fe,stroke:#7c3aed,color:#1e1b4b", "  classDef dec fill:#fef3c7,stroke:#d97706,color:#451a03");
  if (starts.length) out.push(`  class ${starts.join(",")} term`);
  if (decisions.length) out.push(`  class ${decisions.join(",")} dec`);
  return out.join("\n");
}

function sequenceToMermaid(c: Content<"sequence">) {
  const out = ["sequenceDiagram", "  autonumber"];
  for (const p of c.participants) out.push(`  ${p.kind === "actor" ? "actor" : p.kind === "database" ? "database" : "participant"} ${sid(p.id)} as ${lbl(p.name)}`);
  const ids = new Set(c.participants.map((p) => p.id));
  for (const m of c.messages) {
    if (!ids.has(m.from) || !ids.has(m.to)) continue;
    const arrow = m.kind === "reply" ? "-->>" : m.kind === "async" ? "-)" : "->>";
    out.push(`  ${sid(m.from)}${arrow}${sid(m.to)}: ${lbl(m.text).replace(/[;#]/g, ",")}`);
  }
  return out.join("\n");
}

function dataModelToMermaid(c: Content<"data_model">) {
  const out = ["erDiagram"];
  const names = new Set(c.entities.map((e) => e.name));
  const card = { "1-1": "||--||", "1-N": "||--o{", "N-N": "}o--o{" } as const;
  for (const r of c.relations) {
    if (!names.has(r.from) || !names.has(r.to)) continue;
    out.push(`  ${sid(r.from)} ${card[r.cardinality]} ${sid(r.to)} : "${lbl(r.label || "se relaciona")}"`);
  }
  for (const e of c.entities) {
    out.push(`  ${sid(e.name)} {`);
    for (const a of e.attributes) out.push(`    ${sid(a.type) || "string"} ${sid(a.name)}${a.key !== "none" ? ` ${a.key.toUpperCase()}` : ""}`);
    out.push("  }");
  }
  return out.join("\n");
}

function architectureToMermaid(c: Content<"architecture">) {
  const shape = (x: Content<"architecture">["components"][number]) => {
    const t = `"${lbl(x.name)}${x.tech ? `<br/>${lbl(x.tech)}` : ""}"`;
    return { client: `[${t}]`, service: `[${t}]`, database: `[(${t})]`, queue: `[/${t}/]`, storage: `[(${t})]`, external: `{{${t}}}` }[x.type];
  };
  // Capas de arriba hacia abajo y, dentro de cada capa, componentes uno al lado del otro: más legible
  // y menos ancho que un diagrama horizontal.
  const out = ["flowchart TB"];
  const groups = new Map(c.groups.map((g) => [g.id, g.name]));
  for (const g of c.groups) {
    const members = c.components.filter((x) => x.group === g.id);
    if (!members.length) continue;
    out.push(`  subgraph ${sid(`g_${g.id}`)}["${lbl(g.name)}"]`, "    direction LR");
    for (const x of members) out.push(`    ${sid(x.id)}${shape(x)}`);
    out.push("  end");
  }
  for (const x of c.components) if (!groups.has(x.group)) out.push(`  ${sid(x.id)}${shape(x)}`);
  const ids = new Set(c.components.map((x) => x.id));
  for (const e of c.connections) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    out.push(e.label.trim() ? `  ${sid(e.from)} -->|"${lbl(e.label, 36)}"| ${sid(e.to)}` : `  ${sid(e.from)} --> ${sid(e.to)}`);
  }
  const byType = (t: string) => c.components.filter((x) => x.type === t).map((x) => sid(x.id));
  out.push(
    "  classDef db fill:#e0f2fe,stroke:#0284c7,color:#082f49",
    "  classDef ext fill:#f1f5f9,stroke:#64748b,color:#0f172a,stroke-dasharray:4 3",
    "  classDef cli fill:#ede9fe,stroke:#7c3aed,color:#1e1b4b",
  );
  const dbs = [...byType("database"), ...byType("storage")];
  if (dbs.length) out.push(`  class ${dbs.join(",")} db`);
  if (byType("external").length) out.push(`  class ${byType("external").join(",")} ext`);
  if (byType("client").length) out.push(`  class ${byType("client").join(",")} cli`);
  return out.join("\n");
}

function requirementsToMarkdown(c: Content<"requirements">) {
  const pr = { must: "Imprescindible", should: "Importante", could: "Deseable" };
  const f = c.functional.map((r) => `### ${r.code} · ${r.title}\n${r.description}\n\n**Prioridad:** ${pr[r.priority]}\n\n**Criterios de aceptación**\n${lines(r.acceptance)}`);
  const nf = c.nonFunctional.map((r) => `- **${r.code} · ${r.category}:** ${r.description}`);
  return `## Requisitos funcionales\n\n${f.join("\n\n")}\n\n## Requisitos no funcionales\n\n${nf.join("\n")}`;
}

function casesToMarkdown(c: Content<"use_cases">) {
  const actor = new Map(c.actors.map((a) => [a.id, a.name]));
  const uc = new Map(c.useCases.map((u) => [u.id, `${u.code} ${u.name}`]));
  const acts = c.actors.map((a) => `- **${a.name}** (${a.kind === "primary" ? "principal" : "secundario"}): ${a.description}`).join("\n");
  const specs = c.useCases.map((u) => {
    const parts = [`### ${u.code} · ${u.name}`, `**Actores:** ${u.actors.map((a) => actor.get(a) ?? a).join(", ")}`, `**Objetivo:** ${u.goal}`];
    if (u.preconditions.length) parts.push(`**Precondiciones**\n${lines(u.preconditions)}`);
    parts.push(`**Flujo principal**\n${u.mainFlow.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    for (const a of u.alternativeFlows) parts.push(`**Alternativo: ${a.name}**\n${a.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
    if (u.postconditions.length) parts.push(`**Postcondiciones**\n${lines(u.postconditions)}`);
    const rel = [...u.includes.map((i) => `incluye ${uc.get(i) ?? i}`), ...u.extends.map((i) => `extiende ${uc.get(i) ?? i}`)];
    if (rel.length) parts.push(`**Relaciones:** ${rel.join(" · ")}`);
    return parts.join("\n\n");
  });
  return `## Actores\n\n${acts}\n\n## Especificación\n\n${specs.join("\n\n")}`;
}

function planToMarkdown(c: Content<"plan">) {
  let week = 0;
  const phases = c.phases.map((p, i) => {
    const from = week + 1;
    week += Math.max(1, p.weeks);
    const pts = p.tasks.reduce((s, t) => s + (t.estimatePoints || 0), 0);
    return `### Fase ${i + 1} · ${phaseName(p.name)} (semanas ${from}–${week}, ${pts} pts)\n${p.goal}\n\n**Hito:** ${p.milestone}\n\n${p.tasks.map((t) => `- **${t.title}** · ${t.role} · ${t.estimatePoints} pts — ${t.description}`).join("\n")}`;
  });
  const team = c.team.map((t) => `- ${t.count} × ${t.role}`).join("\n");
  const risks = c.risks.map((r) => `- **${r.risk}** (impacto ${r.impact}): ${r.mitigation}`).join("\n");
  return `${c.summary}\n\n## Fases\n\n${phases.join("\n\n")}\n\n## Equipo sugerido\n\n${team}\n\n## Riesgos\n\n${risks}`;
}

/** Nombre de fase sin numeración repetida ("Fase 1 – Descubrimiento" → "Descubrimiento"). */
export const phaseName = (name: string) => name.replace(/^\s*fase\s*\d+\s*[-–—:·.)]?\s*/i, "").trim() || name;

/** Texto editable del documento a partir de su estructura. */
export function toSource(kind: DesignDocKind, content: unknown): string {
  switch (kind) {
    case "vision":
    case "note":
      return (content as Content<"vision">).markdown;
    case "requirements":
      return requirementsToMarkdown(content as Content<"requirements">);
    case "use_cases":
      return casesToMarkdown(content as Content<"use_cases">);
    case "flow":
      return flowToMermaid(content as Content<"flow">);
    case "sequence":
      return sequenceToMermaid(content as Content<"sequence">);
    case "data_model":
      return dataModelToMermaid(content as Content<"data_model">);
    case "architecture":
      return architectureToMermaid(content as Content<"architecture">);
    case "plan":
      return planToMarkdown(content as Content<"plan">);
  }
}

/** Los documentos cuyo texto es Mermaid (se dibujan como diagrama). */
export const MERMAID_KINDS = new Set<DesignDocKind>(["flow", "sequence", "data_model", "architecture"]);

/** Resumen corto de un documento para dar contexto a la IA al generar los siguientes. */
export function digest(kind: DesignDocKind, title: string, content: Record<string, unknown>, source: string): string {
  const c = content as never;
  try {
    switch (kind) {
      case "requirements":
        return `${title}: ${(c as Content<"requirements">).functional.map((r) => `${r.code} ${r.title}`).join("; ")}`;
      case "use_cases": {
        const u = c as Content<"use_cases">;
        return `${title}: actores ${u.actors.map((a) => a.name).join(", ")}; casos ${u.useCases.map((x) => `${x.code} ${x.name}`).join("; ")}`;
      }
      case "data_model":
        return `${title}: entidades ${(c as Content<"data_model">).entities.map((e) => `${e.name}(${e.attributes.map((a) => a.name).join(",")})`).join("; ")}`;
      case "architecture":
        return `${title}: ${(c as Content<"architecture">).components.map((x) => `${x.name} [${x.tech}]`).join("; ")}`;
      case "plan":
        return `${title}: ${(c as Content<"plan">).phases.map((p) => p.name).join(" → ")}`;
      default:
        return `${title}: ${source.slice(0, 1500)}`;
    }
  } catch {
    return `${title}: ${source.slice(0, 800)}`;
  }
}
