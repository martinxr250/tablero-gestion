"use client";

import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Bell, Home, LayoutGrid, Search, Settings, SquareKanban } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { asColor, SWATCH } from "@/lib/colors";
import { cn } from "@/lib/utils";

type Results = {
  boards: { id: string; name: string; color: string }[];
  cards: { id: string; title: string; boardId: string; boardName: string; listName: string }[];
};

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["palette", debounced],
    queryFn: () => api<Results>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
  });

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  const itemCls = "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-muted";

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <D.Title className="sr-only">Búsqueda rápida</D.Title>
          <D.Description className="sr-only">Buscá tableros y tareas o saltá a una sección</D.Description>
          <Command shouldFilter={false} label="Búsqueda rápida">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Buscar tareas, tableros…" className="h-12 w-full bg-transparent text-sm outline-none" />
            </div>
            <Command.List className="max-h-96 overflow-y-auto p-2 scroll-thin">
              {debounced.length >= 2 && !isFetching && !data?.boards.length && !data?.cards.length && (
                <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">Sin resultados para “{debounced}”</Command.Empty>
              )}
              {debounced.length < 2 && (
                <Command.Group heading="Ir a" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  <Command.Item className={itemCls} onSelect={() => go("/dashboard")}><Home className="h-4 w-4" /> Inicio</Command.Item>
                  <Command.Item className={itemCls} onSelect={() => go("/search")}><Search className="h-4 w-4" /> Búsqueda avanzada</Command.Item>
                  <Command.Item className={itemCls} onSelect={() => go("/notifications")}><Bell className="h-4 w-4" /> Notificaciones</Command.Item>
                  <Command.Item className={itemCls} onSelect={() => go("/settings")}><Settings className="h-4 w-4" /> Mi cuenta</Command.Item>
                </Command.Group>
              )}
              {!!data?.boards.length && (
                <Command.Group heading="Tableros" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {data.boards.map((b) => (
                    <Command.Item key={b.id} value={`b-${b.id}`} className={cn(itemCls, "text-foreground")} onSelect={() => go(`/b/${b.id}`)}>
                      <span className={cn("h-3 w-3 rounded", SWATCH[asColor(b.color)])} />
                      {b.name}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!!data?.cards.length && (
                <Command.Group heading="Tareas" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {data.cards.slice(0, 12).map((c) => (
                    <Command.Item key={c.id} value={`c-${c.id}`} className={cn(itemCls, "text-foreground")} onSelect={() => go(`/b/${c.boardId}?card=${c.id}`)}>
                      <SquareKanban className="h-4 w-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {c.boardName} · {c.listName}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
            <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5" /> Enter para abrir · Esc para cerrar
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
