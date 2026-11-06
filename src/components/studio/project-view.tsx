"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, FileCode2, KanbanSquare, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Sparkles, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AiError, AiMark, AiNote, AiThinking } from "@/components/ai/ai-kit";
import { DocBody } from "@/components/studio/doc-views";
import { MermaidDiagram } from "@/components/studio/mermaid-diagram";
import { Dialog, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Button, ErrorState, Field, Input, Skeleton, Textarea } from "@/components/ui/primitives";
import { useAiEnabled } from "@/lib/ai";
import { api } from "@/lib/api";
import { KINDS, PIPELINE, type DesignDoc, type DesignKind, type DesignProject } from "@/lib/design";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

type Step = { kind: DesignKind; focus?: string; status: "waiting" | "running" | "done" | "error"; error?: unknown };

export function ProjectView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  const key = ["design-project", projectId];
  const q = useQuery({ queryKey: key, queryFn: () => api<DesignProject>(`/design-projects/${projectId}`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const cancel = useRef(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [newDoc, setNewDoc] = useState<"note" | "flow" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const data = q.data;
  const docs = data?.docs ?? [];
  const current = docs.find((d) => d.id === selected) ?? docs[0] ?? null;

  const generateOne = useMutation({
    mutationFn: (v: { kind: DesignKind; focus?: string; fileIds?: string[] }) => api<DesignDoc>(`/design-projects/${projectId}/ai/generate`, { method: "POST", body: v }),
    onSuccess: (d) => {
      setSelected(d.id);
      toast.success(`${KINDS[d.kind].label} listo`);
    },
    onSettled: refresh,
  });

  /** Genera el diseño completo paso a paso; cada documento usa los anteriores como contexto. */
  const runPipeline = async (fileIds: string[]) => {
    cancel.current = false;
    const plan: Step[] = PIPELINE.filter((p) => p.kind === "flow" || p.kind === "sequence" || !docs.some((d) => d.kind === p.kind)).map((p) => ({ ...p, status: "waiting" }));
    if (!plan.length) return;
    setSteps(plan);
    for (let i = 0; i < plan.length; i++) {
      if (cancel.current) break;
      setSteps((s) => s && s.map((x, j) => (j === i ? { ...x, status: "running" } : x)));
      try {
        const d = await api<DesignDoc>(`/design-projects/${projectId}/ai/generate`, { method: "POST", body: { kind: plan[i]!.kind, focus: plan[i]!.focus, fileIds: i < 2 ? fileIds : undefined } });
        setSteps((s) => s && s.map((x, j) => (j === i ? { ...x, status: "done" } : x)));
        if (i === 0) setSelected(d.id);
        await refresh();
      } catch (error) {
        setSteps((s) => s && s.map((x, j) => (j === i ? { ...x, status: "error", error } : x)));
        break;
      }
    }
  };
  const running = !!steps?.some((s) => s.status === "running");

  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!data) return <Skeleton className="h-96" />;
  const { project, canEdit } = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <Link href="/studio" className="mt-1.5 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Volver al Estudio">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            Estudio · {project.workspaceName}
            {project.createdBy && ` · creado por ${project.createdBy}`}
          </p>
          <h1 className="display-title truncate text-3xl sm:text-4xl">{project.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {project.boardId && (
            <Button variant="secondary" size="sm" onClick={() => router.push(`/b/${project.boardId}`)}>
              <KanbanSquare /> Ver tablero
            </Button>
          )}
          <a href={`/api/v1/design-projects/${projectId}/export`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted">
            <Download className="size-4" /> Exportar
          </a>
          {canEdit && <ProjectMenu project={project} onDeleted={() => router.push("/studio")} refresh={refresh} />}
        </div>
      </div>

      {steps && <PipelineProgress steps={steps} onClose={() => setSteps(null)} onCancel={() => (cancel.current = true)} running={running} />}

      {docs.length === 0 && !steps ? (
        <Kickoff data={data} aiEnabled={aiEnabled} onRun={runPipeline} onOne={(kind, fileIds) => generateOne.mutate({ kind, fileIds })} pending={generateOne.isPending} error={generateOne.error} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
          <nav className="lg:sticky lg:top-4 lg:self-start" aria-label="Documentos del proyecto">
            <ul className="flex gap-1 overflow-x-auto pb-2 scroll-thin lg:flex-col lg:overflow-visible lg:pb-0">
              {docs.map((d) => {
                const K = KINDS[d.kind];
                return (
                  <li key={d.id} className="shrink-0">
                    <button
                      onClick={() => setSelected(d.id)}
                      className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors", current?.id === d.id ? "bg-card font-medium shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
                    >
                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-3.5", K.tone)}>
                        <K.icon />
                      </span>
                      <span className="max-w-40 truncate lg:max-w-none">{d.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {canEdit && (
              <div className="mt-3 hidden space-y-2 lg:block">
                <AddMenu docs={docs} aiEnabled={aiEnabled} busy={running || generateOne.isPending} onGenerate={(kind, focus) => generateOne.mutate({ kind, focus })} onManual={setNewDoc} onRunAll={() => runPipeline([])} />
              </div>
            )}
          </nav>
          <div className="min-w-0">
            {canEdit && (
              <div className="mb-3 lg:hidden">
                <AddMenu docs={docs} aiEnabled={aiEnabled} busy={running || generateOne.isPending} onGenerate={(kind, focus) => generateOne.mutate({ kind, focus })} onManual={setNewDoc} onRunAll={() => runPipeline([])} />
              </div>
            )}
            {generateOne.isPending && (
              <div className="ai-surface mb-4 rounded-3xl p-5">
                <AiThinking steps={[KINDS[generateOne.variables!.kind].step, "Revisando la coherencia con los otros documentos…", "Ya casi…"]} lines={3} />
              </div>
            )}
            {generateOne.error && !generateOne.isPending && <AiError className="mb-4" error={generateOne.error} retry={() => generateOne.mutate(generateOne.variables!)} />}
            {current && <DocPanel key={current.id} doc={current} canEdit={canEdit} aiEnabled={aiEnabled} projectId={projectId} refresh={refresh} onApplyPlan={() => setApplyOpen(true)} hasBoard={!!project.boardId} />}
          </div>
        </div>
      )}

      {applyOpen && current?.kind === "plan" && <ApplyPlanDialog projectId={projectId} doc={current} defaultName={project.name} boardId={project.boardId} onClose={() => setApplyOpen(false)} onDone={(boardId) => router.push(`/b/${boardId}`)} />}
      {newDoc && <NewDocDialog projectId={projectId} kind={newDoc} onClose={() => setNewDoc(null)} onCreated={(id) => { setSelected(id); refresh(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Kickoff({ data, aiEnabled, onRun, onOne, pending, error }: { data: DesignProject; aiEnabled: boolean; onRun: (fileIds: string[]) => void; onOne: (k: DesignKind, fileIds: string[]) => void; pending: boolean; error: unknown }) {
  const [files, setFiles] = useState<Set<string>>(new Set());
  if (!data.canEdit) return <p className="rounded-3xl border border-dashed p-10 text-center text-sm text-muted-foreground">Este proyecto todavía no tiene documentos.</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <section className="ai-surface rounded-[2rem] p-6 sm:p-8">
        <AiMark size="lg" />
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">
          Diseñá el sistema <span className="ai-text">con IA</span>
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          A partir de la idea, nuestra IA arma la documentación completa en orden: visión, requisitos, casos de uso, modelo de datos, arquitectura, flujos y plan de proyecto. Cada documento usa los anteriores, así todo queda coherente. Después podés editar, pedir cambios y convertir el plan en un tablero.
        </p>
        <div className="mt-5 rounded-2xl bg-background/70 p-4">
          <p className="text-xs font-semibold text-muted-foreground">La idea</p>
          <p className="mt-1 line-clamp-6 text-sm whitespace-pre-line">{data.project.brief || "Sin descripción: agregala desde el menú ⋯ para mejores resultados."}</p>
        </div>
        {data.files.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Documentos de referencia (opcional, hasta 3)</p>
            <div className="flex flex-wrap gap-1.5">
              {data.files.slice(0, 12).map((f) => {
                const on = files.has(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => setFiles((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else if (n.size < 3) n.add(f.id); return n; })}
                    className={cn("inline-flex max-w-64 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "ai-soft border-[color-mix(in_oklch,var(--ai-via)_45%,var(--border))]" : "bg-background hover:bg-muted")}
                    title={`${f.fileName} · ${f.boardName}`}
                  >
                    {on ? <Check className="size-3" /> : <FileCode2 className="size-3" />}
                    <span className="truncate">{f.fileName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {aiEnabled ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button className="ai-cta" size="lg" onClick={() => onRun([...files])} disabled={pending}>
              <Wand2 /> Generar el diseño completo
            </Button>
            <span className="text-xs text-muted-foreground">8 documentos · unos minutos</span>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">La IA no está configurada: podés crear documentos a mano.</p>
        )}
        {error ? <AiError className="mt-4" error={error} /> : null}
      </section>
      <section>
        <p className="mb-3 text-sm font-semibold">O de a un documento</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {PIPELINE.map((p) => {
            const K = KINDS[p.kind];
            return (
              <button key={p.kind} disabled={!aiEnabled || pending} onClick={() => onOne(p.kind, [...files])} className="group flex items-start gap-3 rounded-2xl border bg-card p-3.5 text-left transition-colors hover:border-[color-mix(in_oklch,var(--ai-via)_45%,var(--border))] disabled:opacity-60">
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4", K.tone)}>
                  <K.icon />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{K.label}</span>
                  <span className="block text-xs text-muted-foreground">{K.help}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PipelineProgress({ steps, running, onClose, onCancel }: { steps: Step[]; running: boolean; onClose: () => void; onCancel: () => void }) {
  const done = steps.filter((s) => s.status === "done").length;
  const failed = steps.find((s) => s.status === "error");
  const current = steps.find((s) => s.status === "running");
  return (
    <section className="ai-surface mb-6 rounded-3xl p-5" aria-label="Progreso de la generación">
      <div className="flex flex-wrap items-center gap-3">
        <AiMark pulse={running} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{running ? "Generando el diseño…" : failed ? "La generación se detuvo" : "Diseño generado"}</p>
          <p className={cn("text-xs", running ? "ai-shimmer" : "text-muted-foreground")}>{current ? KINDS[current.kind].step : `${done} de ${steps.length} documentos`}</p>
        </div>
        {running ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Detener después de este
          </Button>
        ) : (
          <Button size="icon-sm" variant="ghost" aria-label="Cerrar" onClick={onClose}>
            <X />
          </Button>
        )}
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="ai-mark h-full rounded-full transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-4 flex flex-wrap gap-1.5">
        {steps.map((s, i) => {
          const K = KINDS[s.kind];
          return (
            <li key={i} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", s.status === "done" && "border-success/30 text-success", s.status === "running" && "ai-soft border-[color-mix(in_oklch,var(--ai-via)_45%,var(--border))]", s.status === "waiting" && "text-muted-foreground", s.status === "error" && "border-destructive/40 text-destructive")}>
              {s.status === "done" ? <Check className="size-3" /> : <K.icon className={cn("size-3", s.status === "running" && "ai-pulse")} />}
              {K.short}
            </li>
          );
        })}
      </ol>
      {failed?.error ? <AiError className="mt-4" error={failed.error} /> : null}
    </section>
  );
}

function AddMenu({ docs, aiEnabled, busy, onGenerate, onManual, onRunAll }: { docs: DesignDoc[]; aiEnabled: boolean; busy: boolean; onGenerate: (k: DesignKind, focus?: string) => void; onManual: (k: "note" | "flow") => void; onRunAll: () => void }) {
  const [focusFor, setFocusFor] = useState<DesignKind | null>(null);
  const [focus, setFocus] = useState("");
  const missing = PIPELINE.filter((p) => p.kind !== "flow" && p.kind !== "sequence" && !docs.some((d) => d.kind === p.kind));
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="secondary" size="sm" className="ai-ghost w-full justify-start" disabled={busy}>
            <Plus /> Agregar documento
          </Button>
        </MenuTrigger>
        <MenuContent align="start" className="w-64">
          {aiEnabled && (
            <>
              <MenuLabel>Generar con IA</MenuLabel>
              {missing.length > 1 && (
                <MenuItem onSelect={onRunAll}>
                  <Wand2 /> Completar lo que falta ({missing.length})
                </MenuItem>
              )}
              {(Object.keys(KINDS) as DesignKind[])
                .filter((k) => k !== "note")
                .map((k) => {
                  const K = KINDS[k];
                  const exists = docs.some((d) => d.kind === k) && k !== "flow" && k !== "sequence";
                  return (
                    <MenuItem key={k} onSelect={() => (k === "flow" || k === "sequence" ? setFocusFor(k) : onGenerate(k))}>
                      <K.icon /> {exists ? `Regenerar ${K.short.toLowerCase()}` : K.label}
                    </MenuItem>
                  );
                })}
              <MenuSeparator />
            </>
          )}
          <MenuLabel>A mano</MenuLabel>
          <MenuItem onSelect={() => onManual("note")}>
            <Pencil /> Nota en Markdown
          </MenuItem>
          <MenuItem onSelect={() => onManual("flow")}>
            <FileCode2 /> Diagrama en Mermaid
          </MenuItem>
        </MenuContent>
      </Menu>
      {focusFor && (
        <Dialog open onOpenChange={() => setFocusFor(null)} title={`Nuevo ${KINDS[focusFor].label.toLowerCase()}`} description="Contale a la IA qué proceso o escenario querés ver.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onGenerate(focusFor, focus.trim() || undefined);
              setFocusFor(null);
              setFocus("");
            }}
          >
            <Field label="¿Qué proceso?" htmlFor="focus">
              <Textarea id="focus" rows={3} maxLength={500} autoFocus placeholder="Por ejemplo: el alta de un pedido con pago con tarjeta" value={focus} onChange={(e) => setFocus(e.target.value)} />
            </Field>
            <Button type="submit" className="ai-cta w-full">
              <Sparkles /> Generar
            </Button>
          </form>
        </Dialog>
      )}
    </>
  );
}

function DocPanel({ doc, canEdit, aiEnabled, projectId, refresh, onApplyPlan, hasBoard }: { doc: DesignDoc; canEdit: boolean; aiEnabled: boolean; projectId: string; refresh: () => void; onApplyPlan: () => void; hasBoard: boolean }) {
  const K = KINDS[doc.kind];
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(doc.source);
  const [title, setTitle] = useState(doc.title);
  const [instruction, setInstruction] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/design-docs/${doc.id}`, { method: "PATCH", body: { title: title.trim() || doc.title, source } }),
    onSuccess: () => {
      setEditing(false);
      toast.success("Cambios guardados");
    },
    onSettled: refresh,
  });
  const refine = useMutation({
    mutationFn: (text: string) => api<DesignDoc>(`/design-docs/${doc.id}/ai/refine`, { method: "POST", body: { instruction: text } }),
    onSuccess: (d) => {
      setInstruction("");
      setSource(d.source);
      toast.success("Documento actualizado");
    },
    onSettled: refresh,
  });
  const regenerate = useMutation({
    mutationFn: () => api<DesignDoc>(`/design-projects/${projectId}/ai/generate`, { method: "POST", body: { kind: doc.kind } }),
    onSuccess: (d) => setSource(d.source),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: () => api(`/design-docs/${doc.id}`, { method: "DELETE" }), onSettled: refresh });
  const busy = refine.isPending || regenerate.isPending;
  const structured = doc.kind === "requirements" || doc.kind === "use_cases" || doc.kind === "plan";
  const isPlan = doc.kind === "plan" && Array.isArray(doc.content.phases);

  return (
    <article className="rounded-[2rem] border bg-card p-5 sm:p-7">
      <header className="mb-5 flex flex-wrap items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-2xl [&_svg]:size-5", K.tone)}>
          <K.icon />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input aria-label="Título" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} className="h-9 text-lg font-semibold" />
          ) : (
            <h2 className="text-xl font-semibold tracking-tight">{doc.title}</h2>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {doc.aiGenerated && <Sparkles className="mr-1 inline size-3 -translate-y-px text-[var(--ai-via)]" />}
            {doc.aiGenerated ? "Generado con IA · " : ""}actualizado {ago(doc.updatedAt)}
          </p>
        </div>
        {canEdit && !editing && (
          <div className="flex items-center gap-1.5">
            {isPlan && (
              <Button size="sm" className="ai-cta" onClick={onApplyPlan}>
                <KanbanSquare /> {hasBoard ? "Agregar al tablero" : "Crear tablero"}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => { setSource(doc.source); setTitle(doc.title); setEditing(true); }} disabled={busy}>
              <Pencil /> Editar
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Más acciones">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                {aiEnabled && doc.kind !== "note" && (
                  <MenuItem onSelect={() => regenerate.mutate()}>
                    <RotateCcw /> Regenerar desde cero
                  </MenuItem>
                )}
                <MenuItem danger onSelect={() => confirm(`¿Eliminar "${doc.title}"?`) && remove.mutate()}>
                  <Trash2 /> Eliminar
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        )}
      </header>

      {editing ? (
        <div className="space-y-3">
          {structured && <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Al guardar a mano, este documento pasa a texto libre. Para volver a la vista estructurada, pedile un cambio a la IA.</p>}
          <div className={cn("grid gap-3", doc.format === "mermaid" && "xl:grid-cols-2")}>
            <Textarea aria-label="Contenido" value={source} onChange={(e) => setSource(e.target.value)} rows={22} maxLength={60000} className="font-mono text-xs leading-relaxed" spellCheck={doc.format !== "mermaid"} />
            {doc.format === "mermaid" && <MermaidDiagram source={source} title={title} />}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setEditing(false); setSource(doc.source); setTitle(doc.title); }}>
              Cancelar
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Guardar
            </Button>
          </div>
        </div>
      ) : busy ? (
        <div className="ai-surface rounded-3xl p-5">
          <AiThinking steps={[refine.isPending ? "Aplicando el cambio…" : K.step, "Manteniendo la coherencia con el resto del proyecto…", "Ya casi…"]} lines={5} />
        </div>
      ) : (
        <DocBody doc={doc} />
      )}

      {(refine.error || regenerate.error) && !busy ? <AiError className="mt-4" error={refine.error ?? regenerate.error} retry={refine.error ? () => refine.mutate(refine.variables!) : () => regenerate.mutate()} /> : null}

      {canEdit && aiEnabled && !editing && doc.kind !== "note" && (
        <form
          className="mt-6 flex items-end gap-2 rounded-2xl border bg-background p-1.5 pl-3.5 focus-within:border-[color-mix(in_oklch,var(--ai-via)_55%,var(--border))]"
          onSubmit={(e) => {
            e.preventDefault();
            if (instruction.trim().length >= 3 && !busy) refine.mutate(instruction.trim());
          }}
        >
          <Sparkles className="mb-2.5 size-4 shrink-0 text-[var(--ai-via)]" />
          <textarea
            rows={1}
            maxLength={1000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (instruction.trim().length >= 3 && !busy) refine.mutate(instruction.trim());
              }
            }}
            placeholder={`Pedile un cambio a la IA: ${doc.kind === "use_cases" ? "«agregá recuperar contraseña»" : doc.kind === "plan" ? "«hacelo en 3 fases»" : doc.format === "mermaid" ? "«agregá el caso de pago rechazado»" : "«sumá un requisito de auditoría»"}`}
            aria-label="Cambio pedido a la IA"
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon-sm" className="ai-cta size-9 rounded-xl" aria-label="Pedir cambio" disabled={instruction.trim().length < 3 || busy}>
            <Send />
          </Button>
        </form>
      )}
      {doc.aiGenerated && !editing && <AiNote className="mt-3" />}
    </article>
  );
}

function ProjectMenu({ project, onDeleted, refresh }: { project: DesignProject["project"]; onDeleted: () => void; refresh: () => void }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(project.name);
  const [brief, setBrief] = useState(project.brief);
  const save = useMutation({ mutationFn: () => api(`/design-projects/${project.id}`, { method: "PATCH", body: { name, brief } }), onSuccess: () => setEdit(false), onSettled: refresh });
  const remove = useMutation({ mutationFn: () => api(`/design-projects/${project.id}`, { method: "DELETE" }), onSuccess: onDeleted });
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Opciones del proyecto">
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setEdit(true)}>
            <Pencil /> Editar nombre e idea
          </MenuItem>
          <MenuItem danger onSelect={() => confirm(`¿Eliminar el proyecto "${project.name}" y todos sus documentos?`) && remove.mutate()}>
            <Trash2 /> Eliminar proyecto
          </MenuItem>
        </MenuContent>
      </Menu>
      {edit && (
        <Dialog open onOpenChange={setEdit} title="Editar proyecto" wide>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <Field label="Nombre" htmlFor="pname">
              <Input id="pname" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Idea del sistema" htmlFor="pbrief" hint="Cuanto más contexto (usuarios, procesos, restricciones), mejores documentos.">
              <Textarea id="pbrief" rows={10} value={brief} maxLength={8000} onChange={(e) => setBrief(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
                Guardar
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

function ApplyPlanDialog({ projectId, doc, defaultName, boardId, onClose, onDone }: { projectId: string; doc: DesignDoc; defaultName: string; boardId: string | null; onClose: () => void; onDone: (boardId: string) => void }) {
  const [name, setName] = useState(defaultName.slice(0, 80));
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [useExisting, setUseExisting] = useState(!!boardId);
  const phases = (doc.content.phases as { tasks: unknown[] }[] | undefined) ?? [];
  const tasks = phases.reduce((s, p) => s + p.tasks.length, 0);
  const apply = useMutation({
    mutationFn: () => api<{ boardId: string; sprints: number; cards: number }>(`/design-projects/${projectId}/plan/apply`, { method: "POST", body: { docId: doc.id, boardId: useExisting && boardId ? boardId : undefined, boardName: name, startsOn: start } }),
    onSuccess: (r) => {
      toast.success(`Listo: ${r.sprints} etapas y ${r.cards} tareas`);
      onDone(r.boardId);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Convertir el plan en un tablero" description={`Se crea una etapa por cada fase (${phases.length}) con sus ${tasks} tareas estimadas, en orden y con fechas desde el inicio que elijas.`}>
      <div className="space-y-4">
        {boardId && (
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button key={String(v)} onClick={() => setUseExisting(v)} className={cn("flex-1 rounded-xl border px-3 py-2 text-sm", useExisting === v ? "ai-soft border-[color-mix(in_oklch,var(--ai-via)_45%,var(--border))] font-medium" : "hover:bg-muted")}>
                {v ? "Tablero vinculado" : "Tablero nuevo"}
              </button>
            ))}
          </div>
        )}
        {!(useExisting && boardId) && (
          <Field label="Nombre del tablero" htmlFor="bname">
            <Input id="bname" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Inicio de la primera fase" htmlFor="bstart">
          <Input id="bstart" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        {apply.error && <AiError error={apply.error} />}
        <Button className="ai-cta w-full" loading={apply.isPending} disabled={!(useExisting && boardId) && !name.trim()} onClick={() => apply.mutate()}>
          <KanbanSquare /> Crear etapas y tareas
        </Button>
      </div>
    </Dialog>
  );
}

function NewDocDialog({ projectId, kind, onClose, onCreated }: { projectId: string; kind: "note" | "flow"; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(kind === "note" ? "Nota" : "Diagrama");
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/design-projects/${projectId}/docs`, { method: "POST", body: { kind, title, source: kind === "flow" ? "flowchart TD\n  A([Inicio]) --> B[Paso]\n  B --> C{¿Decisión?}\n  C -->|Sí| D([Fin])\n  C -->|No| B" : "" } }),
    onSuccess: (r) => {
      onCreated(r.id);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={kind === "note" ? "Nueva nota" : "Nuevo diagrama en Mermaid"}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Título" htmlFor="dtitle">
          <Input id="dtitle" value={title} maxLength={160} autoFocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={create.isPending} disabled={!title.trim()}>
          Crear
        </Button>
      </form>
    </Dialog>
  );
}
