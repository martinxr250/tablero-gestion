"use client";

import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Spinner, Textarea } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError } from "@/lib/api";

type Answer = { question: string; answer: string; cards: { id: string; title: string }[] };

// Preguntas frecuentes de cualquier rol: ponerse al día, ver bloqueos, vencimientos y lo propio.
const SUGGESTIONS = [
  "Poneme al día: ¿qué pasó esta semana?",
  "¿Qué está bloqueado y por qué?",
  "¿Qué vence en los próximos días?",
  "¿En qué estoy trabajando yo y qué me falta?",
  "¿Cómo viene la etapa en curso?",
];

/** Preguntale al tablero: respuestas con IA basadas solo en lo que la persona puede ver. */
export function AskBoard({ boardId, onOpenCard, onClose }: { boardId: string; onOpenCard: (id: string) => void; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Answer[]>([]);
  const ask = useMutation({
    mutationFn: (q: string) => api<{ answer: string; cards: Answer["cards"] }>(`/boards/${boardId}/ai/ask`, { method: "POST", body: { question: q } }),
    onSuccess: (r, q) => {
      setHistory((h) => [{ question: q, ...r }, ...h].slice(0, 10));
      setQuestion("");
    },
  });
  const send = (q: string) => {
    if (q.trim().length >= 3 && !ask.isPending) ask.mutate(q.trim());
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="size-5 text-primary" /> Preguntale al tablero
          </SheetTitle>
          <SheetDescription>Claude responde con las tarjetas y la actividad de las últimas dos semanas que vos podés ver.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 scroll-thin">
          <form
            className="space-y-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              send(question);
            }}
          >
            <Textarea
              rows={3}
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
            />
            <Button type="submit" size="sm" loading={ask.isPending} disabled={question.trim().length < 3}>
              Preguntar
            </Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} disabled={ask.isPending} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
          {ask.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner className="size-4" /> Revisando el tablero…
            </p>
          )}
          {ask.error && <p className="text-sm text-destructive">{ask.error instanceof ApiError ? ask.error.message : "No se pudo responder."}</p>}
          <ol className="space-y-5" aria-live="polite">
            {history.map((h, i) => (
              <li key={history.length - i} className="space-y-2 rounded-2xl border p-4">
                <p className="text-xs font-medium text-muted-foreground">{h.question}</p>
                <p className="text-sm leading-relaxed whitespace-pre-line">{h.answer}</p>
                {h.cards.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {h.cards.map((c) => (
                      <button key={c.id} onClick={() => onOpenCard(c.id)} className="max-w-full truncate rounded-full bg-muted px-2.5 py-0.5 text-xs hover:text-primary">
                        {c.title}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-muted-foreground">Las respuestas de IA pueden tener errores. Se envían a Anthropic las tarjetas del tablero solo cuando preguntás.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
