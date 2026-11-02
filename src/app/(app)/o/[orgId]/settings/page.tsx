"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { InviteForm } from "@/components/members/invite-form";
import { MembersTable, type MemberRow } from "@/components/members/members-table";
import { ORG_ROLES } from "@/components/members/roles";
import { useOrg, useSyncOrg } from "@/components/shell/org-context";
import { TabPanel, Tabs } from "@/components/ui/overlay";
import { Alert, Button, Card, ErrorState, Field, Input, PageHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

type Invitation = { id: string; email: string; scope: string; role: string; workspaceName: string | null; boardName: string | null; expiresAt: string };
type AuditEntry = { id: number; action: string; actorName: string | null; targetType: string | null; targetId: string | null; data: Record<string, unknown>; createdAt: string };

const AUDIT_LABEL: Record<string, string> = {
  "org.created": "creó la organización",
  "org.renamed": "renombró la organización",
  "org.deleted": "eliminó la organización",
  "member.role_changed": "cambió un rol",
  "member.removed": "quitó a un miembro",
  "member.left": "salió de la organización",
  "invitation.created": "envió una invitación",
  "invitation.revoked": "revocó una invitación",
  "invitation.accepted": "aceptó una invitación",
  "workspace.created": "creó un espacio de trabajo",
  "workspace.deleted": "eliminó un espacio de trabajo",
  "workspace.member_set": "cambió un miembro de un espacio",
  "workspace.member_removed": "quitó a alguien de un espacio",
  "board.created": "creó un tablero",
  "board.deleted": "eliminó un tablero",
  "board.member_set": "cambió un miembro de un tablero",
  "board.member_removed": "quitó a alguien de un tablero",
  "board.access_changed": "cambió la visibilidad de un tablero",
  "admin.board_override": "accedió como administrador a un tablero",
  "comment.moderated": "eliminó un comentario ajeno",
};

export default function OrgSettingsPage() {
  const { orgId } = useParams<{ orgId: string }>();
  useSyncOrg(orgId);
  const router = useRouter();
  const qc = useQueryClient();
  const { me } = useOrg();
  const [tab, setTab] = useState("members");
  const org = useQuery({ queryKey: ["org", orgId], queryFn: () => api<{ id: string; name: string; role: string }>(`/orgs/${orgId}`) });
  const isAdmin = org.data?.role === "owner" || org.data?.role === "admin";
  const members = useQuery({ queryKey: ["org-members", orgId], queryFn: () => api<{ members: MemberRow[] }>(`/orgs/${orgId}/members`) });
  const invites = useQuery({ queryKey: ["org-invites", orgId], queryFn: () => api<{ invitations: Invitation[] }>(`/orgs/${orgId}/invitations`), enabled: isAdmin });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api(`/orgs/${orgId}/members/${userId}`, { method: "PATCH", body: { role } }),
    onSuccess: () => toast.success("Rol actualizado"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["org-members", orgId] }),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api(`/orgs/${orgId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: async (_d, userId) => {
      if (userId === me?.user.id) {
        await qc.invalidateQueries({ queryKey: ["me"] });
        router.push("/dashboard");
      } else qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-invites", orgId] }),
  });

  if (org.error) return <ErrorState error={org.error} retry={org.refetch} />;
  const tabs = [
    { value: "members", label: "Miembros" },
    ...(isAdmin ? [{ value: "invites", label: "Invitaciones" }, { value: "audit", label: "Auditoría" }] : []),
    { value: "general", label: "General" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <PageHeader title="Ajustes de la organización" subtitle={org.data?.name} />
      <Tabs value={tab} onValueChange={setTab} tabs={tabs}>
        <TabPanel value="members" className="space-y-4">
          {isAdmin && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium">Invitar a la organización</p>
              <InviteForm endpoint={`/orgs/${orgId}/invitations`} roles={ORG_ROLES.filter((r) => r.value !== "owner")} defaultRole="member" onInvited={() => invites.refetch()} />
              <p className="mt-2 text-xs text-muted-foreground">Los invitados solo ven los tableros a los que los agregues.</p>
            </Card>
          )}
          {members.isLoading && <Skeleton className="h-40" />}
          {members.data && (
            <MembersTable
              members={members.data.members}
              roles={ORG_ROLES}
              meId={me?.user.id}
              canManage={isAdmin}
              busy={setRole.isPending || remove.isPending}
              onRoleChange={(userId, role) => setRole.mutate({ userId, role })}
              onRemove={(userId) => {
                const self = userId === me?.user.id;
                if (confirm(self ? "¿Salir de la organización?" : "¿Quitar a esta persona? Pierde el acceso a todos los tableros.")) remove.mutate(userId);
              }}
            />
          )}
        </TabPanel>

        {isAdmin && (
          <TabPanel value="invites">
            {invites.data?.invitations.length === 0 && <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p>}
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {invites.data?.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{i.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.scope === "org" ? "Organización" : i.scope === "workspace" ? `Espacio: ${i.workspaceName}` : `Tablero: ${i.boardName}`} · rol {i.role} · vence{" "}
                      {fmtDateTime(i.expiresAt)}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => revoke.mutate(i.id)}>
                    Revocar
                  </Button>
                </li>
              ))}
            </ul>
          </TabPanel>
        )}

        {isAdmin && (
          <TabPanel value="audit">
            <AuditLog orgId={orgId} />
          </TabPanel>
        )}

        <TabPanel value="general">
          <GeneralSettings key={org.data?.name} orgId={orgId} name={org.data?.name ?? ""} role={org.data?.role} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function GeneralSettings({ orgId, name, role }: { orgId: string; name: string; role?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [confirmName, setConfirmName] = useState("");
  const rename = useMutation({
    mutationFn: () => api(`/orgs/${orgId}`, { method: "PATCH", body: { name: value } }),
    onSuccess: () => {
      toast.success("Nombre actualizado");
      qc.invalidateQueries({ queryKey: ["org", orgId] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/orgs/${orgId}`, { method: "DELETE", body: { confirmName } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.push("/dashboard");
    },
  });
  const isAdmin = role === "owner" || role === "admin";
  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <Field label="Nombre de la organización" htmlFor="org-name">
          <Input id="org-name" value={value} disabled={!isAdmin} onChange={(e) => setValue(e.target.value)} maxLength={80} />
        </Field>
        {isAdmin && (
          <Button onClick={() => rename.mutate()} loading={rename.isPending} disabled={!value.trim() || value === name}>
            Guardar
          </Button>
        )}
      </Card>
      {role === "owner" && (
        <Card className="space-y-4 border-destructive/40 p-6">
          <div>
            <p className="font-semibold text-destructive">Eliminar organización</p>
            <p className="text-sm text-muted-foreground">Deja de estar disponible de inmediato y se borra definitivamente a los 30 días, con todos sus tableros y archivos.</p>
          </div>
          <Field label={`Escribí "${name}" para confirmar`} htmlFor="confirm-org">
            <Input id="confirm-org" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          </Field>
          <Button variant="danger" disabled={confirmName !== name} loading={del.isPending} onClick={() => del.mutate()}>
            Eliminar organización
          </Button>
        </Card>
      )}
      {!isAdmin && <Alert tone="info">Solo los administradores pueden cambiar estos ajustes.</Alert>}
    </div>
  );
}

function AuditLog({ orgId }: { orgId: string }) {
  const q = useInfiniteQuery({
    queryKey: ["audit", orgId],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => api<{ entries: AuditEntry[]; nextBefore: number | null }>(`/orgs/${orgId}/audit${pageParam ? `?before=${pageParam}` : ""}`),
    getNextPageParam: (last) => last.nextBefore,
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <div>
      {q.isLoading && <Skeleton className="h-40" />}
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5">
            <strong className="font-medium">{e.actorName ?? "Sistema"}</strong>
            <span className="text-muted-foreground">{AUDIT_LABEL[e.action] ?? e.action}</span>
            {typeof e.data?.role === "string" && <span className="text-xs text-muted-foreground">({e.data.role as string})</span>}
            <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <Button variant="secondary" className="mt-3" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          Cargar más
        </Button>
      )}
    </div>
  );
}
