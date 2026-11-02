"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import { safeNext } from "../safe-next";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Credenciales o código incorrectos se muestran en el campo; el resto, arriba del formulario.
  const fieldError = error && (error.code === "invalid_credentials" || error.code === "invalid_code") ? error.message : null;
  const formError = fieldError ? null : error;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (step === "password") {
        const r = await api<{ status: string }>("/auth/login", { method: "POST", body: { email, password } });
        if (r.status === "mfa_required") {
          setStep("mfa");
          return;
        }
      } else {
        await api("/auth/mfa", { method: "POST", body: { code } });
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa_expired") setStep("password");
      setError({ message: err instanceof Error ? err.message : "Error", code: err instanceof ApiError ? err.code : undefined });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-form">
      <h1 className="login-title">{step === "password" ? "Iniciar sesión" : "Verificación en dos pasos"}</h1>
      <p className="login-description">
        {step === "password" ? "Accedé a tu espacio de trabajo." : "Ingresá el código de 6 dígitos de tu app autenticadora o un código de recuperación."}
      </p>
      <form onSubmit={submit} className="login-fields" noValidate>
        {params.get("reset") === "1" && <Alert tone="success">Contraseña actualizada. Iniciá sesión.</Alert>}
        {formError && (
          <Alert>
            {formError.message}
            {formError.code === "email_not_verified" && (
              <>
                {" "}
                <Link className="font-medium underline" href={`/verify-email?email=${encodeURIComponent(email)}`}>
                  Reenviar enlace
                </Link>
              </>
            )}
          </Alert>
        )}
        {step === "password" ? (
          <>
            <div className="login-input-wrap">
              <label htmlFor="email" className="sr-only">Correo</label>
              <Mail aria-hidden className="login-input-icon" />
              <Input className="login-input" id="email" type="email" autoComplete="email" placeholder="Tu correo electrónico" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="login-input-wrap">
              <label htmlFor="password" className="sr-only">Contraseña</label>
              <LockKeyhole aria-hidden className="login-input-icon" />
              <Input
                className="login-input login-password"
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Tu contraseña"
                required
                value={password}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? "password-error" : undefined}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldError) setError(null);
                }}
              />
              <button type="button" className="login-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword}>{showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}</button>
            </div>
            {fieldError && (
              <p id="password-error" role="alert" className="login-field-error">
                {fieldError}
              </p>
            )}
            <div className="login-recovery">
              <Link href="/forgot-password" className="text-primary hover:underline">
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
          </>
        ) : (
          <Field label="Código" htmlFor="code" error={fieldError ?? undefined}>
            <Input
              id="code"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              aria-invalid={fieldError ? true : undefined}
              onChange={(e) => {
                setCode(e.target.value);
                if (fieldError) setError(null);
              }}
            />
          </Field>
        )}
        <Button type="submit" className="login-submit w-full" loading={loading}>
          {step === "password" ? "Entrar" : "Verificar"}
          <ArrowRight aria-hidden className="size-5" />
        </Button>
      </form>
      {step === "password" && (
        <p className="login-register">
          ¿No tenés cuenta?{" "}
          <Link href={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary hover:underline">
            Registrate
          </Link>
        </p>
      )}
    </div>
  );
}
