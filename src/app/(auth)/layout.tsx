import "./auth.css";
import type { ReactNode } from "react";
import { AuthArtwork } from "@/components/ui/auth-artwork";
import { Logo } from "@/components/ui/logo";
import { BRAND_NAME } from "@/lib/brand";
import { ThemeSwitch } from "@/components/ui/theme-switch";

function AuthBrand({ className = "" }: { className?: string }) {
  return <div className={`auth-brand ${className}`}><Logo className="auth-brand-icon" /><div><span className="auth-brand-name">{BRAND_NAME}</span></div></div>;
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <ThemeSwitch />
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
          {children}
        </section>
      </div>
    </main>
  );
}
