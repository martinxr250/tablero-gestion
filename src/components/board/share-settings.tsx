"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Link2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Select, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";

type LinkInfo = { enabled: boolean; url: string | null; role: "viewer" | "commenter" | "editor" | null };
type Share = { public: LinkInfo; join: LinkInfo };

function CopyField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} aria-label="Enlace" onFocus={(e) => e.target.select()} className="font-mono text-xs" />
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

/** Enlaces para compartir: uno público de solo lectura y otro para unirse con cuenta. */
export function ShareSettings({ boardId }: { boardId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["share", boardId], queryFn: () => api<Share>(`/boards/${boardId}/share`) });
  const set = useMutation({
    mutationFn: (v: { kind: "public" | "join"; enabled: boolean; role?: string; regenerate?: boolean }) =>
      api<LinkInfo>(`/boards/${boardId}/share/${v.kind}`, { method: "PUT", body: { enabled: v.enabled, role: v.role, regenerate: v.regenerate } }),
    onSuccess: (_d, v) => toast.success(v.regenerate ? "Enlace nuevo generado; el anterior ya no funciona" : v.enabled ? "Enlace actualizado" : "Enlace desactivado"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["share", boardId] }),
  });
  if (!q.data) return <Skeleton className="h-64" />;
  const { public: pub, join } = q.data;

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border p-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={pub.enabled} disabled={set.isPending} onChange={(e) => set.mutate({ kind: "public", enabled: e.target.checked })} />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Globe className="size-4" /> Enlace público de solo lectura
            </span>
            <span className="block text-xs text-muted-foreground">Cualquiera con el enlace ve el tablero sin cuenta. No ve comentarios, adjuntos ni correos, y no puede cambiar nada.</span>
          </span>
        </label>
        {pub.enabled && pub.url && (
          <>
            <CopyField url={pub.url} />
            <Button variant="ghost" size="sm" onClick={() => confirm("El enlace actual dejará de funcionar. ¿Generar uno nuevo?") && set.mutate({ kind: "public", enabled: true, regenerate: true })}>
              <RefreshCw /> Generar enlace nuevo
            </Button>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--primary)]"
            checked={join.enabled}
            disabled={set.isPending}
            onChange={(e) => set.mutate({ kind: "join", enabled: e.target.checked, role: join.role ?? "editor" })}
          />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Link2 className="size-4" /> Enlace para unirse al tablero
            </span>
            <span className="block text-xs text-muted-foreground">
              Quien lo abra inicia sesión (o crea su cuenta) y entra al tablero con el permiso elegido. Las personas de otra organización entran como invitadas y solo ven este tablero.
            </span>
          </span>
        </label>
        {join.enabled && join.url && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Entran con permiso para</span>
              <Select aria-label="Permiso del enlace" className="h-9 w-auto" value={join.role ?? "editor"} onChange={(e) => set.mutate({ kind: "join", enabled: true, role: e.target.value })}>
                <option value="editor">editar</option>
                <option value="commenter">comentar</option>
                <option value="viewer">solo ver</option>
              </Select>
            </div>
            <CopyField url={join.url} />
            <Button variant="ghost" size="sm" onClick={() => confirm("El enlace actual dejará de funcionar. ¿Generar uno nuevo?") && set.mutate({ kind: "join", enabled: true, regenerate: true })}>
              <RefreshCw /> Generar enlace nuevo
            </Button>
          </>
        )}
      </section>
      <p className="text-xs text-muted-foreground">Desactivar o regenerar un enlace corta el acceso de quien solo tenía el enlace anterior. Quienes ya se unieron siguen siendo miembros: quitarlos se hace en Miembros.</p>
    </div>
  );
}
