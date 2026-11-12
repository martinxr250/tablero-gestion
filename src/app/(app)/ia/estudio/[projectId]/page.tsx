import type { Metadata } from "next";
import { ProjectView } from "@/components/studio/project-view";

export const metadata: Metadata = { title: "Proyecto · Estudio" };

export default async function StudioProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectView projectId={projectId} />;
}
