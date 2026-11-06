"use client";

import { SquareKanban } from "lucide-react";
import { Fragment, type ReactNode } from "react";

type CardRef = { id: string; title: string };

/** Negritas y citas de tarjetas [[card:id]] dentro de una línea. */
function inline(text: string, cards: Map<string, CardRef>, onOpenCard?: (id: string) => void, key = "") {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\[card:[0-9a-f-]{36}\]\])/g);
  return parts.map((p, i) => {
    const k = `${key}-${i}`;
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
export function AiMarkdown({ text, cards = [], onOpenCard }: { text: string; cards?: CardRef[]; onOpenCard?: (id: string) => void }) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`}>{inline(para.join(" "), byId, onOpenCard, `p${out.length}`)}</p>);
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
            <li key={i} className="pl-1">{inline(it, byId, onOpenCard, `${k}${i}`)}</li>
          ) : (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-[var(--ai-via)] opacity-70" />
              <span className="min-w-0">{inline(it, byId, onOpenCard, `${k}${i}`)}</span>
            </li>
          ),
        )}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      out.push(
        <h4 key={`h${out.length}`} className="pt-1 text-[0.8rem] font-semibold tracking-wide text-muted-foreground uppercase">
          {inline(heading[1]!.replace(/\*\*/g, ""), byId, onOpenCard, `h${out.length}`)}
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
