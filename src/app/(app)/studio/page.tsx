import type { Metadata } from "next";
import { StudioHome } from "@/components/studio/studio-home";

export const metadata: Metadata = { title: "Estudio de software" };

export default function StudioPage() {
  return <StudioHome />;
}
