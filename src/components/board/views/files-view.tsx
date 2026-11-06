"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, FileText, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/overlay";
import { Button, ErrorState, Skeleton, Spinner } from "@/components/ui/primitives";
import { useAiEnabled } from "@/lib/ai";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

type BoardFile = {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  uploaderName: string | null;
  createdAt: string;
  isImage: boolean;
  canPreview: boolean;
  aiReadable: boolean;
  aiSummary: string | null;
  aiSummaryAt: string | null;
};

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const ext = (name: string) => name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";

/** Archivos del tablero: PDF, imágenes y documentos compartidos por el equipo, con ayuda de IA. */
export function FilesView({ boardId, canEdit, onGenerateTasks }: { boardId: string; canEdit: boolean; onGenerateTasks: (fileId: string) => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<BoardFile | null>(null);
  const aiEnabled = useAiEnabled();
  const key = ["board-files", boardId];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ files: BoardFile[] }>(`/boards/${boardId}/files`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: async (list: File[]) => {
      for (const f of list) {
        const form = new FormData();
        form.set("file", f);
        await api(`/boards/${boardId}/files`, { method: "POST", form });
      }
      return list.length;
    },
    onSuccess: (n) => toast.success(n === 1 ? "Archivo subido" : `${n} archivos subidos`),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/board-files/${id}`, { method: "DELETE" }), onSettled: refresh });
  const summarize = useMutation({
    mutationFn: (id: string) => api<{ summary: string }>(`/board-files/${id}/ai/summary`, { method: "POST" }),
    onSuccess: () => toast.success("Resumen listo"),
    onSettled: refresh,
  });

  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const files = q.data?.files;

  return (
    <div className="h-full overflow-y-auto px-4 pb-8 scroll-thin sm:px-6">
      {canEdit && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const list = [...e.dataTransfer.files];
            if (list.length) upload.mutate(list);
          }}
          className={cn("mb-6 flex flex-col items-center gap-2 rounded-[2rem] border-2 border-dashed p-8 text-center transition-colors", over ? "border-primary bg-primary-soft" : "border-border")}
        >
          {upload.isPending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner className="size-4" /> Subiendo…
            </p>
          ) : (
            <>
              <Upload className="size-6 text-muted-foreground" />
              <p className="text-sm">
                Arrastrá archivos acá o{" "}
                <button className="font-medium text-primary hover:underline" onClick={() => input.current?.click()}>
                  elegilos
                </button>
              </p>
              <p className="text-xs text-muted-foreground">PDF, imágenes, Word, Excel, PowerPoint, texto o CSV · hasta 4 MB cada uno</p>
            </>
          )}
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx,.pptx,.txt,.md,.csv,.zip"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])];
              if (list.length) upload.mutate(list);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {!files ? (
        <Skeleton className="h-48" />
      ) : files.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed p-10 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-2 text-lg">Todavía no hay archivos</p>
          <p className="mt-1 text-sm text-muted-foreground">Subí documentos del proyecto: requisitos, contratos, diseños o fotos del pizarrón.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((f) => (
            <li key={f.id} className="flex flex-col rounded-[1.6rem] border bg-card p-4">
              <div className="flex items-start gap-3">
                {f.isImage ? (
                  <button className="shrink-0" aria-label={`Ver ${f.fileName}`} onClick={() => setPreview(f)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/v1/board-files/${f.id}/download?inline=1`} alt="" className="size-14 rounded-xl object-cover" />
                  </button>
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-bold text-muted-foreground">{ext(f.fileName)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={f.fileName}>
                    {f.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {size(f.sizeBytes)} · {f.uploaderName ?? "—"} · {ago(f.createdAt)}
                  </p>
                </div>
              </div>

              {f.aiSummary && (
                <div className="mt-3 rounded-xl bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-line">
                  <p className="mb-1 flex items-center gap-1 font-semibold text-muted-foreground">
                    <Sparkles className="size-3" /> Resumen con IA
                  </p>
                  {f.aiSummary}
                </div>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                {f.canPreview &&
                  (f.isImage ? (
                    <Button size="sm" variant="ghost" onClick={() => setPreview(f)}>
                      Ver
                    </Button>
                  ) : (
                    <a href={`/api/v1/board-files/${f.id}/download?inline=1`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm hover:bg-muted">
                      Ver <ExternalLink className="size-3.5" />
                    </a>
                  ))}
                <a href={`/api/v1/board-files/${f.id}/download`} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm hover:bg-muted" aria-label={`Descargar ${f.fileName}`}>
                  <Download className="size-3.5" />
                </a>
                {aiEnabled && canEdit && f.aiReadable && (
                  <>
                    <Button size="sm" variant="secondary" loading={summarize.isPending && summarize.variables === f.id} onClick={() => summarize.mutate(f.id)}>
                      <Sparkles /> {f.aiSummary ? "Volver a resumir" : "Resumir"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => onGenerateTasks(f.id)}>
                      <Sparkles /> Crear tareas
                    </Button>
                  </>
                )}
                {canEdit && (
                  <button
                    className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label={`Eliminar ${f.fileName}`}
                    onClick={() => confirm(`¿Eliminar "${f.fileName}"?`) && remove.mutate(f.id)}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {aiEnabled && <p className="mt-6 text-xs text-muted-foreground">Las funciones de IA envían el archivo elegido a Anthropic (Claude) para procesarlo. Solo se envía cuando lo pedís.</p>}

      {preview && (
        <Dialog open onOpenChange={(o) => !o && setPreview(null)} title={preview.fileName} wide>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/v1/board-files/${preview.id}/download?inline=1`} alt={preview.fileName} className="mx-auto max-h-[70vh] rounded-2xl object-contain" />
        </Dialog>
      )}
    </div>
  );
}
