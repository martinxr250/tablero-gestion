import { redirect } from "next/navigation";
import { getPageAuth } from "@/server/auth/current-user";

export default async function Home() {
  const auth = await getPageAuth();
  if (auth.status === "ok") redirect("/dashboard");
  if (auth.status === "refresh") redirect("/api/v1/auth/refresh-redirect?next=/dashboard");
  redirect("/login");
}
