"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Blocks, KanbanSquare, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiMark } from "@/components/ai/ai-kit";
import { useOrg } from "@/components/shell/org-context";
import { Dialog } from "@/components/ui/overlay";
import { Button, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { KINDS, PIPELINE, type DesignProjectSummary } from "@/lib/design";
import { ago } from "@/lib/format";
import type { WorkspaceTree } from "@/lib/types";
import { cn } from "@/lib/utils";

const IDEAS = [
  "Un sistema de turnos para un consultorio médico: pacientes reservan online, recepción confirma, profesionales ven su agenda y se envían recordatorios por WhatsApp.",
  "Una app de pedidos para un restaurante con delivery: menú, carrito, pago con Mercado Pago, cocina que recibe las comandas y repartidores con seguimiento.",
  "Un sistema de inventario para una ferretería con 3 sucursales: stock por sucursal, transferencias, alertas de reposición y reportes de ventas.",
];

export function StudioHome() {
  const { orgId } = useOrg();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["design-projects", orgId], queryFn: () => api<{ projects: DesignProjectSummary[] }>(`/orgs/${orgId}/design-projects`), enabled: !!orgId });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title={
          <>
            Estudio de <span className="ai-text">software</span>
          </>
        }
        subtitle="Diseñá sistemas desde cero con IA: visión, requisitos, casos de uso, diagramas, arquitectura y plan de proyecto, todo vinculado a tus espacios y tableros."
        actions={
          <Button className="ai-cta" onClick={() => setCreating(true)} disabled={!orgId}>
            <Plus /> Nuevo proyecto
          </Button>
        }
      />
      {q.error ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : !q.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : q.data.projects.length === 0 ? (
        <div className="ai-surface rounded-[2rem] p-8 text-center sm:p-12">
          <AiMark size="lg" className="mx-auto" />
          <p className="mt-4 text-xl font-semibold">Tu primer sistema, de la idea al tablero</p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Contá la idea en tus palabras y la IA arma la documentación completa. Después la convertís en un tablero con etapas y tareas estimadas.</p>
          <div className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2">
            {PIPELINE.map((p) => {
              const K = KINDS[p.kind];
              return (
                <span key={p.kind} className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-1 text-xs">
                  <K.icon className="size-3.5" /> {K.short}
                </span>
              );
            })}
          </div>
          <Button className="ai-cta mt-7" size="lg" onClick={() => setCreating(true)}>
            <Sparkles /> Empezar un proyecto
          </Button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.projects.map((p) => (
            <li key={p.id}>
              <Link href={`/studio/${p.id}`} className="project-tile group flex h-full flex-col rounded-[1.75rem] border bg-card p-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
                    <Blocks className="size-5 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.workspaceName} · {ago(p.updatedAt)}
                    </p>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                {p.brief && <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{p.brief}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-1 pt-4">
                  {PIPELINE.filter((x, i, a) => a.findIndex((y) => y.kind === x.kind) === i).map((x) => {
                    const K = KINDS[x.kind];
                    const done = p.kinds.includes(x.kind);
                    return (
                      <span key={x.kind} title={`${K.label}${done ? "" : " (falta)"}`} className={cn("flex size-6 items-center justify-center rounded-lg [&_svg]:size-3", done ? K.tone : "bg-muted/60 text-muted-foreground/40")}>
                        <K.icon />
                      </span>
                    );
                  })}
                  {p.boardId && (
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <KanbanSquare className="size-3.5" /> con tablero
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && orgId && <NewProjectDialog orgId={orgId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewProjectDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const router = useRouter();
  const tree = useQuery({ queryKey: ["workspaces", orgId], queryFn: () => api<WorkspaceTree>(`/orgs/${orgId}/workspaces`) });
  const editable = tree.data?.workspaces.filter((w) => w.role === "admin" || w.role === "member") ?? [];
  const [workspaceId, setWorkspaceId] = useState("");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const ws = workspaceId || editable[0]?.id || "";
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/orgs/${orgId}/design-projects`, { method: "POST", body: { workspaceId: ws, name, brief } }),
    onSuccess: (r) => router.push(`/studio/${r.id}`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Nuevo proyecto de software" description="Contá la idea con el mayor detalle posible: quiénes lo usan, qué procesos resuelve y qué restricciones hay." wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
          <Field label="Nombre" htmlFor="np-name">
            <Input id="np-name" autoFocus maxLength={120} placeholder="Por ejemplo: Turnos Online" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Espacio de trabajo" htmlFor="np-ws">
            <Select id="np-ws" value={ws} onChange={(e) => setWorkspaceId(e.target.value)}>
              {editable.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Idea del sistema" htmlFor="np-brief" hint="Podés editarla después. También vas a poder sumar PDFs o imágenes de los tableros del espacio.">
          <Textarea id="np-brief" rows={8} maxLength={8000} placeholder="¿Qué problema resuelve? ¿Quiénes lo usan? ¿Qué tiene que poder hacer cada uno?" value={brief} onChange={(e) => setBrief(e.target.value)} />
        </Field>
        {!brief && (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">¿Sin idea a mano? Probá con un ejemplo:</p>
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((i) => (
                <button key={i} type="button" onClick={() => { setBrief(i); if (!name) setName(i.split(":")[0]!.replace(/^Un[a]? /, "").slice(0, 60).replace(/^./, (c) => c.toUpperCase())); }} className="max-w-full truncate rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                  {i.split(":")[0]}
                </button>
              ))}
            </div>
          </div>
        )}
        {tree.data && editable.length === 0 && <p className="text-sm text-destructive">Necesitás ser miembro de algún espacio de trabajo para crear proyectos.</p>}
        {create.error && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}
        <div className="flex justify-end">
          <Button type="submit" className="ai-cta" loading={create.isPending} disabled={!name.trim() || !ws}>
            Crear proyecto
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
