"use client";

import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Input, Select } from "@/components/ui/primitives";
import { api } from "@/lib/api";

export function InviteForm({ endpoint, roles, defaultRole, onInvited }: { endpoint: string; roles: { value: string; label: string }[]; defaultRole: string; onInvited?: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(defaultRole);
  const invite = useMutation({
    mutationFn: () => api(endpoint, { method: "POST", body: { email, role } }),
    onSuccess: () => {
      toast.success(`Invitación enviada a ${email}`);
      setEmail("");
      onInvited?.();
    },
  });
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        invite.mutate();
      }}
    >
      <Input type="email" required placeholder="correo@ejemplo.com" aria-label="Correo a invitar" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Select aria-label="Rol" className="sm:w-44" value={role} onChange={(e) => setRole(e.target.value)}>
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <Button type="submit" loading={invite.isPending}>
        <Send className="h-4 w-4" /> Invitar
      </Button>
    </form>
  );
}
