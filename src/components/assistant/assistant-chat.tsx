"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Ban, Blocks, CalendarClock, Check, CheckCircle2, CircleAlert, Eye, KanbanSquare, MessageSquarePlus, PanelLeft, Trash2, Wand2, X, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AiError, AiMark, AiNote, AiThinking } from "@/components/ai/ai-kit";
import { AiMarkdown } from "@/components/ai/ai-markdown";
import { useOrg } from "@/components/shell/org-context";
import { Button, ErrorState } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAiEnabled } from "@/lib/ai";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

type ActionUi = { title: string; detail?: string; status: "pending" | "done" | "declined" | "error"; error?: string };
type Item = { type: "user"; text: string; at?: string } | { type: "assistant"; text: string; at?: string } | { type: "steps"; items: ActionUi[] } | { type: "actions"; items: (ActionUi & { id: string })[] };
type Conversation = { id: string; title: string; items: Item[]; pending: { id: string; title: string; detail?: string; tool: string }[]; busy: boolean; updatedAt: string };
type Reply = { status: "done" | "needs_confirmation" | "continue"; conversation: Conversation };

const STARTERS = [
  { icon: CalendarClock, text: "¿Qué tengo vencido o por vencer? Proponé cómo reprogramarlo." },
  { icon: KanbanSquare, text: "Armá un tablero para lanzar la nueva web con las tareas típicas, en etapas." },
  { icon: Blocks, text: "Diseñá desde cero un sistema de turnos para un consultorio médico." },
  { icon: Ban, text: "Revisá las tarjetas bloqueadas y comentá en cada una qué falta para destrabarla." },
];
const KEY = "assistant.conversation";

