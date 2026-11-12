"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, CircleCheck, CircleDashed, CircleHelp, CircleX, FileCode2, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { AiError, AiThinking } from "@/components/ai/ai-kit";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PrAiReview = {
  verdict: "meets" | "partial" | "missing" | "no_criteria";
  summary: string;
  requirements: { text: string; status: "met" | "partial" | "missing" | "unclear"; evidence: string; files: string[] }[];
  extras: string[];
  risks: string[];
  filesAnalyzed: number;
  filesTotal: number;
  truncated: boolean;
  reviewedAt: string | null;
  sha: string | null;
  stale: boolean;
};

const VERDICT: Record<PrAiReview["verdict"], { label: string; cls: string; icon: typeof CircleCheck }> = {
  meets: { label: "Cumple la tarjeta", cls: "bg-success/10 text-success", icon: CircleCheck },
  partial: { label: "Cumple en parte", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200", icon: CircleDashed },
  missing: { label: "No cumple", cls: "bg-destructive/10 text-destructive", icon: CircleX },
  no_criteria: { label: "La tarjeta no tiene criterios", cls: "bg-muted text-muted-foreground", icon: CircleHelp },
};
const STATUS: Record<PrAiReview["requirements"][number]["status"], { label: string; cls: string; icon: typeof CircleCheck }> = {
  met: { label: "Cumplido", cls: "text-success", icon: CircleCheck },
  partial: { label: "En parte", cls: "text-amber-600 dark:text-amber-300", icon: CircleDashed },
  missing: { label: "Falta", cls: "text-destructive", icon: CircleX },
  unclear: { label: "No se puede saber", cls: "text-muted-foreground", icon: CircleHelp },
};
const STEPS = ["Trayendo los cambios del PR…", "Separando lo que pide la tarjeta…", "Comparando cada requisito con el código…"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "¿Cumple el PR lo que pide la tarjeta?": resultado guardado y botón para verificar (quien edita). */
export function PrReview({ cardId, number, review, canRun, onDone }: { cardId: string; number: number; review: PrAiReview | null; canRun: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const run = useMutation({
    mutationFn: () => api<PrAiReview>(`/cards/${cardId}/dev/pulls/${number}/ai/review`, { method: "POST" }),
    onSuccess: () => setOpen(true),
    onSettled: onDone,
  });

  if (run.isPending) {
    return (
      <div className="ai-surface w-full rounded-xl p-3">
        <AiThinking steps={STEPS} lines={2} compact />
      </div>
    );
  }
  if (!review) {
    if (!canRun) return null;
    return (
      <div className="w-full space-y-2">
        <Button size="sm" variant="secondary" className="ai-ghost" onClick={() => run.mutate()}>
          <Sparkles /> ¿Cumple lo que pide la tarjeta?
        </Button>
        {run.error && <AiError error={run.error} retry={() => run.mutate()} />}
      </div>
    );
  }

  const v = VERDICT[review.verdict];
  const counts = (["met", "partial", "missing", "unclear"] as const).map((s) => [s, review.requirements.filter((r) => r.status === s).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="ai-surface w-full rounded-xl text-sm">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", v.cls)}>
          <v.icon className="size-3.5" /> {v.label}
        </span>
        {counts.map(([s, n]) => (
          <span key={s} className={cn("inline-flex items-center gap-0.5 text-xs", STATUS[s].cls)} title={STATUS[s].label}>
            {(() => {
              const I = STATUS[s].icon;
              return <I className="size-3" />;
            })()}
            {n}
          </span>
        ))}
        <span className="flex-1" />
        {review.stale && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" /> Desactualizada
          </span>
        )}
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {review.stale && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
              El PR recibió commits después de esta verificación. Volvé a verificar para ver el estado actual.
            </p>
          )}
          <p className="leading-relaxed">{review.summary}</p>
          {review.requirements.length > 0 && (
            <ul className="space-y-2">
              {review.requirements.map((r, i) => {
                const st = STATUS[r.status];
                return (
                  <li key={i} className="flex gap-2">
                    <st.icon className={cn("mt-0.5 size-4 shrink-0", st.cls)} aria-label={st.label} />
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{r.text}</p>
                      {r.evidence && <p className="text-xs text-muted-foreground">{r.evidence}</p>}
                      {r.files.length > 0 && (
                        <p className="flex flex-wrap gap-1">
                          {r.files.map((f) => (
                            <code key={f} className="inline-flex max-w-full items-center gap-1 truncate rounded bg-background/70 px-1.5 py-0.5 text-[11px] text-muted-foreground" title={f}>
                              <FileCode2 className="size-3 shrink-0" /> {f}
                            </code>
                          ))}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {review.extras.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Fuera de lo que pide la tarjeta</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">{review.extras.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {review.risks.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Riesgos a revisar</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">{review.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {review.sha && <>Sobre <code>{review.sha}</code> · </>}
              {review.reviewedAt && `${ago(review.reviewedAt)} · `}
              Analizó {review.filesAnalyzed} de {plural(review.filesTotal, "archivo", "archivos")}
              {review.truncated && " (el resto no entró o no se puede leer)"}
            </span>
            <span className="flex-1" />
            {canRun && (
              <Button size="sm" variant="ghost" onClick={() => run.mutate()}>
                <RotateCcw /> Volver a verificar
              </Button>
            )}
          </div>
          {run.error && <AiError error={run.error} retry={() => run.mutate()} />}
          <p className="text-[11px] text-muted-foreground">Es una ayuda para revisar, no reemplaza la revisión de código.</p>
        </div>
      )}
    </div>
  );
}
