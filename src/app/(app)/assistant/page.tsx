import { redirect } from "next/navigation";

// La IA vive en una sola sección: se conserva la dirección anterior.
export default function AssistantPage() {
  redirect("/ia");
}
