"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ColorPicker } from "@/components/ui/color-picker";
import { Dialog } from "@/components/ui/overlay";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { ColorName } from "@/lib/colors";

export function CreateBoardDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState<ColorName>("indigo");
  const [visibility, setVisibility] = useState<"workspace" | "private">("workspace");
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/workspaces/${workspaceId}/boards`, { method: "POST", body: { name, color, visibility } }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      onOpenChange(false);
      setName("");
      router.push(`/b/${id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nuevo tablero" description="Se crea con las listas Por hacer, En curso y Hecho.">
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Nombre" htmlFor="board-name">
          <Input id="board-name" required maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Campaña de marketing" />
        </Field>
        <Field label="Color" htmlFor="board-color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label="Visibilidad" htmlFor="board-visibility" hint={visibility === "private" ? "Solo las personas que agregues." : "Todos los miembros del espacio de trabajo pueden verlo y editarlo."}>
          <Select id="board-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as "workspace" | "private")}>
            <option value="workspace">Espacio de trabajo</option>
            <option value="private">Privado</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Crear tablero
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
