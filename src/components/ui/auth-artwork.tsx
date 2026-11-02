"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ArtworkKind } from "@/components/ui/artwork";

const artByRoute: Record<string, ArtworkKind> = {
  "/forgot-password": "security-access",
  "/reset-password": "security-access",
  "/verify-email": "notifications",
};

export function AuthArtwork() {
  const pathname = usePathname();
  const source = pathname === "/register" ? "/assets/3d/tableros-register-hd.webp" : artByRoute[pathname] ? `/assets/3d/${artByRoute[pathname]}.webp` : "/assets/3d/tableros-login-hd.webp";
  // Keep the original render's detail instead of applying a second lossy conversion.
  return <div aria-hidden className="auth-visual"><div className="auth-visual-halo" /><Image src={source} alt="" width={1254} height={1254} unoptimized className="auth-visual-object" /></div>;
}
