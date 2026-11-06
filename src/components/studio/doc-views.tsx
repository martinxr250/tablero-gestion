"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Flag, Lightbulb, Users } from "lucide-react";
import { useState } from "react";
import { AiMarkdown } from "@/components/ai/ai-markdown";
import { MermaidDiagram } from "@/components/studio/mermaid-diagram";
import { UseCaseDiagram } from "@/components/studio/use-case-diagram";
import type { Architecture, DesignDoc, Plan, Requirements, UseCases } from "@/lib/design";
import { cn } from "@/lib/utils";

const PRIORITY = { must: { label: "Imprescindible", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-300" }, should: { label: "Importante", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-300" }, could: { label: "Deseable", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-300" } };
const IMPACT = { alto: "bg-rose-500", medio: "bg-amber-500", bajo: "bg-emerald-500" };

const has = <T,>(c: Record<string, unknown>, key: string): c is Record<string, unknown> & T => Array.isArray(c[key]);

function RequirementsView({ data }: { data: Requirements }) {
  const [open, setOpen] = useState<string | null>(null);
  const counts = { must: 0, should: 0, could: 0 };
  data.functional.forEach((r) => counts[r.priority]++);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => (
          <span key={k} className={cn("rounded-full px-3 py-1 text-xs font-medium", PRIORITY[k].cls)}>
            {counts[k]} {PRIORITY[k].label.toLowerCase()}
          </span>
        ))}
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">{data.nonFunctional.length} no funcionales</span>
      </div>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Requisitos funcionales</h3>
        <ul className="divide-y rounded-2xl border">
          {data.functional.map((r) => {
            const isOpen = open === r.code;
            return (
              <li key={r.code}>
                <button className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.code)}>
                  <span className="mt-0.5 w-14 shrink-0 font-mono text-xs text-muted-foreground">{r.code}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{r.title}</span>
                    {!isOpen && <span className="line-clamp-1 text-xs text-muted-foreground">{r.description}</span>}
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", PRIORITY[r.priority].cls)}>{PRIORITY[r.priority].label}</span>
                  <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen && (
                  <div className="ai-reveal space-y-3 px-4 pb-4 pl-[4.75rem] text-sm">
                    <p className="leading-relaxed">{r.description}</p>
                    {r.acceptance.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Criterios de aceptación</p>
                        <ul className="space-y-1">
                          {r.acceptance.map((a, i) => (
                            <li key={i} className="flex gap-2">
                              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                              {a}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {data.nonFunctional.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">Requisitos no funcionales</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.nonFunctional.map((r) => (
              <div key={r.code} className="rounded-2xl border p-3.5">
                <p className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{r.code}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{r.category}</span>
                </p>
                <p className="mt-1.5 text-sm leading-relaxed">{r.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function UseCasesView({ data, title }: { data: UseCases; title: string }) {
  const [open, setOpen] = useState<string | null>(data.useCases[0]?.id ?? null);
  const actor = new Map(data.actors.map((a) => [a.id, a.name]));
  const uc = new Map(data.useCases.map((u) => [u.id, `${u.code} ${u.name}`]));
  return (
    <div className="space-y-6">
      <UseCaseDiagram data={data} title={title} />
      <section>
        <h3 className="mb-3 text-sm font-semibold">Actores</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.actors.map((a) => (
            <div key={a.id} className="flex gap-3 rounded-2xl border p-3.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted">
                <Users className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {a.name} <span className="text-xs font-normal text-muted-foreground">· {a.kind === "primary" ? "principal" : "secundario"}</span>
                </p>
                <p className="text-xs text-muted-foreground">{a.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Especificación</h3>
        <ul className="space-y-2">
          {data.useCases.map((u) => {
            const isOpen = open === u.id;
            return (
              <li key={u.id} className="rounded-2xl border">
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : u.id)}>
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">{u.code}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{u.name}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">{u.actors.map((a) => actor.get(a) ?? a).join(", ")}</span>
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen && (
                  <div className="ai-reveal grid gap-4 border-t px-4 py-4 text-sm md:grid-cols-[1fr_1.4fr]">
                    <div className="space-y-3">
                      <Field label="Objetivo">{u.goal}</Field>
                      {u.preconditions.length > 0 && <Field label="Precondiciones"><Bullets items={u.preconditions} /></Field>}
                      {u.postconditions.length > 0 && <Field label="Postcondiciones"><Bullets items={u.postconditions} /></Field>}
                      {(u.includes.length > 0 || u.extends.length > 0) && (
                        <Field label="Relaciones">
                          {[...u.includes.map((i) => `«include» ${uc.get(i) ?? i}`), ...u.extends.map((i) => `«extend» ${uc.get(i) ?? i}`)].join(" · ")}
                        </Field>
                      )}
                    </div>
                    <div className="space-y-3">
                      <Field label="Flujo principal">
                        <ol className="space-y-1.5">
                          {u.mainFlow.map((s, i) => (
                            <li key={i} className="flex gap-2.5">
                              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--ai-via)_14%,transparent)] text-[11px] font-semibold text-[var(--ai-via)]">{i + 1}</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ol>
                      </Field>
                      {u.alternativeFlows.map((a) => (
                        <Field key={a.name} label={`Alternativo: ${a.name}`}>
                          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground marker:text-xs">
                            {a.steps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                        </Field>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p>
    <div className="leading-relaxed">{children}</div>
  </div>
);
const Bullets = ({ items }: { items: string[] }) => (
  <ul className="space-y-1">
    {items.map((x, i) => (
      <li key={i} className="flex gap-2">
        <span className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
        {x}
      </li>
    ))}
  </ul>
);

const phaseName = (name: string) => name.replace(/^\s*fase\s*\d+\s*[-–—:·.)]?\s*/i, "").trim() || name;

const PHASE_COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-fuchsia-500", "bg-teal-500", "bg-indigo-500"];

export function PlanView({ data }: { data: Plan }) {
  const total = data.phases.reduce((s, p) => s + Math.max(1, p.weeks), 0);
  const points = data.phases.reduce((s, p) => s + p.tasks.reduce((t, x) => t + (x.estimatePoints || 0), 0), 0);
  const tasks = data.phases.reduce((s, p) => s + p.tasks.length, 0);
  const starts = data.phases.map((_, i) => data.phases.slice(0, i).reduce((s, p) => s + Math.max(1, p.weeks), 0));
  return (
    <div className="space-y-6">
      {data.summary && <p className="text-sm leading-relaxed">{data.summary}</p>}
      <div className="grid grid-cols-3 gap-2">
        {[
          [total, total === 1 ? "semana" : "semanas"],
          [tasks, "tareas"],
          [points, "puntos"],
        ].map(([n, l]) => (
          <div key={l} className="rounded-2xl border p-3.5">
            <p className="display-figure text-3xl">{n}</p>
            <p className="text-xs text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Cronograma</h3>
        <div className="space-y-2 rounded-2xl border p-4">
          {data.phases.map((p, i) => {
            const from = starts[i]!;
            const to = from + Math.max(1, p.weeks);
            return (
              <div key={i} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-xs">
                <span className="truncate font-medium" title={phaseName(p.name)}>
                  {phaseName(p.name)}
                </span>
                <div className="relative h-6 rounded-lg bg-muted/60">
                  <div
                    className={cn("absolute inset-y-0 flex items-center rounded-lg px-2 text-[11px] font-medium text-white", PHASE_COLORS[i % PHASE_COLORS.length])}
                    style={{ left: `${(from / total) * 100}%`, width: `${(Math.max(1, p.weeks) / total) * 100}%` }}
                    title={`Semanas ${from + 1}–${to}`}
                  >
                    <span className="truncate">{p.weeks} sem</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Fases</h3>
        {data.phases.map((p, i) => (
          <PhaseCard key={i} phase={p} index={i} />
        ))}
      </section>
      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <section>
          <h3 className="mb-3 text-sm font-semibold">Equipo sugerido</h3>
          <ul className="space-y-1.5 rounded-2xl border p-4 text-sm">
            {data.team.map((t) => (
              <li key={t.role} className="flex items-center justify-between gap-2">
                <span>{t.role}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">× {t.count}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold">Riesgos</h3>
          <ul className="space-y-2">
            {data.risks.map((r, i) => (
              <li key={i} className="flex gap-3 rounded-2xl border p-3.5 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.risk} <span className="ml-1 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground"><span className={cn("size-1.5 rounded-full", IMPACT[r.impact] ?? "bg-muted-foreground")} /> impacto {r.impact}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.mitigation}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function PhaseCard({ phase, index }: { phase: Plan["phases"][number]; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const pts = phase.tasks.reduce((s, t) => s + (t.estimatePoints || 0), 0);
  return (
    <div className="rounded-2xl border">
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={cn("size-2.5 shrink-0 rounded-full", PHASE_COLORS[index % PHASE_COLORS.length])} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Fase {index + 1} · {phaseName(phase.name)}
          </span>
          <span className="block text-xs text-muted-foreground">
            {phase.weeks} sem · {phase.tasks.length} tareas · {pts} pts
          </span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ai-reveal space-y-3 border-t px-4 py-4">
          <p className="text-sm">{phase.goal}</p>
          <p className="flex items-center gap-2 text-sm">
            <Flag className="size-4 text-[var(--ai-via)]" /> <span className="font-medium">Hito:</span> {phase.milestone}
          </p>
          <ul className="divide-y rounded-xl border text-sm">
            {phase.tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px]">{t.role}</span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{t.estimatePoints} pts</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ArchitectureExtras({ data }: { data: Architecture }) {
  return (
    <div className="space-y-4">
      {data.summary && <p className="text-sm leading-relaxed">{data.summary}</p>}
      {data.decisions?.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">Decisiones de arquitectura</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.decisions.map((d) => (
              <div key={d.title} className="rounded-2xl border p-3.5 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <Lightbulb className="size-4 text-amber-500" /> {d.title}
                </p>
                <p className="mt-1">{d.choice}</p>
                <p className="mt-1 text-xs text-muted-foreground">{d.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Muestra un documento según su tipo; si fue editado como texto libre, muestra el Markdown. */
export function DocBody({ doc }: { doc: DesignDoc }) {
  const c = doc.content;
  if (doc.format === "mermaid") {
    const desc = (c.description as string | undefined) ?? undefined;
    return (
      <div className="space-y-4">
        {desc && doc.kind !== "architecture" && <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>}
        {doc.kind === "architecture" && typeof c.summary === "string" && <p className="text-sm leading-relaxed">{c.summary}</p>}
        <MermaidDiagram source={doc.source} title={doc.title} />
        {doc.kind === "architecture" && has<Architecture>(c, "decisions") && <ArchitectureExtras data={{ ...(c as unknown as Architecture), summary: "" }} />}
      </div>
    );
  }
  if (doc.kind === "requirements" && has<Requirements>(c, "functional")) return <RequirementsView data={c as unknown as Requirements} />;
  if (doc.kind === "use_cases" && has<UseCases>(c, "useCases")) return <UseCasesView data={c as unknown as UseCases} title={doc.title} />;
  if (doc.kind === "plan" && has<Plan>(c, "phases")) return <PlanView data={c as unknown as Plan} />;
  return doc.source.trim() ? <AiMarkdown text={doc.source} variant="doc" /> : <p className="text-sm text-muted-foreground">Documento vacío.</p>;
}
