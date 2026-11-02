"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import { PasswordRequirements } from "@/components/ui/password-requirements";
import { PASSWORD_RULES, passwordContainsEmail } from "@/lib/password-policy";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const passwordReady = PASSWORD_RULES.every((rule) => rule.test(form.password)) && !passwordContainsEmail(form.password, form.email);
  const canSubmit = !!form.name.trim() && !!form.email.trim() && passwordReady && form.password === confirmation;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    if (!canSubmit) {
      const nextErrors: Record<string, string> = {};
      if (!form.name.trim()) nextErrors.name = "Ingresá tu nombre";
      if (!form.email.trim()) nextErrors.email = "Ingresá tu correo";
      if (!passwordReady) nextErrors.password = "Completá los requisitos de la contraseña";
      if (!confirmation || confirmation !== form.password) nextErrors.confirmation = "Las contraseñas no coinciden";
      setErrors(nextErrors);
      return;
    }
    setLoading(true);
    try {
      await api("/auth/register", { method: "POST", body: form });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      else setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="register-form">
        <h1 className="login-title">Revisá tu correo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Si <strong className="text-foreground">{form.email}</strong> es válido, te enviamos un enlace para confirmar la cuenta. Vence en 24 horas.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <div className="register-form">
      <h1 className="login-title">Crear cuenta</h1>
      <p className="login-description">Tu próximo proyecto empieza acá.</p>
      <form onSubmit={submit} className="login-fields register-fields" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="register-inputs">
        <div>
          <div className="login-input-wrap">
            <label htmlFor="name" className="sr-only">Nombre</label><UserRound aria-hidden className="login-input-icon" />
            <Input className="login-input" id="name" autoComplete="name" maxLength={80} placeholder="Tu nombre" required aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-error" : undefined} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          {errors.name && <p id="name-error" className="mt-2 text-xs text-destructive" role="alert">{errors.name}</p>}
        </div>
        <div>
          <div className="login-input-wrap">
            <label htmlFor="email" className="sr-only">Correo</label><Mail aria-hidden className="login-input-icon" />
            <Input className="login-input" id="email" type="email" autoComplete="email" placeholder="Tu correo electrónico" required aria-invalid={!!errors.email} aria-describedby={errors.email ? "email-error" : undefined} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          {errors.email && <p id="email-error" className="mt-2 text-xs text-destructive" role="alert">{errors.email}</p>}
        </div>
        <div>
          <div className="login-input-wrap">
            <label htmlFor="password" className="sr-only">Contraseña</label><LockKeyhole aria-hidden className="login-input-icon" />
            <Input className="login-input login-password" id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Contraseña" required minLength={8} maxLength={128} aria-invalid={!!errors.password} aria-describedby={errors.password ? "password-error password-requirements" : "password-requirements"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" className="login-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword}>{showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</button>
          </div>
          {errors.password && <p id="password-error" className="mt-2 text-xs text-destructive" role="alert">{errors.password}</p>}
        </div>
        <div>
          <div className="login-input-wrap">
            <label htmlFor="confirm-password" className="sr-only">Repetir contraseña</label><LockKeyhole aria-hidden className="login-input-icon" />
            <Input className="login-input login-password" id="confirm-password" type={showConfirmation ? "text" : "password"} autoComplete="new-password" placeholder="Repetir contraseña" required maxLength={128} aria-invalid={!!errors.confirmation || (!!confirmation && confirmation !== form.password)} aria-describedby={errors.confirmation ? "confirmation-error password-requirements" : "password-requirements"} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            <button type="button" className="login-password-toggle" onClick={() => setShowConfirmation(!showConfirmation)} aria-label={showConfirmation ? "Ocultar confirmación" : "Mostrar confirmación"} aria-pressed={showConfirmation}>{showConfirmation ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</button>
          </div>
          {errors.confirmation && <p id="confirmation-error" className="mt-2 text-xs text-destructive" role="alert">{errors.confirmation}</p>}
        </div>
        </div>
        <PasswordRequirements password={form.password} confirmation={confirmation} email={form.email} />
        <Button type="submit" className="login-submit w-full" loading={loading} disabled={!canSubmit}>
          Crear cuenta
          <ArrowRight aria-hidden className="size-5" />
        </Button>
      </form>
      <p className="login-register">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Iniciá sesión
        </Link>
      </p>
    </div>
  );
}
