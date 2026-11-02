"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button, Spinner } from "@/components/ui/primitives";
import { describeNotification } from "@/lib/activity";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const { data: count } = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => api<{ notifications: Notification[]; unread: number }>("/notifications"),
    enabled: open,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api("/notifications/read", { method: "POST", body: ids ? { ids } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = count?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notificaciones${unread ? `, ${unread} sin leer` : ""}`} className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-semibold">Notificaciones</p>
          {unread > 0 && (
            <button className="text-xs font-medium text-primary hover:underline" onClick={() => markRead.mutate(undefined)}>
              Marcar todas como leídas
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto scroll-thin">
          {isLoading && (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          )}
          {data?.notifications.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No tenés notificaciones.</p>}
          {data?.notifications.slice(0, 8).map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (!n.readAt) markRead.mutate([n.id]);
                setOpen(false);
                if (n.boardId) router.push(`/b/${n.boardId}${n.cardId ? `?card=${n.cardId}` : ""}`);
              }}
              className={cn("flex w-full gap-3 border-b border-border px-4 py-3 text-left text-sm hover:bg-muted", !n.readAt && "bg-primary-soft/40")}
            >
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2">
                  <strong className="font-semibold">{n.actorName ?? "Tableros"}</strong> {describeNotification(n)}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{ago(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
        <Link href="/notifications" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-sm font-medium text-primary hover:bg-muted">
          Ver todas
        </Link>
      </PopoverContent>
    </Popover>
  );
}
