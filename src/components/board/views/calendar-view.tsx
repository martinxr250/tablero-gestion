"use client";

import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { PRIORITY } from "@/lib/colors";
import type { BoardData, CardSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Calendario mensual por fecha de vencimiento. */
export function CalendarView({ data, visible, onOpenCard }: { data: BoardData; visible: (c: CardSummary) => boolean; onOpenCard: (id: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [today] = useState(() => new Date());
  const cards = useMemo(() => data.cards.filter(visible), [data.cards, visible]);
  const undated = cards.filter((c) => !c.dueAt).length;

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    const out: Date[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, CardSummary[]>();
    for (const c of cards) {
      if (!c.dueAt) continue;
      const key = format(new Date(c.dueAt), "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
  }, [cards]);

  return (
    <div className="flex h-full flex-col px-4 pb-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="display-title text-3xl capitalize">{format(month, "MMMM yyyy", { locale: es })}</h2>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="icon-sm" aria-label="Mes anterior" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Hoy
          </Button>
          <Button variant="secondary" size="icon-sm" aria-label="Mes siguiente" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight />
          </Button>
        </div>
        {undated > 0 && <span className="ml-auto text-sm text-muted-foreground">{undated} tarea{undated > 1 ? "s" : ""} sin fecha</span>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-[2rem] border bg-card" role="grid" aria-label="Calendario de vencimientos">
        {DAYS.map((d) => (
          <div key={d} role="columnheader" className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const items = byDay.get(format(day, "yyyy-MM-dd")) ?? [];
          const current = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              role="gridcell"
              className={cn("min-h-28 border-r border-b p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0", !isSameMonth(day, month) && "bg-muted/30 text-muted-foreground")}
            >
              <span className={cn("mb-1 inline-flex size-7 items-center justify-center rounded-full text-xs tabular-nums", current && "bg-primary font-semibold text-primary-foreground")}>
                {format(day, "d")}
              </span>
              <ul className="space-y-1">
                {items.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => onOpenCard(c.id)}
                      className={cn(
                        "flex w-full items-center gap-1.5 truncate rounded-full border bg-background px-2 py-0.5 text-left text-xs hover:border-primary/50",
                        c.completedAt && "text-muted-foreground line-through",
                      )}
                      title={c.title}
                    >
                      <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY[c.priority]?.dot)} />
                      <span className="truncate">{c.title}</span>
                    </button>
                  </li>
                ))}
                {items.length > 3 && <li className="px-2 text-[11px] text-muted-foreground">+{items.length - 3} más</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
