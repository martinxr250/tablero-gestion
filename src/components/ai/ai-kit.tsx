"use client";

import { AlertTriangle, RotateCcw, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/primitives";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// Piezas visuales comunes de la IA: el mismo acento, la misma espera y los mismos errores en todas las pantallas.

/** Marca de IA: chip con degradado y destello. */
export function AiMark({ size = "md", pulse, className }: { size?: "sm" | "md" | "lg"; pulse?: boolean; className?: string }) {
  const box = { sm: "size-6 rounded-lg [&_svg]:size-3.5", md: "size-8 rounded-xl [&_svg]:size-4", lg: "size-11 rounded-2xl [&_svg]:size-5" }[size];
  return (
    <span aria-hidden className={cn("ai-mark inline-flex shrink-0 items-center justify-center", box, pulse && "ai-pulse", className)}>
      <Sparkles />
    </span>
  );
}

/** Espera mientras la IA trabaja: mensajes que avanzan y renglones de muestra. */
export function AiThinking({ steps, lines = 3, compact, className }: { steps: string[]; lines?: number; compact?: boolean; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (steps.length < 2) return;
    const t = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 2600);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className={cn("space-y-3", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <AiMark size={compact ? "sm" : "md"} pulse />
        <p key={i} className="ai-shimmer ai-reveal text-sm font-medium">
          {steps[i]}
        </p>
      </div>
      {lines > 0 && (
        <div className="space-y-2 pl-1" aria-hidden>
          {Array.from({ length: lines }, (_, n) => (
            <div key={n} className="ai-skeleton h-2.5" style={{ width: `${[92, 78, 64, 85, 55][n % 5]}%`, animationDelay: `${n * 120}ms` }} />
          ))}
        </div>
      )}
    </div>
  );
}

const FRIENDLY: Record<string, { title: string; hint?: string }> = {
  ai_quota_exceeded: { title: "Se alcanzó el tope de IA del mes", hint: "La organización usó todo su cupo mensual. Se renueva el mes que viene." },
  ai_busy: { title: "Nuestra IA está con mucha demanda", hint: "Probá de nuevo en unos segundos." },
  ai_refused: { title: "Nuestra IA no pudo responder este pedido", hint: "Probá reformularlo o usar otro material." },
  ai_not_configured: { title: "La IA no está disponible", hint: "Falta configurarla en el servidor." },
  ai_unavailable: { title: "La IA no está disponible", hint: "Probá de nuevo en unos minutos." },
  ai_auth_failed: { title: "La IA no está disponible", hint: "Hay que revisar la configuración del servidor." },
  ai_incomplete: { title: "La respuesta quedó incompleta", hint: "Probá de nuevo; si el material es muy largo, usá uno más corto." },
  ai_bad_input: { title: "Nuestra IA no pudo leer el material", hint: "Revisá que el archivo no esté dañado o protegido con contraseña." },
  assistant_busy: { title: "El asistente sigue trabajando", hint: "Esperá a que termine la respuesta anterior." },
  rate_limited: { title: "Llegaste al límite de pedidos de IA por hora", hint: "Esperá un rato y volvé a intentar." },
};

/** Error de IA explicado en palabras simples, con opción de reintentar. */
export function AiError({ error, retry, className }: { error: unknown; retry?: () => void; className?: string }) {
  const code = error instanceof ApiError ? error.code : "";
  const known = FRIENDLY[code];
  const title = known?.title ?? "No se pudo completar el pedido";
  const hint = known?.hint ?? (error instanceof Error ? error.message : undefined);
  return (
    <div className={cn("ai-reveal flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4", className)} role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {retry && code !== "ai_quota_exceeded" && code !== "ai_not_configured" && (
        <Button size="sm" variant="ghost" onClick={retry}>
          <RotateCcw /> Reintentar
        </Button>
      )}
    </div>
  );
}

/** Nota al pie: qué se envía y que la IA puede equivocarse. */
export function AiNote({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground", className)}>
      <ShieldCheck className="mt-px size-3.5 shrink-0" />
      <span>{children ?? "Generado con IA: puede tener errores, revisalo."}</span>
    </p>
  );
}

/** Bloque de resultado con ícono y título. */
export function AiBlock({ icon: Icon, title, tone = "default", action, children, className, style }: { icon: LucideIcon; title: string; tone?: "default" | "risk" | "good"; action?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const toneCls = { default: "text-[var(--ai-via)] bg-[color-mix(in_oklch,var(--ai-via)_10%,transparent)]", risk: "text-amber-600 bg-amber-500/10 dark:text-amber-400", good: "text-success bg-success/10" }[tone];
  return (
    <section className={cn("ai-reveal rounded-2xl border bg-card p-4", className)} style={style}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className={cn("flex size-7 items-center justify-center rounded-lg [&_svg]:size-3.5", toneCls)}>
          <Icon />
        </span>
        <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Opción seleccionable de una sugerencia (subtarea, ítem de checklist). */
export function AiPick({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors",
        checked ? "border-[color-mix(in_oklch,var(--ai-via)_40%,var(--border))] ai-soft" : "border-transparent hover:bg-muted/60",
      )}
    >
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--ai-via)]" checked={checked} onChange={onChange} />
      <span className={cn(!checked && "text-muted-foreground")}>{children}</span>
    </label>
  );
}
