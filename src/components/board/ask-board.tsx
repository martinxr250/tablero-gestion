"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ArrowUp, Ban, History, ListPlus, MessageSquarePlus, Target, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AiError, AiMark, AiNote, AiThinking } from "@/components/ai/ai-kit";
import { Confirmation, ItemView, type Conversation, type Item, type Reply } from "@/components/assistant/assistant-chat";
import { Button } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";

// Preguntas y pedidos frecuentes de cualquier rol: ponerse al día, ver bloqueos y también actuar.
const SUGGESTIONS = [
  { icon: History, text: "Poneme al día: ¿qué pasó esta semana?" },
  { icon: Ban, text: "¿Qué está bloqueado y por qué?" },
  { icon: AlarmClock, text: "¿Qué vence en los próximos días?" },
  { icon: UserRound, text: "¿En qué estoy trabajando yo y qué me falta?" },
  { icon: ListPlus, text: "Creá las tarjetas para preparar la próxima entrega y repartilas entre el equipo." },
  { icon: Target, text: "Ordená las tarjetas vencidas: proponé nuevas fechas y prioridades." },
];

const storeKey = (boardId: string) => `ask-board-conv:${boardId}`;
const readConv = (boardId: string) => {
  try {
    return sessionStorage.getItem(storeKey(boardId));
  } catch {
    return null;
  }
};

/**
 * Preguntale al tablero: el asistente con acciones, enfocado en este tablero. Responde con lo que la
 * persona puede ver y, si se lo pide, crea o cambia tarjetas después de que ella lo confirme.
 */
