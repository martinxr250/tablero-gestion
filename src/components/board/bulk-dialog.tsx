"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, FileSpreadsheet, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/overlay";
import { Alert, Button, Select, Spinner, Textarea } from "@/components/ui/primitives";
import { aiTasksToRows, useAiEnabled, type AiTask } from "@/lib/ai";
import { api, ApiError } from "@/lib/api";
import { parseCsv, parsePasted, parseRows, type Cell, type DraftRow } from "@/lib/bulk-parse";
import type { BoardData } from "@/lib/types";
import { cn } from "@/lib/utils";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const MAX_ROWS = 200;

type Result = { index: number; cardId: string; issueNumber?: number; error?: string };

/** Carga masiva: pegar una lista o importar CSV/Excel, revisar en una tabla editable y crear todo junto. */
export function BulkDialog({ data, open, onOpenChange, aiFileId }: { data: BoardData; open: boolean; onOpenChange: (o: boolean) => void; aiFileId?: string | null }) {
  const qc = useQueryClient();
  const aiEnabled = useAiEnabled();
  const aiFile = useRef<HTMLInputElement>(null);
  const files = useQuery({
    queryKey: ["board-files", data.board.id],
    queryFn: () => api<{ files: { id: string; fileName: string; aiReadable: boolean }[] }>(`/boards/${data.board.id}/files`),
    enabled: open && aiEnabled,
  });
  const [aiPick, setAiPick] = useState("");
  const generate = useMutation({
    mutationFn: (body: { fileId?: string; text?: string }) => api<{ tasks: AiTask[] }>(`/boards/${data.board.id}/ai/tasks`, { method: "POST", body }),
    onSuccess: (r) => {
      if (r.tasks.length === 0) return toast.info("La IA no encontró tareas en ese material");
      load(aiTasksToRows(r.tasks));
      toast.success(`La IA propuso ${r.tasks.length} tareas. Revisalas antes de crearlas.`);
    },
  });
  const uploadForAi = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.set("file", f);
      return api<{ id: string; aiReadable: boolean }>(`/boards/${data.board.id}/files`, { method: "POST", form });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["board-files", data.board.id] });
      if (!r.aiReadable) return toast.error("Se guardó en Archivos, pero la IA solo lee PDF, imágenes y texto.");
      generate.mutate({ fileId: r.id });
    },
  });
  // Abierto desde la vista Archivos con un documento elegido: genera al abrir (una sola vez).
  const autoRan = useRef<string | null>(null);
  const { mutate: runGenerate } = generate;
  useEffect(() => {
    if (!open || !aiFileId || autoRan.current === aiFileId) return;
    autoRan.current = aiFileId;
    runGenerate({ fileId: aiFileId });
  }, [open, aiFileId, runGenerate]);
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [createIssues, setCreateIssues] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const repo = useQuery({ queryKey: ["board-repo", data.board.id], queryFn: () => api<{ repo: { fullName: string } | null }>(`/boards/${data.board.id}/repo`), enabled: open });

  const findList = (name: string) => data.lists.find((l) => norm(l.name) === norm(name))?.id;
  const findPerson = (name: string) => {
    const n = norm(name);
    if (!n) return undefined;
    return data.people.find((p) => norm(p.email) === n || norm(p.name) === n || norm(p.name).split(" ")[0] === n)?.userId;
  };
  const findSprint = (name: string) => data.sprints.find((s) => s.status !== "closed" && norm(s.name) === norm(name))?.id;

  /** Avisos por fila (no bloquean: el dato no reconocido simplemente no se aplica). */
  const warnings = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const w: string[] = [];
        if (r.listName && !findList(r.listName)) w.push(`lista "${r.listName}" no existe`);
        if (r.ownerName && !findPerson(r.ownerName)) w.push(`"${r.ownerName}" no tiene acceso`);
        if (r.sprintName && !findSprint(r.sprintName)) w.push(`etapa "${r.sprintName}" no existe`);
        if (r.estimate && Number.isNaN(Number(r.estimate))) w.push("puntos inválidos");
        return w;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, data],
  );

  const reset = () => {
    setText("");
    setRows(null);
    setResults(null);
    setServerErrors({});
  };

  const load = (parsed: DraftRow[]) => {
    if (parsed.length === 0) return toast.error("No encontramos tareas para cargar");
    if (parsed.length > MAX_ROWS) toast.warning(`Se toman las primeras ${MAX_ROWS} tareas`);
    setRows(parsed.slice(0, MAX_ROWS));
    setResults(null);
    setServerErrors({});
  };

  async function readFile(f: File) {
    try {
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/universal");
        load(parseRows((await readSheet(f)) as Cell[][]));
      } else if (/\.(csv|txt|tsv)$/i.test(f.name)) {
        const content = await f.text();
        load(/\.txt$/i.test(f.name) ? parsePasted(content) : parseRows(parseCsv(content.replace(/^﻿/, ""))));
      } else toast.error("Formato no soportado. Usá .xlsx, .csv o .txt");
    } catch {
      toast.error("No pudimos leer el archivo");
    }
  }

  const items = () => {
    let lastTop = -1;
    return (rows ?? []).map((r, i) => {
      let parentIndex: number | undefined;
      if (r.isSubtask && lastTop >= 0) parentIndex = lastTop;
      else if (r.parentTitle) {
        const idx = (rows ?? []).findIndex((x, j) => j < i && !x.isSubtask && norm(x.title) === norm(r.parentTitle));
        if (idx >= 0) parentIndex = idx;
      }
      if (parentIndex === undefined) lastTop = i;
      const est = r.estimate ? Number(r.estimate) : null;
      return {
        title: r.title.trim(),
        description: r.description || undefined,
        listId: findList(r.listName),
        priority: r.priority,
        ownerId: findPerson(r.ownerName) ?? null,
        dueAt: r.due ? new Date(`${r.due}T12:00:00`).toISOString() : null,
        estimatePoints: est !== null && !Number.isNaN(est) ? est : null,
        labels: r.labels.split(/[,;]/).map((l) => l.trim()).filter(Boolean).slice(0, 10),
        parentIndex,
        sprintId: findSprint(r.sprintName) ?? null,
      };
    });
  };

  const submit = useMutation({
    mutationFn: () => api<{ created: number; results: Result[] }>(`/boards/${data.board.id}/cards/bulk`, { method: "POST", body: { items: items(), createIssues } }),
    meta: { silent: true },
    onSuccess: (r) => {
      setResults(r.results);
      const failed = r.results.filter((x) => x.error).length;
      toast.success(`${r.created} tareas creadas${failed ? ` · ${failed} issue(s) con error` : ""}`);
      qc.invalidateQueries({ queryKey: ["board", data.board.id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.details) {
        setServerErrors(Object.fromEntries(e.details.map((d) => [Number(d.path.split(".")[1]), d.message])));
        toast.error("Hay filas con errores: no se creó ninguna tarea");
      } else toast.error(e instanceof Error ? e.message : "No se pudo crear");
    },
  });

  const update = (i: number, patch: Partial<DraftRow>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const invalid = (rows ?? []).some((r) => !r.title.trim());
  const cell = "h-9 w-full rounded-full border bg-background px-3 text-sm";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      title="Carga masiva de tareas"
      description={rows ? "Revisá y corregí antes de crear. Nada se guarda hasta que confirmes." : "Pegá una lista o importá una planilla de Excel o CSV."}
      wide
      className="sm:max-w-6xl"
    >
      {!rows ? (
        <div className="space-y-4">
          <Textarea
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Lista de tareas"
            placeholder={"Una tarea por línea. Con sangría, es subtarea de la anterior.\nOpcional: Título | responsable | prioridad | vencimiento | puntos\n\nMódulo de usuarios | Ana | alta | 20/11/2026 | 8\n  - Tabla de usuarios\n  - Pantalla de alta\nDocumentación de la API"}
            className="font-mono text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => load(parsePasted(text))} disabled={!text.trim()}>
              Revisar
            </Button>
            <span className="text-sm text-muted-foreground">o</span>
            <Button variant="secondary" onClick={() => file.current?.click()}>
              <Upload /> Importar Excel o CSV
            </Button>
            <input
              ref={file}
              type="file"
              hidden
              accept=".xlsx,.csv,.tsv,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = "";
              }}
            />
          </div>
          {aiEnabled && (
            <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-4" aria-label="Generar con IA">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-primary" /> Generar tareas con IA
              </p>
              <p className="text-xs text-muted-foreground">Claude lee un PDF, una imagen (por ejemplo, la foto de un pizarrón) o el texto de arriba y propone tareas. Nada se crea hasta que revises y confirmes.</p>
              {generate.isPending || uploadForAi.isPending ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Spinner className="size-4" /> {uploadForAi.isPending ? "Subiendo el archivo…" : "Leyendo el material y armando las tareas…"}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {!!files.data?.files.some((f) => f.aiReadable) && (
                    <>
                      <Select aria-label="Archivo del tablero" className="h-9 w-auto max-w-64" value={aiPick} onChange={(e) => setAiPick(e.target.value)}>
                        <option value="">Elegí un archivo del tablero…</option>
                        {files.data.files.filter((f) => f.aiReadable).map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.fileName}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" disabled={!aiPick} onClick={() => generate.mutate({ fileId: aiPick })}>
                        <Sparkles /> Generar
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => aiFile.current?.click()}>
                    <Upload /> Subir PDF o imagen
                  </Button>
                  <Button size="sm" variant="secondary" disabled={!text.trim()} onClick={() => generate.mutate({ text })}>
                    Usar el texto pegado
                  </Button>
                  <input
                    ref={aiFile}
                    type="file"
                    hidden
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadForAi.mutate(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}
              {generate.error && <Alert>{generate.error instanceof ApiError ? generate.error.message : "No se pudo generar con IA."}</Alert>}
            </section>
          )}
          <div className="flex gap-3 rounded-2xl bg-muted p-4 text-xs text-muted-foreground">
            <FileSpreadsheet className="size-5 shrink-0" />
            <p>
              En la planilla, la primera fila puede tener encabezados: <strong>Título</strong>, Descripción, Lista, Responsable, Prioridad, Vencimiento, Puntos, Etiquetas,
              Tarea principal y Etapa. Copiar celdas de Excel y pegarlas acá también funciona.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {results && (
            <Alert tone="success">
              Se crearon {results.length} tareas.
              {results.some((r) => r.issueNumber) && ` ${results.filter((r) => r.issueNumber).length} issues en GitHub.`}
              {results.some((r) => r.error) && ` ${results.filter((r) => r.error).length} issues no se pudieron crear (ver la tabla).`}
            </Alert>
          )}
          <div className="max-h-[55vh] overflow-auto rounded-2xl border scroll-thin">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 pl-4">Título</th>
                  <th className="px-2 py-2">Lista</th>
                  <th className="px-2 py-2">Responsable</th>
                  <th className="px-2 py-2">Prioridad</th>
                  <th className="px-2 py-2">Vence</th>
                  <th className="px-2 py-2">Puntos</th>
                  <th className="px-2 py-2">Etiquetas</th>
                  <th className="px-2 py-2 pr-4">
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => {
                  const res = results?.[i];
                  const err = serverErrors[i];
                  return (
                    <tr key={i} className={cn((err || !r.title.trim()) && "bg-destructive/5")}>
                      <td className="px-2 py-2 pl-4">
                        <div className="flex items-center gap-1.5">
                          {(r.isSubtask || r.parentTitle) && <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-label="Subtarea" />}
                          <input className={cell} aria-label={`Título de la fila ${i + 1}`} value={r.title} maxLength={200} disabled={!!results} onChange={(e) => update(i, { title: e.target.value })} />
                        </div>
                        {(warnings[i]?.length || err || res?.error) && (
                          <p className={cn("mt-1 pl-1 text-xs", err || res?.error ? "text-destructive" : "text-amber-600 dark:text-amber-300")}>
                            {[err, res?.error, ...(warnings[i] ?? [])].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {res?.issueNumber && <p className="mt-1 pl-1 text-xs text-success">Issue #{res.issueNumber}</p>}
                      </td>
                      <td className="px-2 py-2">
                        <select className={cell} aria-label={`Lista de la fila ${i + 1}`} disabled={!!results} value={findList(r.listName) ?? ""} onChange={(e) => update(i, { listName: data.lists.find((l) => l.id === e.target.value)?.name ?? "" })}>
                          <option value="">{r.isSubtask ? "La de la tarea principal" : data.lists[0]?.name}</option>
                          {data.lists.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select className={cell} aria-label={`Responsable de la fila ${i + 1}`} disabled={!!results} value={findPerson(r.ownerName) ?? ""} onChange={(e) => update(i, { ownerName: data.people.find((p) => p.userId === e.target.value)?.email ?? "" })}>
                          <option value="">Sin responsable</option>
                          {data.people.map((p) => (
                            <option key={p.userId} value={p.userId}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <select className={cell} aria-label={`Prioridad de la fila ${i + 1}`} disabled={!!results} value={r.priority} onChange={(e) => update(i, { priority: e.target.value as DraftRow["priority"] })}>
                          <option value="none">—</option>
                          <option value="low">Baja</option>
                          <option value="medium">Media</option>
                          <option value="high">Alta</option>
                          <option value="urgent">Urgente</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input type="date" className={cell} aria-label={`Vencimiento de la fila ${i + 1}`} disabled={!!results} value={r.due} onChange={(e) => update(i, { due: e.target.value })} />
                      </td>
                      <td className="w-24 px-2 py-2">
                        <input type="number" min={0} step={0.5} className={cell} aria-label={`Puntos de la fila ${i + 1}`} disabled={!!results} value={r.estimate} onChange={(e) => update(i, { estimate: e.target.value })} />
                      </td>
                      <td className="px-2 py-2">
                        <input className={cell} aria-label={`Etiquetas de la fila ${i + 1}`} placeholder="a, b" disabled={!!results} value={r.labels} onChange={(e) => update(i, { labels: e.target.value })} />
                      </td>
                      <td className="px-2 py-2 pr-4">
                        {!results && (
                          <Button variant="ghost" size="icon-sm" aria-label={`Quitar la fila ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                            <Trash2 className="text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {repo.data?.repo && !results && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={createIssues} onChange={(e) => setCreateIssues(e.target.checked)} />
                Crear también como issues en {repo.data.repo.fullName}
              </label>
            )}
            <span className="flex-1" />
            {results ? (
              <Button
                onClick={() => {
                  onOpenChange(false);
                  reset();
                }}
              >
                Listo
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setRows(null)}>
                  Volver
                </Button>
                <Button loading={submit.isPending} disabled={invalid || rows.length === 0} onClick={() => submit.mutate()}>
                  Crear {rows.length} tarea{rows.length === 1 ? "" : "s"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
