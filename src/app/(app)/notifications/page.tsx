"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui/primitives";
import { describeNotification } from "@/lib/activity";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";

type Page = { notifications: Notification[]; unread: number; nextBefore: string | null };

export default function NotificationsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useInfiniteQuery({
    queryKey: ["notifications", "page"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page>(`/notifications${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextBefore,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api("/notifications/read", { method: "POST", body: ids ? { ids } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = q.data?.pages.flatMap((p) => p.notifications) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <PageHeader
        title="Notificaciones"
        subtitle={unread ? `${unread} sin leer` : "Estás al día"}
        actions={
          unread > 0 && (
            <Button variant="secondary" onClick={() => markRead.mutate(undefined)} loading={markRead.isPending}>
              Marcar todas como leídas
            </Button>
          )
        }
      />
      {q.error && <ErrorState error={q.error} retry={q.refetch} />}
      {q.isLoading && <Skeleton className="h-64" />}
      {q.data && items.length === 0 && <EmptyState icon={<Bell />} title="No tenés notificaciones" description="Te avisamos cuando te asignen tareas, te mencionen o algo esté por vencer." />}
      {items.length > 0 && (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  className={cn("flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-muted", !n.readAt && "bg-primary-soft/40")}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate([n.id]);
                    if (n.boardId) router.push(`/b/${n.boardId}${n.cardId ? `?card=${n.cardId}` : ""}`);
                  }}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                  <span className="min-w-0 flex-1">
                    <strong className="font-semibold">{n.actorName ?? "Tableros"}</strong> {describeNotification(n)}
                    <span className="block text-xs text-muted-foreground">
                      {typeof n.data.boardName === "string" && `${n.data.boardName} · `}
                      {ago(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {q.hasNextPage && (
        <Button variant="secondary" className="mt-4" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Cargar más
        </Button>
      )}
    </div>
  );
}
