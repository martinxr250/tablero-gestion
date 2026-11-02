"use client";

import { ArrowDown, ArrowUp, Ban, CornerDownRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/user-avatar";
import { PRIORITY } from "@/lib/colors";
import { dueState, fmtDate } from "@/lib/format";
import type { BoardData, CardSummary } from "@/lib/types";
import { fieldDisplay } from "@/lib/fields";
import { cn } from "@/lib/utils";

type SortKey = "title" | "list" | "owner" | "priority" | "due" | "estimate" | "sprint";
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** Vista de lista: todas las tarjetas en una tabla ordenable. */
export function ListView({ data, visible, onOpenCard }: { data: BoardData; visible: (c: CardSummary) => boolean; onOpenCard: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "list", dir: 1 });
  const lists = useMemo(() => new Map(data.lists.map((l, i) => [l.id, { ...l, index: i }])), [data.lists]);
  const people = useMemo(() => new Map(data.people.map((p) => [p.userId, p])), [data.people]);
  const sprints = useMemo(() => new Map(data.sprints.map((s) => [s.id, s])), [data.sprints]);

  const rows = useMemo(() => {
    const value = (c: CardSummary): string | number => {
      switch (sort.key) {
        case "title": return c.title.toLowerCase();
        case "list": return lists.get(c.listId)?.index ?? 99;
        case "owner": return (c.ownerId && people.get(c.ownerId)?.name.toLowerCase()) || "~";
        case "priority": return PRIORITY_ORDER[c.priority] ?? 9;
        case "due": return c.dueAt ? new Date(c.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        case "estimate": return c.estimatePoints ?? -1;
        case "sprint": return (c.sprintId && sprints.get(c.sprintId)?.name.toLowerCase()) || "~";
      }
    };
    return data.cards.filter(visible).sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : a.position < b.position ? -1 : 1) * sort.dir;
    });
  }, [data.cards, visible, sort, lists, people, sprints]);

  const header = (key: SortKey, label: string, className?: string) => (
    <th scope="col" className={cn("px-3 py-3 text-left text-xs font-medium text-muted-foreground", className)} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : 1 })}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div className="h-full overflow-auto px-4 pb-6 scroll-thin sm:px-6">
      <div className="overflow-hidden rounded-[2rem] border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b">
            <tr>
              {header("title", "Tarea", "pl-6")}
              {header("list", "Lista")}
              {header("owner", "Responsable")}
              {header("priority", "Prioridad")}
              {header("due", "Vence")}
              {header("estimate", "Puntos")}
              {header("sprint", "Etapa")}
              {data.fields.map((f) => (
                <th key={f.id} scope="col" className="px-3 py-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                  {f.name}
                </th>
              ))}
              <th scope="col" className="px-3 py-3 pr-6 text-left text-xs font-medium text-muted-foreground">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((c) => {
              const owner = c.ownerId ? people.get(c.ownerId) : null;
              const due = dueState(c.dueAt, !!c.completedAt);
              return (
                <tr key={c.id} className="cursor-pointer hover:bg-muted/60" onClick={() => onOpenCard(c.id)}>
                  <td className="max-w-md px-3 py-3 pl-6">
                    <button className="flex items-center gap-1.5 text-left font-medium hover:text-primary" onClick={(e) => { e.stopPropagation(); onOpenCard(c.id); }}>
                      {c.parentId && <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="Subtarea" />}
                      <span className="truncate">{c.title}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{lists.get(c.listId)?.name}</td>
                  <td className="px-3 py-3">
                    {owner ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar user={owner} size={22} /> {owner.name.split(" ")[0]}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {c.priority !== "none" ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PRIORITY[c.priority]?.chip)}>{PRIORITY[c.priority]?.label}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn("px-3 py-3 tabular-nums", due === "overdue" && "text-destructive", due === "soon" && "text-amber-600 dark:text-amber-300")}>{c.dueAt ? fmtDate(c.dueAt) : "—"}</td>
                  <td className="px-3 py-3 tabular-nums">{c.estimatePoints ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{(c.sprintId && sprints.get(c.sprintId)?.name) || "—"}</td>
                  {data.fields.map((f) => (
                    <td key={f.id} className="px-3 py-3 whitespace-nowrap tabular-nums">
                      {fieldDisplay(f, c.fieldValues[f.id]) || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-3 pr-6">
                    {c.completedAt ? (
                      <span className="text-success">Completada</span>
                    ) : c.blocked ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <Ban className="size-3.5" /> Bloqueada
                      </span>
                    ) : c.qaStatus === "pending" ? (
                      <span className="text-amber-600 dark:text-amber-300">En revisión</span>
                    ) : c.qaStatus === "rejected" ? (
                      <span className="text-brand">Rechazada</span>
                    ) : (
                      <span className="text-muted-foreground">Abierta</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                  No hay tareas para mostrar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
