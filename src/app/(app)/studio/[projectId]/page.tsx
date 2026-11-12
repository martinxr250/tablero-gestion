import { redirect } from "next/navigation";

export default async function StudioProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/ia/estudio/${encodeURIComponent(projectId)}`);
}