export function AssistantChat() {
  const { orgId, currentOrg } = useOrg();
  const qc = useQueryClient();
  const router = useRouter();
  const aiEnabled = useAiEnabled();
  const [convId, setConvId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const list = useQuery({ queryKey: ["assistant-list", orgId], queryFn: () => api<{ conversations: { id: string; title: string; updatedAt: string }[] }>(`/orgs/${orgId}/assistant/conversations`), enabled: !!orgId });
  const conv = useQuery({ queryKey: ["assistant", convId], queryFn: () => api<Conversation>(`/assistant/conversations/${convId}`), enabled: !!convId, retry: false });

  const pick = (id: string | null) => {
    setConvId(id);
    setHistoryOpen(false);
    try {
      if (id) sessionStorage.setItem(KEY, id);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* sin almacenamiento */
    }
  };

  const apply = (r: Reply) => {
    qc.setQueryData(["assistant", r.conversation.id], r.conversation);
    qc.invalidateQueries({ queryKey: ["assistant-list", orgId] });
    // Las acciones pueden haber cambiado tableros y tarjetas.
    qc.invalidateQueries({ queryKey: ["board"] });
    qc.invalidateQueries({ queryKey: ["workspaces"] });
    qc.invalidateQueries({ queryKey: ["design-projects"] });
  };
  const keepGoing = async (id: string, r: Reply): Promise<Reply> => {
    let cur = r;
    for (let i = 0; i < 3 && cur.status === "continue"; i++) {
      apply(cur);
      cur = await api<Reply>(`/assistant/conversations/${id}/continue`, { method: "POST", body: {} });
    }
    return cur;
  };

  const send = useMutation({
    mutationFn: async (message: string) => {
      // Si la conversación guardada ya no existe (otra organización o borrada), se empieza una nueva.
      let id = conv.error ? null : convId;
      if (!id) {
        id = (await api<{ id: string }>(`/orgs/${orgId}/assistant/conversations`, { method: "POST" })).id;
        pick(id);
      }
      setSending(message);
      return keepGoing(id, await api<Reply>(`/assistant/conversations/${id}/messages`, { method: "POST", body: { text: message } }));
    },
    onSuccess: apply,
    onSettled: () => setSending(null),
  });
  const confirm = useMutation({
    mutationFn: async (approve: string[]) => keepGoing(convId!, await api<Reply>(`/assistant/conversations/${convId}/confirm`, { method: "POST", body: { approve } })),
    onSuccess: apply,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/assistant/conversations/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      if (id === convId) pick(null);
      qc.invalidateQueries({ queryKey: ["assistant-list", orgId] });
    },
  });

  const submit = (message: string) => {
    const m = message.trim();
    if (!m || send.isPending || confirm.isPending || !orgId) return;
    setText("");
    send.mutate(m);
  };
  const raw = convId && !conv.error ? conv.data : undefined;
  // Pasos de consulta seguidos se muestran juntos, en una sola fila.
  const data = raw && {
    ...raw,
    items: raw.items.reduce<Item[]>((acc, it) => {
      const last = acc.at(-1);
      if (it.type === "steps" && last?.type === "steps") acc[acc.length - 1] = { type: "steps", items: [...last.items, ...it.items] };
      else acc.push(it);
      return acc;
    }, []),
  };
  const working = send.isPending || confirm.isPending;
  const empty = !data?.items.length && !sending;

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.items.length, data?.pending.length, sending, working]);

  const openLink = async (kind: "card" | "board" | "design", id: string) => {
    if (kind === "board") return router.push(`/b/${id}`);
    if (kind === "design") return router.push(`/studio/${id}`);
    try {
      const r = await api<{ card: { boardId: string } }>(`/cards/${id}`);
      router.push(`/b/${r.card.boardId}?card=${id}`);
    } catch {
      /* sin acceso */
    }
  };

  const history = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <p className="flex-1 text-xs font-semibold text-muted-foreground">Conversaciones</p>
        <Button size="icon-sm" variant="ghost" aria-label="Nueva conversación" onClick={() => pick(null)}>
          <MessageSquarePlus />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3 scroll-thin">
        {list.data?.conversations.map((c) => (
          <li key={c.id} className="group relative">
            <button onClick={() => pick(c.id)} className={cn("w-full rounded-xl px-3 py-2 pr-8 text-left text-sm transition-colors", c.id === convId ? "bg-card font-medium shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>
              <span className="block truncate">{c.title}</span>
              <span className="text-[11px] text-muted-foreground">{ago(c.updatedAt)}</span>
            </button>
            <button aria-label={`Borrar "${c.title}"`} onClick={() => remove.mutate(c.id)} className="absolute top-2 right-1.5 rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus:opacity-100">
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
        {list.data?.conversations.length === 0 && <li className="px-3 py-2 text-xs text-muted-foreground">Todavía no hay conversaciones.</li>}
      </ul>
    </div>
  );

  if (!aiEnabled && !list.isLoading) return <ErrorState error={new Error("La IA no está configurada en este servidor.")} />;

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar/40 lg:block">{history}</aside>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Conversaciones</SheetTitle>
          {history}
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <Button size="icon-sm" variant="ghost" className="lg:hidden" aria-label="Ver conversaciones" onClick={() => setHistoryOpen(true)}>
            <PanelLeft />
          </Button>
          <AiMark size="sm" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{data?.title && data.items.length ? data.title : "Asistente IA"}</h1>
            <p className="truncate text-xs text-muted-foreground">Consulta y actúa en {currentOrg?.name ?? "tu organización"} con tus permisos · cada cambio te lo pide confirmar</p>
          </div>
          {convId && (
            <Button size="sm" variant="ghost" onClick={() => pick(null)}>
              <MessageSquarePlus /> <span className="hidden sm:inline">Nueva</span>
            </Button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
            {empty ? (
              <div className="ai-reveal pt-6 sm:pt-12">
                <div className="text-center">
                  <AiMark size="lg" className="mx-auto" />
                  <h2 className="mt-4 text-2xl font-semibold tracking-tight">
                    ¿Qué hacemos <span className="ai-text">hoy</span>?
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Pedile que busque, resuma, cree o mueva tarjetas, arme tableros, comente o diseñe un sistema desde cero. Antes de cambiar algo, te muestra qué va a hacer.</p>
                </div>
                <ul className="mt-8 grid gap-2 sm:grid-cols-2">
                  {STARTERS.map(({ icon: Icon, text: t }, i) => (
                    <li key={t} className="ai-reveal" style={{ animationDelay: `${80 + i * 50}ms` }}>
                      <button onClick={() => submit(t)} className="group flex h-full w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left text-sm transition-colors hover:border-[color-mix(in_oklch,var(--ai-via)_45%,var(--border))]">
                        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-[var(--ai-via)]" />
                        {t}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="space-y-6" aria-live="polite">
                {data?.items.map((it, i) => (
                  <li key={i}>
                    <ItemView item={it} onLink={openLink} />
                  </li>
                ))}
                {sending && !data?.items.some((x, i) => x.type === "user" && x.text === sending && i === data.items.length - 1) && (
                  <li>
                    <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-primary/85 px-4 py-2 text-sm whitespace-pre-line text-primary-foreground">{sending}</p>
                  </li>
                )}
                {working && (
                  <li className="flex gap-3">
                    <AiMark size="sm" className="mt-0.5" />
                    <div className="ai-surface flex-1 rounded-2xl px-4 py-3.5">
                      <AiThinking compact lines={2} steps={confirm.isPending ? ["Haciendo los cambios…", "Revisando que todo quedó bien…"] : ["Entendiendo el pedido…", "Consultando tableros y tarjetas…", "Preparando la respuesta…"]} />
                    </div>
                  </li>
                )}
                {!working && data && data.pending.length > 0 && (
                  <li>
                    <Confirmation pending={data.pending} onDecide={(ids) => confirm.mutate(ids)} />
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
        </div>

        <form
          className="border-t bg-background/80 px-4 pt-3 pb-4 backdrop-blur sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <div className="mx-auto max-w-3xl">
            {data && data.pending.length > 0 && !working && <p className="mb-2 text-xs text-muted-foreground">Si escribís otra cosa, las acciones sin confirmar se descartan.</p>}
            <div className="flex items-end gap-2 rounded-2xl border bg-card p-1.5 pl-4 transition-colors focus-within:border-[color-mix(in_oklch,var(--ai-via)_55%,var(--border))]">
              <textarea
                rows={1}
                maxLength={4000}
                autoFocus
                placeholder="Pedile algo al asistente…"
                aria-label="Mensaje para el asistente"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(text);
                  }
                }}
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
              />
              <Button type="submit" size="icon-sm" className="ai-cta size-10 rounded-xl" aria-label="Enviar" loading={working} disabled={!text.trim() || !orgId}>
                {!working && <ArrowUp />}
              </Button>
            </div>
            <AiNote className="mt-2 px-1">Actúa con tus permisos. Lo que consulta lo procesa nuestro proveedor de IA para responder; nada cambia sin tu confirmación.</AiNote>
          </div>
        </form>
      </section>
    </div>
  );
}

function ItemView({ item, onLink }: { item: Item; onLink: (kind: "card" | "board" | "design", id: string) => void }) {
  if (item.type === "user") return <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm whitespace-pre-line text-primary-foreground">{item.text}</p>;
  if (item.type === "assistant")
    return (
      <div className="flex gap-3">
        <AiMark size="sm" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <AiMarkdown text={item.text} onLink={onLink} onOpenCard={(id) => onLink("card", id)} />
        </div>
      </div>
    );
  if (item.type === "steps")
    return (
      <div className="flex flex-wrap gap-1.5 pl-9">
        {item.items.map((s, i) => (
          <span key={i} className={cn("inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-[11px] text-muted-foreground", s.status === "error" && "text-destructive")} title={s.error}>
            {s.status === "error" ? <CircleAlert className="size-3" /> : <Eye className="size-3" />} {s.title}
          </span>
        ))}
      </div>
    );
  return (
    <ul className="space-y-1.5 pl-9">
      {item.items.map((a) => (
        <li key={a.id} className={cn("flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-sm", a.status === "done" && "border-success/25 bg-success/5", a.status === "error" && "border-destructive/25 bg-destructive/5", a.status === "declined" && "opacity-60")}>
          {a.status === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : a.status === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className={cn(a.status === "declined" && "line-through")}>{a.title}</p>
            {a.status === "error" && a.error && <p className="text-xs text-destructive">{a.error}</p>}
            {a.status === "declined" && <p className="text-xs text-muted-foreground">No se hizo</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Confirmation({ pending, onDecide }: { pending: Conversation["pending"]; onDecide: (approve: string[]) => void }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(pending.map((p) => p.id)));
  return (
    <div className="ai-surface ai-reveal ml-9 rounded-3xl p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Wand2 className="size-4 text-[var(--ai-via)]" /> {pending.length === 1 ? "¿Hago este cambio?" : `¿Hago estos ${pending.length} cambios?`}
      </p>
      <ul className="mt-3 space-y-1.5">
        {pending.map((p) => {
          const checked = on.has(p.id);
          return (
            <li key={p.id}>
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border bg-card px-3.5 py-3 transition-colors", !checked && "opacity-60")}>
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--ai-via)]"
                  checked={checked}
                  onChange={() => setOn((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{p.title}</span>
                  {p.detail && <span className="mt-0.5 block text-xs whitespace-pre-line text-muted-foreground">{p.detail}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onDecide([])}>
          Rechazar {pending.length > 1 ? "todo" : ""}
        </Button>
        <Button size="sm" className="ai-cta" disabled={on.size === 0} onClick={() => onDecide([...on])}>
          <Check /> {on.size === pending.length ? (pending.length > 1 ? "Hacer todo" : "Hacerlo") : `Hacer ${on.size} de ${pending.length}`}
        </Button>
      </div>
    </div>
  );
}
