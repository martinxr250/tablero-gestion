"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const [template, setTemplate] = useState("builtin:kanban");
  const templates = useQuery({
    queryKey: ["board-templates", workspaceId],
    queryFn: () =>
      api<{ builtin: { key: string; name: string; description: string }[]; boards: { id: string; name: string }[] }>(`/workspaces/${workspaceId}/board-templates`),
    enabled: open,
  });
  const [kind, ref] = template.split(":") as [string, string];
  const templateBody = kind === "board" ? { kind: "board", boardId: ref, includeCards: false } : { kind: "builtin", key: ref };
  const chosen = templates.data?.builtin.find((t) => `builtin:${t.key}` === template);
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/workspaces/${workspaceId}/boards`, { method: "POST", body: { name, color, visibility, template: templateBody } }),
    onSuccess: ({ id }) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
      onOpenChange(false);
      setName("");
      router.push(`/b/${id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Nuevo tablero">
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
        <Field label="Plantilla" htmlFor="board-template" hint={chosen?.description ?? (kind === "board" ? "Copia listas, etiquetas y control de calidad de ese tablero." : undefined)}>
          <Select id="board-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <optgroup label="Plantillas">
              {(templates.data?.builtin ?? [{ key: "kanban", name: "Kanban simple", description: "" }]).map((t) => (
                <option key={t.key} value={`builtin:${t.key}`}>
                  {t.name}
                </option>
              ))}
            </optgroup>
            {!!templates.data?.boards.length && (
              <optgroup label="Tableros marcados como plantilla">
                {templates.data.boards.map((b) => (
                  <option key={b.id} value={`board:${b.id}`}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
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
