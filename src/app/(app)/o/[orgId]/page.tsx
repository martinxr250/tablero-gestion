"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BoardTile } from "@/components/boards/board-tile";
import { CreateBoardDialog } from "@/components/boards/create-board-dialog";
import { useSyncOrg } from "@/components/shell/org-context";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog } from "@/components/ui/overlay";
import { Button, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { asColor, SWATCH, type ColorName } from "@/lib/colors";
import type { WorkspaceTree } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function OrgPage() {
  const { orgId } = useParams<{ orgId: string }>();
  useSyncOrg(orgId);
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ["org", orgId], queryFn: () => api<{ id: string; name: string; role: string; members: number }>(`/orgs/${orgId}`) });
  const tree = useQuery({ queryKey: ["workspaces", orgId], queryFn: () => api<WorkspaceTree>(`/orgs/${orgId}/workspaces`) });
  const [boardFor, setBoardFor] = useState<string | null>(null);
  const [wsOpen, setWsOpen] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsColor, setWsColor] = useState<ColorName>("indigo");
  const createWs = useMutation({
    mutationFn: () => api(`/orgs/${orgId}/workspaces`, { method: "POST", body: { name: wsName, color: wsColor } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces", orgId] });
      setWsOpen(false);
      setWsName("");
    },
  });

  if (org.error) return <ErrorState error={org.error} retry={org.refetch} />;
  const canCreateWs = org.data && org.data.role !== "guest";

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title={org.data?.name ?? <Skeleton className="h-8 w-48" />}
        subtitle={org.data && `${org.data.members} miembro${org.data.members === 1 ? "" : "s"}`}
        actions={
          <>
            {org.data && org.data.role !== "guest" && (
              <Link href={`/o/${orgId}/settings`}>
                <Button variant="secondary">
                  <Settings className="h-4 w-4" /> Ajustes
                </Button>
              </Link>
            )}
            {canCreateWs && (
              <Button onClick={() => setWsOpen(true)}>
                <Plus className="h-4 w-4" /> Nuevo espacio
              </Button>
            )}
          </>
        }
      />
      {tree.isLoading && <Skeleton className="h-40" />}
      {tree.data?.workspaces.length === 0 && <EmptyState illustration="projects" title="No tenés acceso a ningún espacio de trabajo" />}
      <div className="space-y-10">
        {tree.data?.workspaces.map((w) => (
          <section key={w.id}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <Link href={`/w/${w.id}`} className="flex items-center gap-2 hover:underline">
                <span className={cn("h-3 w-3 rounded", SWATCH[asColor(w.color)])} />
                <h2 className="text-lg font-semibold">{w.name}</h2>
              </Link>
              {(w.role === "admin" || w.role === "member") && (
                <Button variant="soft" size="sm" onClick={() => setBoardFor(w.id)}>
                  <Plus className="h-4 w-4" /> Nuevo tablero
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {w.boards.map((b) => (
                <BoardTile key={b.id} id={b.id} name={b.name} color={b.color} meta={b.visibility === "private" ? "Privado" : "Visible para el espacio"} />
              ))}
              {w.boards.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay tableros en este espacio.</p>}
            </div>
          </section>
        ))}
      </div>
      {boardFor && <CreateBoardDialog workspaceId={boardFor} open onOpenChange={(o) => !o && setBoardFor(null)} />}
      <Dialog open={wsOpen} onOpenChange={setWsOpen} title="Nuevo espacio de trabajo" description="Agrupa tableros de un mismo equipo o área.">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            createWs.mutate();
          }}
        >
          <Field label="Nombre" htmlFor="ws-name">
            <Input id="ws-name" autoFocus required maxLength={80} value={wsName} onChange={(e) => setWsName(e.target.value)} />
          </Field>
          <Field label="Color" htmlFor="ws-color">
            <ColorPicker value={wsColor} onChange={setWsColor} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setWsOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={createWs.isPending} disabled={!wsName.trim()}>
              Crear
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
