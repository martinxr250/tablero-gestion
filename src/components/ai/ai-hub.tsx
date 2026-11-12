"use client";

import { Blocks, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { AssistantChat } from "@/components/assistant/assistant-chat";
import { StudioHome } from "@/components/studio/studio-home";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "asistente", href: "/ia", label: "Asistente", icon: MessagesSquare },
  { key: "estudio", href: "/ia?tab=estudio", label: "Estudio de software", icon: Blocks },
] as const;

/** Toda la IA en un lugar: el asistente que conversa y actúa, y el Estudio que diseña sistemas. */
export function AiHub({ tab }: { tab: "asistente" | "estudio" }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Secciones de IA" className="flex shrink-0 items-center gap-1 border-b px-4 py-2 sm:px-6">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
              tab === t.key ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </Link>
        ))}
      </nav>
      <div className={cn("min-h-0 flex-1", tab === "estudio" && "overflow-y-auto scroll-thin")}>{tab === "estudio" ? <StudioHome /> : <AssistantChat />}</div>
    </div>
  );
}
