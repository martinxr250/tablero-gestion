import Image from "next/image";
import { cn } from "@/lib/utils";

export type ArtworkKind = "floating-tasks" | "connected-projects" | "collaboration" | "integrations" | "assistant-core" | "team-activity" | "notifications" | "search-discovery" | "security-access";

export function Artwork({ kind, className, sizes = "128px" }: { kind: ArtworkKind; className?: string; sizes?: string }) {
  return <Image src={`/assets/3d/${kind}.webp`} alt="" aria-hidden width={512} height={512} sizes={sizes} className={cn("pointer-events-none shrink-0 object-contain select-none", className)} />;
}

const marks = ["layers", "orbit", "modules", "bridge", "path", "prism", "focus", "weave"] as const;
const patterns = ["workflow", "orbits", "steps", "nodes", "contours"] as const;

function visualIndex(seed: string) {
  return Array.from(seed).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
}

export function projectPattern(seed: string) {
  return `/assets/patterns/${patterns[visualIndex(seed) % patterns.length]}.svg`;
}

/** A CSS mask keeps each project's existing color in both themes. */
export function ProjectMark({ seed, className }: { seed: string; className?: string }) {
  const mask = `url('/assets/project-icons/${marks[visualIndex(seed) % marks.length]}.svg') center / contain no-repeat`;
  return <span aria-hidden className={cn("inline-block size-5 shrink-0 bg-current", className)} style={{ mask, WebkitMask: mask }} />;
}