export function AskBoard({ boardId, orgId, boardName, onOpenCard, onClose }: { boardId: string; orgId: string; boardName: string; onOpenCard: (id: string) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [convId, setConvId] = useState<string | null>(() => readConv(boardId));
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const context = { boardId };

  const conv = useQuery({ queryKey: ["assistant", convId], queryFn: () => api<Conversation>(`/assistant/conversations/${convId}`), enabled: !!convId, retry: false,
    // Si se cerró el panel mientras respondía, al volver se sigue hasta que termine.
    refetchInterval: (q) => (q.state.data?.busy ? 2500 : false),
  });
  const pick = (id: string | null) => {
    setConvId(id);
    try {
      if (id) sessionStorage.setItem(storeKey(boardId), id);
      else sessionStorage.removeItem(storeKey(boardId));
    } catch {
      /* sin almacenamiento */
    }
  };
  const apply = (r: Reply) => {
    qc.setQueryData(["assistant", r.conversation.id], r.conversation);
    // Las acciones pueden haber cambiado el tablero.
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["card"] });
  };
  const keepGoing = async (id: string, r: Reply): Promise<Reply> => {
    let cur = r;
    for (let i = 0; i < 3 && cur.status === "continue"; i++) {
      apply(cur);
      cur = await api<Reply>(`/assistant/conversations/${id}/continue`, { method: "POST", body: { context } });
    }
    return cur;
  };

  // Se guarda en el servidor: sigue ahí aunque se cierre el panel mientras responde.
  const send = useMutation({
    mutationFn: async (message: string) => {
      let id = conv.error ? null : convId;
      if (!id) {
        id = (await api<{ id: string }>(`/orgs/${orgId}/assistant/conversations`, { method: "POST" })).id;
        pick(id);
      }
      setSending(message);
      return keepGoing(id, await api<Reply>(`/assistant/conversations/${id}/messages`, { method: "POST", body: { text: message, context } }));
    },
    onSuccess: apply,
    onSettled: () => setSending(null),
  });
  const confirm = useMutation({
    mutationFn: async (approve: string[]) => keepGoing(convId!, await api<Reply>(`/assistant/conversations/${convId}/confirm`, { method: "POST", body: { approve, context } })),
    onSuccess: apply,
  });

  const submit = (q: string) => {
    const m = q.trim();
    if (m.length < 2 || send.isPending || confirm.isPending) return;
    setQuestion("");
    send.mutate(m);
  };
  const raw = convId && !conv.error ? conv.data : undefined;
  const items = (raw?.items ?? []).reduce<Item[]>((acc, it) => {
    const last = acc.at(-1);
    if (it.type === "steps" && last?.type === "steps") acc[acc.length - 1] = { type: "steps", items: [...last.items, ...it.items] };
    else acc.push(it);
    return acc;
  }, []);
  const working = send.isPending || confirm.isPending || !!raw?.busy;
  const empty = items.length === 0 && !sending && !working;

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items.length, raw?.pending.length, working]);

  const openLink = async (kind: "card" | "board" | "design", id: string) => {
    if (kind === "card") return onOpenCard(id);
    router.push(kind === "board" ? `/b/${id}` : `/studio/${id}`);
  };

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
              <SheetDescription className="text-xs">Consultá o pedile cambios sobre «{boardName}». Antes de crear o modificar algo, te pide confirmación.</SheetDescription>
            </div>
            {items.length > 0 && (
              <Button size="sm" variant="ghost" className="mr-8 shrink-0" disabled={working} onClick={() => pick(null)} title="Empezar una conversación nueva">
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
                <p className="mt-3 text-base font-semibold">¿Qué querés saber o hacer?</p>
                <p className="mt-1 text-sm text-muted-foreground">Preguntá por el estado, los bloqueos o lo que te toca, o pedile que cree, mueva, asigne o comente tarjetas.</p>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map(({ icon: Icon, text }, i) => (
                  <li key={text} className="ai-reveal" style={{ animationDelay: `${60 + i * 40}ms` }}>
                    <button
                      onClick={() => submit(text)}
                      className="group flex h-full w-full items-start gap-3 rounded-2xl border bg-card px-3.5 py-2.5 text-left text-sm transition-colors hover:border-[color-mix(in_oklch,var(--ai-via)_45%,var(--border))] hover:bg-muted/40"
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--ai-via)]" />
                      {text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className="space-y-6" aria-live="polite">
              {items.map((it, i) => (
                <li key={i}>
                  <ItemView item={it} onLink={openLink} />
                </li>
              ))}
              {sending && !(items.at(-1)?.type === "user" && (items.at(-1) as { text: string }).text === sending) && (
                <li>
                  <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-primary/85 px-4 py-2 text-sm whitespace-pre-line text-primary-foreground">{sending}</p>
                </li>
              )}
              {working && (
                <li className="flex gap-3">
                  <AiMark size="sm" className="mt-0.5" />
                  <div className="ai-surface flex-1 rounded-2xl px-4 py-3.5">
                    <AiThinking compact lines={2} steps={confirm.isPending ? ["Haciendo los cambios…", "Revisando que todo quedó bien…"] : ["Leyendo el tablero…", "Revisando la actividad reciente…", "Preparando la respuesta…"]} />
                  </div>
                </li>
              )}
              {!working && raw && raw.pending.length > 0 && (
                <li>
                  <Confirmation key={raw.pending.map((p) => p.id).join()} pending={raw.pending} onDecide={(ids) => confirm.mutate(ids)} />
                </li>
              )}
              {(send.error || confirm.error) && !working && (
                <li>
                  <AiError error={send.error ?? confirm.error} retry={send.error && send.variables ? () => send.mutate(send.variables!) : undefined} />
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
            submit(question);
          }}
        >
          {raw && raw.pending.length > 0 && !working && <p className="mb-2 text-xs text-muted-foreground">Si escribís otra cosa, los cambios sin confirmar se descartan.</p>}
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-1.5 pl-3.5 transition-colors focus-within:border-[color-mix(in_oklch,var(--ai-via)_55%,var(--border))]">
            <textarea
              rows={1}
              maxLength={4000}
              autoFocus
              placeholder="Preguntá o pedí un cambio…"
              aria-label="Pregunta o pedido"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
            <Button type="submit" size="icon-sm" className="ai-cta size-9 rounded-xl" aria-label="Enviar" loading={working} disabled={question.trim().length < 2}>
              {!working && <ArrowUp />}
            </Button>
          </div>
          <AiNote className="mt-2 px-1">Actúa con tus permisos: si solo podés ver el tablero, solo responde. Las respuestas pueden tener errores.</AiNote>
        </form>
      </SheetContent>
    </Sheet>
  );
}
