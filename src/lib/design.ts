import { Boxes, Database, FileText, GitBranch, ListChecks, Network, Route, Target, Users, Workflow, type LucideIcon } from "lucide-react";

export type DesignKind = "vision" | "requirements" | "use_cases" | "flow" | "sequence" | "data_model" | "architecture" | "plan" | "note";

export type DesignDoc = {
  id: string;
  kind: DesignKind;
  title: string;
  content: Record<string, unknown>;
  source: string;
  format: "mermaid" | "markdown";
  aiGenerated: boolean;
  updatedAt: string;
};

export type DesignProject = {
  project: { id: string; orgId: string; name: string; brief: string; workspaceId: string; workspaceName: string; boardId: string | null; createdBy: string | null; updatedAt: string };
  canEdit: boolean;
  docs: DesignDoc[];
  files: { id: string; fileName: string; mime: string; boardName: string }[];
};

export type DesignProjectSummary = {
  id: string;
  name: string;
  brief: string;
  workspaceId: string;
  workspaceName: string;
  boardId: string | null;
  canEdit: boolean;
  kinds: DesignKind[];
  updatedAt: string;
};

/** Qué es cada documento, cómo se llama y en qué orden conviene generarlo. */
export const KINDS: Record<DesignKind, { label: string; short: string; icon: LucideIcon; tone: string; help: string; step: string }> = {
  vision: { label: "Visión del producto", short: "Visión", icon: Target, tone: "text-violet-600 bg-violet-500/10 dark:text-violet-300", help: "Problema, objetivos, usuarios, alcance y métricas de éxito.", step: "Definiendo el problema y los objetivos…" },
  requirements: { label: "Requisitos", short: "Requisitos", icon: ListChecks, tone: "text-sky-600 bg-sky-500/10 dark:text-sky-300", help: "Funcionales con criterios de aceptación y no funcionales.", step: "Escribiendo requisitos y criterios de aceptación…" },
  use_cases: { label: "Casos de uso", short: "Casos de uso", icon: Users, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-300", help: "Actores, diagrama UML y especificación de cada caso.", step: "Identificando actores y casos de uso…" },
  data_model: { label: "Modelo de datos", short: "Datos", icon: Database, tone: "text-amber-600 bg-amber-500/10 dark:text-amber-300", help: "Entidades, atributos y relaciones (diagrama ER).", step: "Modelando entidades y relaciones…" },
  architecture: { label: "Arquitectura", short: "Arquitectura", icon: Boxes, tone: "text-rose-600 bg-rose-500/10 dark:text-rose-300", help: "Componentes, tecnologías y decisiones clave.", step: "Diseñando la arquitectura…" },
  flow: { label: "Diagrama de flujo", short: "Flujo", icon: Workflow, tone: "text-indigo-600 bg-indigo-500/10 dark:text-indigo-300", help: "El paso a paso de un proceso, con decisiones.", step: "Dibujando el flujo del proceso principal…" },
  sequence: { label: "Diagrama de secuencia", short: "Secuencia", icon: Network, tone: "text-teal-600 bg-teal-500/10 dark:text-teal-300", help: "Cómo se comunican las partes en un escenario.", step: "Trazando la secuencia entre componentes…" },
  plan: { label: "Plan de proyecto", short: "Plan", icon: Route, tone: "text-fuchsia-600 bg-fuchsia-500/10 dark:text-fuchsia-300", help: "Fases, hitos, tareas estimadas, equipo y riesgos.", step: "Armando fases, tareas y estimaciones…" },
  note: { label: "Nota", short: "Nota", icon: FileText, tone: "text-slate-600 bg-slate-500/10 dark:text-slate-300", help: "Documento libre.", step: "Escribiendo…" },
};

/** Orden recomendado para generar el diseño completo (cada paso usa los anteriores como contexto). */
export const PIPELINE: { kind: DesignKind; focus?: string }[] = [
  { kind: "vision" },
  { kind: "requirements" },
  { kind: "use_cases" },
  { kind: "data_model" },
  { kind: "architecture" },
  { kind: "flow", focus: "El proceso principal del sistema (el caso de uso más importante), de punta a punta." },
  { kind: "sequence", focus: "El escenario principal del caso de uso más importante, entre el usuario, el frontend, el backend y la base de datos." },
  { kind: "plan" },
];

export const GitIcon = GitBranch;

export type UseCases = {
  actors: { id: string; name: string; kind: "primary" | "secondary"; description: string }[];
  useCases: { id: string; code: string; name: string; actors: string[]; goal: string; preconditions: string[]; mainFlow: string[]; alternativeFlows: { name: string; steps: string[] }[]; postconditions: string[]; includes: string[]; extends: string[] }[];
};

export type Requirements = {
  functional: { code: string; title: string; description: string; priority: "must" | "should" | "could"; acceptance: string[] }[];
  nonFunctional: { code: string; category: string; description: string }[];
};

export type Plan = {
  summary: string;
  phases: { name: string; goal: string; weeks: number; milestone: string; tasks: { title: string; description: string; estimatePoints: number; priority: string; role: string }[] }[];
  team: { role: string; count: number }[];
  risks: { risk: string; impact: "bajo" | "medio" | "alto"; mitigation: string }[];
};

export type Architecture = { summary: string; decisions: { title: string; choice: string; reason: string }[] };
