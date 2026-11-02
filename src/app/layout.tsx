import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers/providers";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Tableros", template: "%s · Tableros" },
  description: "Organizá proyectos, tareas y equipos con tableros Kanban.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eff0f9" },
    { media: "(prefers-color-scheme: dark)", color: "#16171f" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="es" suppressHydrationWarning className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
