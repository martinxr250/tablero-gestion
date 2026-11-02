import Image from "next/image";
import { cn } from "@/lib/utils";
import { Artwork, type ArtworkKind } from "@/components/ui/artwork";

export type IllustrationKind = "projects" | "tasks" | "activity" | "search" | "notifications" | "connection" | "integrations" | "assistant";

const renders: Partial<Record<IllustrationKind, ArtworkKind>> = {
  projects: "connected-projects", activity: "team-activity", search: "search-discovery",
  notifications: "notifications", integrations: "integrations", assistant: "assistant-core",
};

/** Decorative assets: the adjacent copy always carries the meaning. */
export function Illustration({ kind, className }: { kind: IllustrationKind; className?: string }) {
  const render = renders[kind];
  if (render) return <Artwork kind={render} className={className} sizes="128px" />;
  return <Image src={`/assets/illustrations/${kind}.svg`} alt="" aria-hidden width={180} height={160} className={cn("pointer-events-none shrink-0 object-contain select-none", className)} />;
}
