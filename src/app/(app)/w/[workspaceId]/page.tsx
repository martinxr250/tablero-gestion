"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UserPlus } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { BoardTile } from "@/components/boards/board-tile";
import { CreateBoardDialog } from "@/components/boards/create-board-dialog";
import { InviteForm } from "@/components/members/invite-form";
import { MembersTable, type MemberRow } from "@/components/members/members-table";
import { WS_ROLES } from "@/components/members/roles";
import { useOrg, useSyncOrg } from "@/components/shell/org-context";
import { ColorPicker } from "@/components/ui/color-picker";
import { TabPanel, Tabs } from "@/components/ui/overlay";
import { Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { asColor, type ColorName } from "@/lib/colors";

type WorkspaceData = {
  workspace: { id: string; orgId: string; name: string; description: string | null; color: string };
  role: "admin" | "member" | "viewer" | null;
  orgRole: string;
  boards: { id: string; name: string; color: string; visibility: string; archivedAt: string | null; role: string }[];
};

export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const q = useQuery({ queryKey: ["workspace", workspaceId], queryFn: () => api<WorkspaceData>(`/workspaces/${workspaceId}`) });
  useSyncOrg(q.data?.workspace.orgId);
  const [tab, setTab] = useState("boards");
  const [creating, setCreating] = useState(false);

  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  if (!q.data) return <Skeleton className="m-8 h-64" />;
  const { workspace, role, boards } = q.data;
  const active = boards.filter((b) => !b.archivedAt);
  const archived = boards.filter((b) => b.archivedAt);
  const tabs = [
    { value: "boards", label: "Tableros" },
    ...(role ? [{ value: "members", label: "Miembros" }] : []),
    ...(role === "admin" ? [{ value: "settings", label: "Ajustes" }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <PageHeader
        title={workspace.name}
        subtitle={workspace.description ?? "Espacio de trabajo"}
        actions={
          (role === "admin" || role === "member") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Nuevo tablero
            </Button>
          )
        }
      />
      <Tabs value={tab} onValueChange={setTab} tabs={tabs}>
        <TabPanel value="boards">
          {active.length === 0 ? (
            <EmptyState title="No hay tableros" description="Creá el primero para empezar a organizar tareas." />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {active.map((b) => (
                <BoardTile key={b.id} id={b.id} name={b.name} color={b.color} meta={b.visibility === "private" ? "Privado" : "Visible para el espacio"} />
              ))}
            </div>
          )}
          {archived.length > 0 && (
            <div className="mt-10">
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Archivados</h2>
              <div className="grid grid-cols-1 gap-4 opacity-70 sm:grid-cols-2 lg:grid-cols-4">
                {archived.map((b) => (
                  <BoardTile key={b.id} id={b.id} name={b.name} color={b.color} meta="Archivado" />
                ))}
              </div>
            </div>
          )}
        </TabPanel>
        {role && (
          <TabPanel value="members">
            <WorkspaceMembers workspaceId={workspaceId} orgId={workspace.orgId} canManage={role === "admin"} />
          </TabPanel>
        )}
        {role === "admin" && (
          <TabPanel value="settings">
            <WorkspaceSettings key={`${workspace.name}|${workspace.description}|${workspace.color}`} data={q.data} />
          </TabPanel>
        )}
      </Tabs>
      <CreateBoardDialog workspaceId={workspaceId} open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function WorkspaceMembers({ workspaceId, orgId, canManage }: { workspaceId: string; orgId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { me } = useOrg();
  const members = useQuery({ queryKey: ["ws-members", workspaceId], queryFn: () => api<{ members: MemberRow[] }>(`/workspaces/${workspaceId}/members`) });
  const orgMembers = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => api<{ members: MemberRow[] }>(`/orgs/${orgId}/members`),
    enabled: canManage,
  });
  const [addUser, setAddUser] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ws-members", workspaceId] });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api(`/workspaces/${workspaceId}/members/${userId}`, { method: "PUT", body: { role } }),
    onSettled: invalidate,
  });
  const remove = useMutation({ mutationFn: (userId: string) => api(`/workspaces/${workspaceId}/members/${userId}`, { method: "DELETE" }), onSettled: invalidate });
  const inWs = new Set(members.data?.members.map((m) => m.userId));
  const candidates = orgMembers.data?.members.filter((m) => !inWs.has(m.userId) && m.role !== "guest") ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <Card className="space-y-4 p-4">
          {candidates.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select aria-label="Miembro de la organización" value={addUser} onChange={(e) => setAddUser(e.target.value)}>
                <option value="">Agregar a alguien de la organización…</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.email})
                  </option>
                ))}
              </Select>
              <Button
                disabled={!addUser}
                loading={setRole.isPending}
                onClick={() => setRole.mutate({ userId: addUser, role: "member" }, { onSuccess: () => setAddUser("") })}
              >
                <UserPlus className="h-4 w-4" /> Agregar
              </Button>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Invitar por correo</p>
            <InviteForm endpoint={`/workspaces/${workspaceId}/invitations`} roles={WS_ROLES} defaultRole="member" />
          </div>
        </Card>
      )}
      {members.data && (
        <MembersTable
          members={members.data.members}
          roles={WS_ROLES}
          meId={me?.user.id}
          canManage={canManage}
          busy={setRole.isPending || remove.isPending}
          onRoleChange={(userId, role) => setRole.mutate({ userId, role })}
          onRemove={(userId) => confirm("¿Quitar a esta persona del espacio?") && remove.mutate(userId)}
        />
      )}
    </div>
  );
}

function WorkspaceSettings({ data }: { data: WorkspaceData }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [name, setName] = useState(data.workspace.name);
  const [description, setDescription] = useState(data.workspace.description ?? "");
  const [color, setColor] = useState<ColorName>(asColor(data.workspace.color));
  const [confirmName, setConfirmName] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/workspaces/${data.workspace.id}`, { method: "PATCH", body: { name, description: description || null, color } }),
    onSuccess: () => {
      toast.success("Cambios guardados");
      qc.invalidateQueries({ queryKey: ["workspace", data.workspace.id] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/workspaces/${data.workspace.id}`, { method: "DELETE", body: { confirmName } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      router.push(`/o/${data.workspace.orgId}`);
    },
  });
  return (
    <div className="max-w-xl space-y-6">
      <Card className="space-y-4 p-6">
        <Field label="Nombre" htmlFor="ws-name">
          <Input id="ws-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción" htmlFor="ws-desc">
          <Textarea id="ws-desc" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Color" htmlFor="ws-color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
          Guardar
        </Button>
      </Card>
      <Card className="space-y-4 border-destructive/40 p-6">
        <div>
          <p className="font-semibold text-destructive">Eliminar espacio de trabajo</p>
          <p className="text-sm text-muted-foreground">Se eliminan definitivamente todos sus tableros, tarjetas y archivos.</p>
        </div>
        <Field label={`Escribí "${data.workspace.name}" para confirmar`} htmlFor="ws-confirm">
          <Input id="ws-confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        </Field>
        <Button variant="danger" disabled={confirmName !== data.workspace.name} loading={del.isPending} onClick={() => del.mutate()}>
          Eliminar
        </Button>
      </Card>
    </div>
  );
}
