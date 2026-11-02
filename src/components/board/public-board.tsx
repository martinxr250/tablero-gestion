"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Eye, ListTree, Square } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Logo } from "@/components/ui/logo";
import { Dialog } from "@/components/ui/overlay";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { api, ApiError } from "@/lib/api";
import { asColor, SWATCH } from "@/lib/colors";
import type { BoardField, CardSummary, Label, List, Person } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CardFieldsContext, CardTile } from "./card-tile";
import { RichEditor } from "./rich-editor";

type PublicData = {
  board: { name: string; description: string | null; color: string; orgName: string; archived: boolean };
  lists: List[];
  cards: CardSummary[];
  labels: Label[];
  fields: BoardField[];
  people: { userId: string; name: string }[];
};
type PublicCard = {
  id: string;
  title: string;
  description: unknown;
  checklists: { title: string; items: { text: string; done: boolean }[] }[];
  subtasks: { id: string; title: string; done: boolean }[];
};

function CardDetail({ token, cardId, onClose }: { token: string; cardId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["public-card", token, cardId], queryFn: () => api<PublicCard>(`/public/boards/${token}/cards/${cardId}`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={q.data?.title ?? "Cargando…"}>
      {!q.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-6">
          {q.data.description ? <RichEditor value={q.data.description} editable={false} /> : <p className="text-sm text-muted-foreground">Sin descripción.</p>}
          {q.data.subtasks.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <ListTree className="size-4 text-muted-foreground" /> Subtareas
              </h3>
              <ul className="space-y-1 text-sm">
                {q.data.subtasks.map((t) => (
                  <li key={t.id} className={cn("flex items-center gap-2", t.done && "text-muted-foreground line-through")}>
                    {t.done ? <CheckCircle2 className="size-4 text-success" /> : <Square className="size-4" />} {t.title}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {q.data.checklists.map((c) => (
            <section key={c.title}>
              <h3 className="mb-2 text-sm font-semibold">{c.title}</h3>
              <ul className="space-y-1 text-sm">
                {c.items.map((i, n) => (
                  <li key={n} className={cn("flex items-center gap-2", i.done && "text-muted-foreground line-through")}>
                    {i.done ? <CheckCircle2 className="size-4 text-success" /> : <Square className="size-4" />} {i.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Vista pública de solo lectura de un tablero compartido por enlace. */
export function PublicBoard({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["public-board", token], queryFn: () => api<PublicData>(`/public/boards/${token}`), retry: false, refetchInterval: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  const labels = useMemo(() => new Map((q.data?.labels ?? []).map((l) => [l.id, l])), [q.data]);
  const people = useMemo(
    () => new Map<string, Person>((q.data?.people ?? []).map((p) => [p.userId, { userId: p.userId, name: p.name, email: "", hasAvatar: false, role: "viewer" }])),
    [q.data],
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-sidebar px-4 sm:px-6">
        <Link href="/" aria-label="Tableros">
          <Logo className="size-8" />
        </Link>
        {q.data && (
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-semibold">
              <span className={cn("size-2.5 shrink-0 rounded-full", SWATCH[asColor(q.data.board.color)])} />
              {q.data.board.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">{q.data.board.orgName}</p>
          </div>
        )}
        <span className="ml-2 hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground sm:inline-flex">
          <Eye className="size-3.5" /> Solo lectura
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeSwitch />
          <Link href="/register" className="inline-flex h-9 items-center rounded-full border bg-card px-4 text-sm font-medium hover:bg-muted">
            Crear cuenta
          </Link>
        </div>
      </header>

      {q.error ? (
        <div className="mx-auto mt-20 max-w-md px-4 text-center">
          {q.error instanceof ApiError && q.error.status === 404 ? (
            <>
              <h1 className="display-title text-3xl">Este enlace no está disponible</h1>
              <p className="mt-3 text-sm text-muted-foreground">Puede que lo hayan desactivado o reemplazado por uno nuevo. Pedile el enlace actualizado a quien te lo compartió.</p>
            </>
          ) : (
            <ErrorState error={q.error} retry={q.refetch} />
          )}
        </div>
      ) : !q.data ? (
        <div className="flex gap-4 p-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-96 w-[19rem]" />
          ))}
        </div>
      ) : (
        <CardFieldsContext value={q.data.fields}>
        <main className="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto p-4 scroll-thin sm:p-6">
          {q.data.lists.map((l) => {
            const listCards = q.data!.cards.filter((c) => c.listId === l.id);
            return (
              <section key={l.id} className="flex max-h-full w-[19rem] shrink-0 flex-col rounded-[2rem] border bg-card pb-2" aria-label={l.name}>
                <h2 className="flex items-center gap-2 px-5 pt-4 pb-3 text-sm font-semibold">
                  {l.name} <span className="text-xs font-normal text-muted-foreground">{listCards.length}</span>
                </h2>
                <div className="column-scroll min-h-2 flex-1 space-y-3 overflow-y-auto px-3 pt-1 pb-6 scroll-thin">
                  {listCards.map((c) => (
                    <button key={c.id} className="block w-full text-left" onClick={() => setOpen(c.id)}>
                      <CardTile card={c} labels={labels} people={people} />
                    </button>
                  ))}
                  {listCards.length === 0 && <div className="rounded-2xl border border-dashed py-8 text-center text-xs text-muted-foreground">Sin tarjetas</div>}
                </div>
              </section>
            );
          })}
        </main>
        </CardFieldsContext>
      )}
      {open && <CardDetail token={token} cardId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
