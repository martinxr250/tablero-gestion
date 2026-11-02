"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { InviteForm } from "@/components/members/invite-form";
import { MembersTable, type MemberRow } from "@/components/members/members-table";
import { BOARD_ROLES } from "@/components/members/roles";
import { useOrg } from "@/components/shell/org-context";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog, TabPanel, Tabs } from "@/components/ui/overlay";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { asColor, CHIP, type ColorName } from "@/lib/colors";
import type { BoardData } from "@/lib/types";
import { RepoSettings } from "./repo-settings";

export function BoardSettingsDialog({ data, onClose }: { data: BoardData; onClose: () => void }) {
  const [tab, setTab] = useState("general");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Configuración del tablero" wide>
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "general", label: "General" },
          { value: "members", label: "Miembros" },
          { value: "labels", label: "Etiquetas" },
          { value: "github", label: "GitHub" },
        ]}
      >
        <TabPanel value="general">
          <General data={data} onClose={onClose} />
        </TabPanel>
        <TabPanel value="members">
          <Members data={data} />
        </TabPanel>
        <TabPanel value="labels">
          <Labels data={data} />
        </TabPanel>
        <TabPanel value="github">
          <RepoSettings data={data} />
        </TabPanel>
      </Tabs>
    </Dialog>
  );
}

function General({ data, onClose }: { data: BoardData; onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const b = data.board;
  const [form, setForm] = useState({ name: b.name, description: b.description ?? "", color: asColor(b.color) as ColorName, visibility: b.visibility, workspaceAccess: b.workspaceAccess });
  const [confirmName, setConfirmName] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["board", b.id] });
    qc.invalidateQueries({ queryKey: ["workspaces"] });
  };
  const save = useMutation({
    mutationFn: () => api(`/boards/${b.id}`, { method: "PATCH", body: { ...form, description: form.description || null } }),
    onSuccess: () => toast.success("Tablero actualizado"),
    onSettled: refresh,
  });
  const archive = useMutation({
    mutationFn: () => api(`/boards/${b.id}/archive`, { method: "POST", body: { archived: true } }),
    onSuccess: onClose,
    onSettled: refresh,
  });
  const del = useMutation({
    mutationFn: () => api(`/boards/${b.id}`, { method: "DELETE", body: { confirmName } }),
    onSuccess: () => {
      refresh();
      router.push(`/w/${b.workspaceId}`);
    },
  });
  return (
    <div className="space-y-5">
      <Field label="Nombre" htmlFor="b-name">
        <Input id="b-name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Descripción" htmlFor="b-desc">
        <Textarea id="b-desc" rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field label="Color" htmlFor="b-color">
        <ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Visibilidad" htmlFor="b-vis">
          <Select id="b-vis" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as "private" | "workspace" })}>
            <option value="workspace">Miembros del espacio de trabajo</option>
            <option value="private">Privado (solo miembros del tablero)</option>
          </Select>
        </Field>
        {form.visibility === "workspace" && (
          <Field label="Permiso del espacio" htmlFor="b-access">
            <Select id="b-access" value={form.workspaceAccess} onChange={(e) => setForm({ ...form, workspaceAccess: e.target.value as "viewer" | "commenter" | "editor" })}>
              <option value="editor">Pueden editar</option>
              <option value="commenter">Pueden comentar</option>
              <option value="viewer">Solo lectura</option>
            </Select>
          </Field>
        )}
      </div>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim()}>
        Guardar cambios
      </Button>
      <div className="space-y-3 rounded-2xl border border-destructive/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">Archivar el tablero lo deja en solo lectura.</p>
          <Button variant="secondary" onClick={() => archive.mutate()} loading={archive.isPending} disabled={!!b.archivedAt}>
            Archivar tablero
          </Button>
        </div>
        <Field label={`Para eliminar definitivamente, escribí "${b.name}"`} htmlFor="b-confirm">
          <Input id="b-confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
        </Field>
        <Button variant="danger" disabled={confirmName !== b.name} loading={del.isPending} onClick={() => del.mutate()}>
          Eliminar tablero
        </Button>
      </div>
    </div>
  );
}

