import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="size-10" />
        <span className="leading-tight">
          <span className="block text-xl font-bold tracking-tight">Tableros</span>
          <span className="block text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Gestión de proyectos</span>
        </span>
      </div>
      <div className="w-full max-w-[26rem] rounded-[1.75rem] border bg-card p-8 shadow-card">{children}</div>
      <p className="mt-6 text-xs text-muted-foreground">Tableros · organizá el trabajo de tu equipo</p>
    </main>
  );
}
