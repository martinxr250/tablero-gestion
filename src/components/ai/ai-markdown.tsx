"use client";

import { SquareKanban } from "lucide-react";
import { Fragment, type ReactNode } from "react";

type CardRef = { id: string; title: string };

/** Negritas y citas de tarjetas [[card:id]] dentro de una línea. */
function inline(text: string, cards: Map<string, CardRef>, onOpenCard?: (id: string) => void, key = "", onLink?: (kind: "card" | "board" | "design", id: string) => void) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[card:[0-9a-f-]{36}\]\]|\[[^\]]{1,160}\]\((?:card|board|design):[0-9a-f-]{36}\))/g);
  return parts.map((p, i) => {
    const k = `${key}-${i}`;
    const link = /^\[([^\]]{1,160})\]\((card|board|design):([0-9a-f-]{36})\)$/.exec(p);
    if (link) {
      const kind = link[2] as "card" | "board" | "design";
      return (
        <button
          key={k}
          type="button"
          onClick={() => (kind === "card" && onOpenCard ? onOpenCard(link[3]!) : onLink?.(kind, link[3]!))}
          className="mx-0.5 inline-flex max-w-full translate-y-[-1px] items-center gap-1 rounded-md border bg-background px-1.5 py-px align-middle text-[0.8rem] font-medium transition-colors hover:border-primary/50 hover:text-primary"
        >
          <SquareKanban className="size-3 shrink-0 text-muted-foreground" />
          <span className="max-w-56 truncate">{link[1]}</span>
        </button>
      );
    }
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={k} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
    const ref = /^\[\[card:([0-9a-f-]{36})\]\]$/.exec(p);
    if (ref) {
      const c = cards.get(ref[1]!);
      if (!c) return null;
      return (
        <button
          key={k}
          type="button"
          onClick={() => onOpenCard?.(c.id)}
          title={`Abrir “${c.title}”`}
          className="mx-0.5 inline-flex max-w-full translate-y-[-1px] items-center gap-1 rounded-md border bg-background px-1.5 py-px align-middle text-[0.8rem] font-medium transition-colors hover:border-primary/50 hover:text-primary"
        >
          <SquareKanban className="size-3 shrink-0 text-muted-foreground" />
          <span className="max-w-56 truncate">{c.title}</span>
        </button>
      );
    }
    return <Fragment key={k}>{p}</Fragment>;
  });
}

/** Markdown acotado que pide el servidor: párrafos, subtítulos ###, viñetas, listas numeradas y negritas. */
export function AiMarkdown({ text, cards = [], onOpenCard, variant = "chat", onLink }: { text: string; cards?: CardRef[]; onOpenCard?: (id: string) => void; variant?: "chat" | "doc"; onLink?: (kind: "card" | "board" | "design", id: string) => void }) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`}>{inline(para.join(" "), byId, onOpenCard, `p${out.length}`, onLink)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    const k = `l${out.length}`;
    out.push(
      <Tag key={k} className={list.ordered ? "list-decimal space-y-1.5 pl-5 marker:text-muted-foreground" : "space-y-1.5"}>
        {list.items.map((it, i) =>
          list!.ordered ? (
            <li key={i} className="pl-1">{inline(it, byId, onOpenCard, `${k}${i}`, onLink)}</li>
          ) : (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-[var(--ai-via)] opacity-70" />
              <span className="min-w-0">{inline(it, byId, onOpenCard, `${k}${i}`, onLink)}</span>
            </li>
          ),
        )}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = heading[1]!.length;
      const cls =
        variant === "doc" && level <= 2
          ? "pt-3 text-lg font-semibold tracking-tight text-foreground"
          : variant === "doc" && level === 3
            ? "pt-2 text-[0.95rem] font-semibold text-foreground"
            : "pt-1 text-[0.8rem] font-semibold tracking-wide text-muted-foreground uppercase";
      out.push(
        <h4 key={`h${out.length}`} className={cls}>
          {inline(heading[2]!.replace(/\*\*/g, ""), byId, onOpenCard, `h${out.length}`, onLink)}
        </h4>,
      );
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-3 text-sm leading-relaxed">{out}</div>;
}
