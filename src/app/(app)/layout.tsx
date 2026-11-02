import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { getPageAuth } from "@/server/auth/current-user";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await getPageAuth();
  const path = (await headers()).get("x-pathname") ?? "/dashboard";
  if (auth.status === "refresh") redirect(`/api/v1/auth/refresh-redirect?next=${encodeURIComponent(path)}`);
  if (auth.status === "anonymous") redirect(`/login?next=${encodeURIComponent(path)}`);
  if (!auth.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(auth.user.email)}`);
  const { id, name, email, avatarKey } = auth.user;
  return <AppShell user={{ id, name, email, hasAvatar: Boolean(avatarKey) }}>{children}</AppShell>;
}
