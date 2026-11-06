"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DraftRow } from "@/lib/bulk-parse";

/** Si el servidor tiene la IA configurada (se consulta una vez por sesión). */
export function useAiEnabled() {
  const q = useQuery({ queryKey: ["ai-status"], queryFn: () => api<{ enabled: boolean }>("/ai/status"), staleTime: 10 * 60_000 });
  return !!q.data?.enabled;
}

export type AiTask = {
  title: string;
  description: string;
  priority: DraftRow["priority"];
  due: string;
  estimatePoints: number | null;
  owner: string;
  labels: string[];
  subtasks: string[];
};

/** Tareas sugeridas por la IA → filas de la carga masiva (las subtareas quedan debajo de su tarea). */
export function aiTasksToRows(tasks: AiTask[]): DraftRow[] {
  const empty: Omit<DraftRow, "title"> = { description: "", listName: "", ownerName: "", priority: "none", due: "", estimate: "", labels: "", parentTitle: "", sprintName: "", isSubtask: false };
  return tasks.flatMap((t) => [
    { ...empty, title: t.title, description: t.description, ownerName: t.owner, priority: t.priority, due: t.due, estimate: t.estimatePoints === null ? "" : String(t.estimatePoints), labels: t.labels.join(", ") },
    ...t.subtasks.map((s) => ({ ...empty, title: s, isSubtask: true, parentTitle: t.title })),
  ]);
}
