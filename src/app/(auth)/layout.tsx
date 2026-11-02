import "./auth.css";
import type { ReactNode } from "react";
import { AuthArtwork } from "@/components/ui/auth-artwork";
import { BrandWordmark } from "@/components/ui/logo";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { PageTransition } from "@/components/shell/page-transition";
import { LoginBackground } from "@/components/ui/login-background";

function AuthBrand({ className = "" }: { className?: string }) {
  return <div className={`auth-brand ${className}`}><BrandWordmark className="auth-wordmark" /></div>;
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <ThemeSwitch />
      <LoginBackground />
      <div aria-hidden className="auth-corner auth-corner-top" />
      <div aria-hidden className="auth-corner auth-corner-bottom" />
      <div className="auth-grid">
        <section className="auth-presentation" aria-label="Gestión de proyectos en equipo">
          <AuthBrand />
          <div className="auth-intro">
            <h2>Gestioná tus<br />proyectos, <span>en equipo.</span></h2>
            <p>Planificá, asigná y seguí el progreso de tu equipo en un solo lugar.</p>
          </div>
          <AuthArtwork />
        </section>
        <section className="auth-glass-card" aria-label="Acceso a Tableros">
          <AuthBrand className="auth-card-brand" />
          <PageTransition>{children}</PageTransition>
        </section>
      </div>
    </main>
  );
}
