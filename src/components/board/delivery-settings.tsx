"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Select } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import type { BoardData } from "@/lib/types";

type Level = "off" | "warn" | "block";
const RULES = [
  { key: "subtasks", label: "Subtareas completadas", hint: "Todas las subtareas tienen que estar terminadas." },
  { key: "dependencies", label: "Dependencias resueltas", hint: "Las tareas que la bloquean tienen que estar terminadas." },
  { key: "checklists", label: "Checklists terminados", hint: "Todos los ítems de sus checklists marcados." },
  { key: "prApproved", label: "Pull request aprobado", hint: "Solo aplica a tarjetas con PR vinculados." },
  { key: "ciPassing", label: "Checks de CI exitosos", hint: "Solo aplica a tarjetas con PR vinculados." },
  { key: "prMerged", label: "Pull request fusionado", hint: "Solo aplica a tarjetas con PR vinculados." },
] as const;

/** Reglas para completar tarjetas: desactivada, solo informa o bloquea. */
export function DeliverySettings({ data }: { data: BoardData }) {
  const qc = useQueryClient();
  const [rules, setRules] = useState<Record<string, Level>>(() => Object.fromEntries(RULES.map((r) => [r.key, data.board.completionRules?.[r.key] ?? "off"])));
  const save = useMutation({
    mutationFn: () => api(`/boards/${data.board.id}/completion-rules`, { method: "PUT", body: rules }),
    onSuccess: () => toast.success("Reglas guardadas"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Condiciones para completar una tarjeta. <strong>Bloquea</strong> impide terminarla hasta cumplirla; <strong>Informa</strong> solo avisa. La aprobación de control de calidad se configura en General.
        Si GitHub no responde, sus reglas pasan a informar para no frenar el trabajo.
      </p>
      <ul className="divide-y rounded-2xl border">
        {RULES.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <label htmlFor={`rule-${r.key}`} className="text-sm font-medium">
                {r.label}
              </label>
              <p className="text-xs text-muted-foreground">{r.hint}</p>
            </div>
            <Select id={`rule-${r.key}`} className="h-9 w-36" value={rules[r.key]} onChange={(e) => setRules({ ...rules, [r.key]: e.target.value as Level })}>
              <option value="off">Desactivada</option>
              <option value="warn">Informa</option>
              <option value="block">Bloquea</option>
            </Select>
          </li>
        ))}
      </ul>
      <Button onClick={() => save.mutate()} loading={save.isPending}>
        Guardar reglas
      </Button>
    </div>
  );
}
