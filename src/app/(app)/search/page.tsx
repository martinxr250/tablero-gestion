"use client";

import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useOrg } from "@/components/shell/org-context";
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { PRIORITY } from "@/lib/colors";
import { dueState, fmtShort } from "@/lib/format";
import type { WorkspaceTree } from "@/lib/types";
import { cn } from "@/lib/utils";

type Result = {
  boards: { id: string; name: string; color: string }[];
  cards: { id: string; title: string; boardId: string; boardName: string; listName: string; priority: string; dueAt: string | null; completedAt: string | null; archivedAt: string | null }[];
};

const FIELDS = ["q", "orgId", "workspaceId", "boardId", "assigneeId", "priority", "status", "due"] as const;

function SearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { me, orgId } = useOrg();
  const [text, setText] = useState(params.get("q") ?? "");
  const get = (k: string) => params.get(k) ?? "";
  const scopeOrg = get("orgId") || orgId || "";

  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== get("q")) set("q", text);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function set(key: string, value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    if (key === "orgId") {
      sp.delete("workspaceId");
      sp.delete("boardId");
    }
    if (key === "workspaceId") sp.delete("boardId");
    router.replace(`${pathname}?${sp}`);
  }

  const qs = new URLSearchParams();
  for (const f of FIELDS) if (get(f)) qs.set(f, get(f));
  if (!qs.get("orgId") && scopeOrg) qs.set("orgId", scopeOrg);

  const tree = useQuery({ queryKey: ["workspaces", scopeOrg], queryFn: () => api<WorkspaceTree>(`/orgs/${scopeOrg}/workspaces`), enabled: !!scopeOrg });
  const result = useQuery({ queryKey: ["search", qs.toString()], queryFn: () => api<Result>(`/search?${qs}`), enabled: !!me });
  const boards = tree.data?.workspaces.filter((w) => !get("workspaceId") || w.id === get("workspaceId")).flatMap((w) => w.boards) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <PageHeader title="Búsqueda" subtitle="Encontrá tareas en todos tus tableros." />
      <Card className="mb-6 space-y-3 p-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-9" placeholder="Buscar por título o descripción…" aria-label="Buscar" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
          <Select aria-label="Organización" value={scopeOrg} onChange={(e) => set("orgId", e.target.value)}>
            {me?.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Espacio de trabajo" value={get("workspaceId")} onChange={(e) => set("workspaceId", e.target.value)}>
            <option value="">Todos los espacios</option>
            {tree.data?.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Tablero" value={get("boardId")} onChange={(e) => set("boardId", e.target.value)}>
            <option value="">Todos los tableros</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Persona" value={get("assigneeId")} onChange={(e) => set("assigneeId", e.target.value)}>
            <option value="">Cualquier persona</option>
            <option value="me">Asignadas a mí</option>
          </Select>
          <Select aria-label="Estado" value={get("status") || "open"} onChange={(e) => set("status", e.target.value)}>
            <option value="open">Abiertas</option>
            <option value="overdue">Vencidas</option>
            <option value="completed">Completadas</option>
            <option value="archived">Archivadas</option>
          </Select>
          <Select aria-label="Prioridad" value={get("priority")} onChange={(e) => set("priority", e.target.value)}>
            <option value="">Cualquier prioridad</option>
            {Object.entries(PRIORITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Vencimiento" value={get("due")} onChange={(e) => set("due", e.target.value)}>
            <option value="">Cualquier fecha</option>
            <option value="overdue">Vencidas</option>
            <option value="today">Hoy</option>
            <option value="week">Próximos 7 días</option>
            <option value="none">Sin fecha</option>
          </Select>
        </div>
      </Card>
      {result.error && <ErrorState error={result.error} retry={result.refetch} />}
      {result.isLoading && <Skeleton className="h-64" />}
      {result.data && result.data.boards.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {result.data.boards.map((b) => (
            <Link key={b.id} href={`/b/${b.id}`}>
              <Badge className="bg-primary-soft px-3 py-1.5 text-sm text-primary">Tablero: {b.name}</Badge>
            </Link>
          ))}
        </div>
      )}
      {result.data && result.data.cards.length === 0 && <EmptyState icon={<SearchIcon />} title="Sin resultados" description="Probá con otras palabras o quitá filtros." />}
      {result.data && result.data.cards.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {result.data.cards.map((c) => {
              const due = dueState(c.dueAt, !!c.completedAt);
              return (
                <li key={c.id}>
                  <Link href={`/b/${c.boardId}?card=${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted">
                    <span className={cn("h-2 w-2 rounded-full", PRIORITY[c.priority]?.dot)} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-sm font-medium", c.completedAt && "line-through")}>{c.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.boardName} · {c.listName}
                        {c.archivedAt && " · archivada"}
                      </span>
                    </span>
                    {c.dueAt && <Badge className={cn(due === "overdue" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{fmtShort(c.dueAt)}</Badge>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}
