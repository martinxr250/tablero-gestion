import { ArrowUpRight } from "lucide-react";
import { ProjectMark, projectPattern } from "@/components/ui/artwork";
import Link from "next/link";
import { asColor, SWATCH, SWATCH_TEXT } from "@/lib/colors";
import { cn } from "@/lib/utils";

export function BoardTile({ id, name, color, meta }: { id: string; name: string; color: string; meta?: string }) {
  const c = asColor(color);
  return (
    <Link href={`/b/${id}`} className="project-tile group relative isolate flex flex-col gap-4 overflow-hidden rounded-3xl border bg-card p-4 shadow-card transition-colors hover:border-primary/30">
      <span aria-hidden style={{ backgroundImage: `url('${projectPattern(id)}')` }} className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-36 bg-contain bg-center bg-no-repeat opacity-[0.12] dark:opacity-[0.08]" />
      <div className="flex items-start justify-between">
        <span className={cn("flex size-11 items-center justify-center rounded-2xl border bg-card", SWATCH_TEXT[c])}>
          <ProjectMark seed={id} />
        </span>
        <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold group-hover:text-primary">{name}</p>
        {meta && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", SWATCH[c])} aria-hidden />
            {meta}
          </p>
        )}
      </div>
    </Link>
  );
}
