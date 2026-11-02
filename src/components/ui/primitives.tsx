"use client";

import { Loader2 } from "lucide-react";
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { Alert as UiAlert, AlertDescription } from "@/components/ui/alert";
import { Button as UiButton } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Input as UiInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton as UiSkeleton } from "@/components/ui/skeleton";
import { Textarea as UiTextarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Capa fina sobre shadcn/ui: mantiene una API estable para las pantallas de la app.

const VARIANT = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
  soft: "soft",
  brand: "brand",
} as const;
const SIZE = { sm: "sm", md: "default", lg: "lg", icon: "icon", "icon-sm": "icon-sm" } as const;

export type ButtonProps = Omit<ComponentProps<typeof UiButton>, "variant" | "size"> & {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <UiButton ref={ref} type={type} variant={VARIANT[variant]} size={SIZE[size]} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </UiButton>
  );
});

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(props, ref) {
  return <UiInput ref={ref} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea(props, ref) {
  return <UiTextarea ref={ref} {...props} />;
});

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <NativeSelect className={className} {...(props as ComponentProps<typeof NativeSelect>)} />;
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "info" | "success"; children: ReactNode }) {
  return (
    <UiAlert
      variant={tone === "danger" ? "destructive" : "default"}
      role={tone === "danger" ? "alert" : "status"}
      className={cn(tone === "info" && "border-primary/20 bg-primary-soft text-primary", tone === "success" && "border-success/30 bg-success/10 text-success")}
    >
      <AlertDescription className="text-current">{children}</AlertDescription>
    </UiAlert>
  );
}

/** Chip compacto de color libre (etiquetas, prioridad). */
export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", className)}>{children}</span>;
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn("size-5 animate-spin text-muted-foreground", className)} aria-label="Cargando" />
);

export const Skeleton = ({ className }: { className?: string }) => <UiSkeleton className={cn("rounded-2xl", className)} />;

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <UiCard className={cn("gap-0 rounded-3xl py-0 shadow-card ring-0", className)} {...props} />;
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed bg-card/60 px-6 py-12 text-center">
      {icon && <div className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-primary-soft text-primary [&_svg]:size-5">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="font-semibold">No pudimos cargar esta sección</p>
      <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Error inesperado"}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
