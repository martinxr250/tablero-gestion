"use client";

import { Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/user-avatar";
import { Button, Select } from "@/components/ui/primitives";

export type MemberRow = { userId: string; name: string; email: string; hasAvatar: boolean; role: string };

/** Tabla de miembros reutilizada por organización, espacio y tablero. */
export function MembersTable({
  members,
  roles,
  meId,
  canManage,
  onRoleChange,
  onRemove,
  busy,
}: {
  members: MemberRow[];
  roles: { value: string; label: string }[];
  meId: string | undefined;
  canManage: boolean;
  onRoleChange: (userId: string, role: string) => void;
  onRemove: (userId: string) => void;
  busy?: boolean;
}) {
  const label = (r: string) => roles.find((x) => x.value === r)?.label ?? r;
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
      {members.map((m) => (
        <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Avatar user={m} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {m.name} {m.userId === meId && <span className="text-xs text-muted-foreground">(vos)</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
          </div>
          {canManage ? (
            <Select
              aria-label={`Rol de ${m.name}`}
              className="h-9 w-40"
              value={m.role}
              disabled={busy}
              onChange={(e) => onRoleChange(m.userId, e.target.value)}
            >
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          ) : (
            <span className="rounded-lg bg-muted px-2 py-1 text-xs font-medium">{label(m.role)}</span>
          )}
          {(canManage || m.userId === meId) && (
            <Button variant="ghost" size="icon" aria-label={m.userId === meId ? "Salir" : `Quitar a ${m.name}`} disabled={busy} onClick={() => onRemove(m.userId)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
