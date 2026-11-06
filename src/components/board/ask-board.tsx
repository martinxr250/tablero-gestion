"use client";

import { useMutation, useMutationState } from "@tanstack/react-query";
import { AlarmClock, ArrowUp, Ban, Check, Copy, History, MessageSquarePlus, SquareKanban, Target, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AiError, AiMark, AiNote, AiThinking } from "@/components/ai/ai-kit";
import { AiMarkdown } from "@/components/ai/ai-markdown";
import { askHistory, useAskHistory } from "@/lib/ai-chat";
import { ago } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Preguntas frecuentes de cualquier rol: ponerse al día, ver bloqueos, vencimientos y lo propio.
const SUGGESTIONS = [
  { icon: History, text: "Poneme al día: ¿qué pasó esta semana?" },
  { icon: Ban, text: "¿Qué está bloqueado y por qué?" },
  { icon: AlarmClock, text: "¿Qué vence en los próximos días?" },
  { icon: UserRound, text: "¿En qué estoy trabajando yo y qué me falta?" },
  { icon: Target, text: "¿Cómo viene la etapa en curso?" },
];

const STEPS = ["Leyendo las tarjetas del tablero…", "Revisando la actividad reciente…", "Armando la respuesta…"];

/** Preguntale al tablero: respuestas con IA basadas solo en lo que la persona puede ver. */
export function AskBoard({ boardId, onOpenCard, onClose }: { boardId: string; onOpenCard: (id: string) => void; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const history = useAskHistory(boardId);
  const [copied, setCopied] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationKey: ["ai-ask", boardId],
    mutationFn: (q: string) => api<{ answer: string; cards: { id: string; title: string }[] }>(`/boards/${boardId}/ai/ask`, { method: "POST", body: { question: q } }),
    // Se guarda aunque el panel se haya cerrado mientras la IA respondía.
    onSuccess: (r, q) => askHistory.add(boardId, { question: q, ...r, at: new Date().toISOString() }),
  });
  // Si se cerró y se volvió a abrir mientras respondía, se sigue mostrando la espera.
  const pendingElsewhere = useMutationState({ filters: { mutationKey: ["ai-ask", boardId], status: "pending" }, select: (m) => m.state.variables as string });
  const pendingQ = ask.isPending ? ask.variables : pendingElsewhere.at(-1);
  const pending = pendingQ !== undefined;
  const send = (q: string) => {
    if (q.trim().length >= 3 && !pending) {
      ask.mutate(q.trim());
      setQuestion("");
    }
  };
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, pending, ask.error]);
  const copy = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {
      /* el portapapeles puede no estar disponible */
    }
  };
  const empty = history.length === 0 && !pending && !ask.error;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <AiMark />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg font-bold">
                Preguntale al <span className="ai-text">tablero</span>
              </SheetTitle>
              <SheetDescription className="text-xs">Responde con las tarjetas y la actividad de las últimas dos semanas que vos podés ver.</SheetDescription>
            </div>
            {history.length > 0 && (
              <Button size="sm" variant="ghost" className="mr-8 shrink-0" disabled={pending} onClick={() => askHistory.clear(boardId)} title="Empezar una conversación nueva">
                <MessageSquarePlus /> <span className="hidden sm:inline">Nueva</span>
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 scroll-thin sm:px-8">
          {empty ? (
            <div className="ai-reveal space-y-4">
              <div className="ai-surface rounded-3xl p-5 text-center">
                <AiMark size="lg" className="mx-auto" />
                <p className="mt-3 text-base font-semibold">¿Qué querés saber?</p>
                <p className="mt-1 text-sm text-muted-foreground">Preguntá en tus palabras: estado, bloqueos, vencimientos o qué te toca hacer.</p>
              </div>
              <p className="px-1 text-xs font-medium text-muted-foreground">Para empezar</p>
              <ul className="space-y-2">
                {SUGGESTIONS.map(({ icon: Icon, text }, i) => (
                  <li key={text} className="ai-reveal" style={{ animationDelay: `${60 + i * 40}ms` }}>
                    <button
                      onClick={() => send(text)}
                      className="group flex w-full items-center gap-3 rounded-2xl border bg-card px-3.5 py-2.5 text-left text-sm transition-colors hover:border-[color-mix(in_oklch,var(--ai-via)_45%,var(--border))] hover:bg-muted/40"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--ai-via)]" />
                      {text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="space-y-8" aria-live="polite">
              {history.map((h, i) => (
                <li key={i} className="space-y-3">
                  <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm text-primary-foreground">{h.question}</p>
                  <div className="flex gap-3">
                    <AiMark size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <AiMarkdown text={h.answer} cards={h.cards} onOpenCard={onOpenCard} />
                      {h.cards.length > 0 && (
                        <div className="mt-4 rounded-2xl border bg-muted/30 p-3">
                          <p className="mb-2 text-[11px] font-medium text-muted-foreground">Tarjetas mencionadas · tocá para abrir</p>
                          <div className="flex flex-wrap gap-1.5">
                            {h.cards.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => onOpenCard(c.id)}
                                title={c.title}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs transition-colors hover:border-primary/50 hover:text-primary"
                              >
                                <SquareKanban className="size-3 shrink-0" />
                                <span className="truncate">{c.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">{ago(h.at)}</span>
                        <button onClick={() => copy(i, h.answer)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
                          {copied === i ? <Check className="size-3" /> : <Copy className="size-3" />}
                          {copied === i ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {pending && (
                <li className="space-y-3">
                  <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-primary/80 px-4 py-2 text-sm text-primary-foreground">{pendingQ}</p>
                  <div className="ai-surface rounded-2xl px-4 py-4">
                    <AiThinking steps={STEPS} compact />
                  </div>
                </li>
              )}
              {ask.error && !pending && (
                <li>
                  <AiError error={ask.error} retry={ask.variables ? () => ask.mutate(ask.variables!) : undefined} />
                </li>
              )}
            </ol>
          )}
          <div ref={end} />
        </div>

        <form
          className="border-t bg-background/80 px-4 pt-3 pb-4 backdrop-blur sm:px-8"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send(question);
          }}
        >
          <div className={cn("flex items-end gap-2 rounded-2xl border bg-card p-1.5 pl-3.5 transition-colors focus-within:border-[color-mix(in_oklch,var(--ai-via)_55%,var(--border))]")}>
            <textarea
              rows={1}
              maxLength={500}
              autoFocus
              placeholder="Escribí tu pregunta…"
              aria-label="Pregunta"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(question);
                }
              }}
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
            <Button type="submit" size="icon-sm" className="ai-cta size-9 rounded-xl" aria-label="Preguntar" loading={pending} disabled={question.trim().length < 3}>
              {!pending && <ArrowUp />}
            </Button>
          </div>
          <AiNote className="mt-2 px-1">Las respuestas pueden tener errores. Nuestra IA lee las tarjetas solo cuando preguntás.</AiNote>
        </form>
      </SheetContent>
    </Sheet>
  );
}
