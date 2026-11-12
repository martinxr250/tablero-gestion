import type { Metadata } from "next";
import { AiHub } from "@/components/ai/ai-hub";

export const metadata: Metadata = { title: "IA" };

export default async function AiPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <AiHub tab={tab === "estudio" ? "estudio" : "asistente"} />;
}