function Members({ data }: { data: BoardData }) {
  const qc = useQueryClient();
  const { me } = useOrg();
  const boardId = data.board.id;
  const members = useQuery({ queryKey: ["board-members", boardId], queryFn: () => api<{ members: MemberRow[] }>(`/boards/${boardId}/members`) });
  const orgMembers = useQuery({ queryKey: ["org-members", data.board.orgId], queryFn: () => api<{ members: MemberRow[] }>(`/orgs/${data.board.orgId}/members`) });
  const [addUser, setAddUser] = useState("");
  const [role, setRole] = useState("editor");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["board-members", boardId] });
    qc.invalidateQueries({ queryKey: ["board", boardId] });
  };
  const set = useMutation({ mutationFn: (v: { userId: string; role: string }) => api(`/boards/${boardId}/members/${v.userId}`, { method: "PUT", body: { role: v.role } }), onSettled: refresh });
  const remove = useMutation({ mutationFn: (userId: string) => api(`/boards/${boardId}/members/${userId}`, { method: "DELETE" }), onSettled: refresh });
  const inBoard = new Set(members.data?.members.map((m) => m.userId));
  const candidates = orgMembers.data?.members.filter((m) => !inBoard.has(m.userId)) ?? [];
  const implicit = data.people.filter((p) => !inBoard.has(p.userId));
  return (
    <div className="space-y-5">
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
          <Select aria-label="Rol" className="sm:w-44" value={role} onChange={(e) => setRole(e.target.value)}>
            {BOARD_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
          <Button disabled={!addUser} loading={set.isPending} onClick={() => set.mutate({ userId: addUser, role }, { onSuccess: () => setAddUser("") })}>
            <UserPlus className="h-4 w-4" /> Agregar
          </Button>
        </div>
      )}
      <div>
        <p className="mb-2 text-sm font-medium">Invitar por correo (entra como invitado de la organización)</p>
        <InviteForm endpoint={`/boards/${boardId}/invitations`} roles={BOARD_ROLES} defaultRole="editor" />
      </div>
      {members.data && (
        <MembersTable
          members={members.data.members}
          roles={BOARD_ROLES}
          meId={me?.user.id}
          canManage
          busy={set.isPending || remove.isPending}
          onRoleChange={(userId, r) => set.mutate({ userId, role: r })}
          onRemove={(userId) => confirm("¿Quitar a esta persona del tablero?") && remove.mutate(userId)}
        />
      )}
      {implicit.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">También tienen acceso</p>
          <p className="mb-2 text-xs text-muted-foreground">Por su rol en la organización o en el espacio de trabajo.</p>
          <ul className="flex flex-wrap gap-2">
            {implicit.map((p) => (
              <li key={p.userId}>
                <Badge className="bg-muted text-foreground">
                  {p.name} · {BOARD_ROLES.find((r) => r.value === p.role)?.label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Labels({ data }: { data: BoardData }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<ColorName>("sky");
  const [editing, setEditing] = useState<{ id: string; name: string; color: ColorName } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["board", data.board.id] });
  const create = useMutation({ mutationFn: () => api(`/boards/${data.board.id}/labels`, { method: "POST", body: { name, color } }), onSuccess: () => setName(""), onSettled: refresh });
  const update = useMutation({
    mutationFn: (l: { id: string; name: string; color: string }) => api(`/labels/${l.id}`, { method: "PATCH", body: { name: l.name, color: l.color } }),
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/labels/${id}`, { method: "DELETE" }), onSettled: refresh });
  return (
    <div className="space-y-5">
      <ul className="space-y-2">
        {data.labels.map((l) =>
          editing?.id === l.id ? (
            <li key={l.id} className="space-y-2 rounded-xl border border-border p-3">
              <Input value={editing.name} maxLength={40} aria-label="Nombre de la etiqueta" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => update.mutate(editing)} loading={update.isPending}>
                  Guardar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              </div>
            </li>
          ) : (
            <li key={l.id} className="flex items-center gap-2">
              <Badge className={`${CHIP[asColor(l.color)]} px-2.5 py-1 text-xs`}>{l.name}</Badge>
              <span className="flex-1" />
              <Button variant="ghost" size="icon-sm" aria-label={`Editar ${l.name}`} onClick={() => setEditing({ id: l.id, name: l.name, color: asColor(l.color) })}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Eliminar ${l.name}`} onClick={() => confirm("¿Eliminar la etiqueta de todas las tarjetas?") && remove.mutate(l.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </li>
          ),
        )}
        {data.labels.length === 0 && <li className="text-sm text-muted-foreground">Todavía no hay etiquetas.</li>}
      </ul>
      <form
        className="space-y-3 rounded-xl border border-border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <p className="text-sm font-medium">Nueva etiqueta</p>
        <Input placeholder="Nombre" aria-label="Nombre de la etiqueta" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <ColorPicker value={color} onChange={setColor} />
        <Button type="submit" size="sm" loading={create.isPending} disabled={!name.trim()}>
          Crear etiqueta
        </Button>
      </form>
    </div>
  );
}
