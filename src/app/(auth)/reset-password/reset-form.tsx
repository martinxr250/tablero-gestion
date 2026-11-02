"use client";

import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PasswordRequirements } from "@/components/ui/password-requirements";
import { Alert, Button, Input } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Las contraseñas no coinciden");
    setError(null);
    setLoading(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password } });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError && err.details ? err.details.map((d) => d.message).join(". ") : err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="login-form">
        <h1 className="login-title">Enlace no válido</h1>
        <p className="login-description">Pedí uno nuevo desde la recuperación de contraseña.</p>
        <p className="login-register">
          <Link href="/forgot-password" className="font-medium text-primary hover:underline">
            Recuperar contraseña
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="login-form">
      <h1 className="login-title">Nueva contraseña</h1>
      <p className="login-description">Se cerrarán todas tus sesiones abiertas.</p>
      <form onSubmit={submit} className="login-fields" noValidate>
        {error && error !== "Las contraseñas no coinciden" && <Alert>{error}</Alert>}
        <div className="login-input-wrap">
          <label htmlFor="password" className="sr-only">
            Contraseña nueva
          </label>
          <LockKeyhole aria-hidden className="login-input-icon" />
          <Input
            className="login-input login-password"
            id="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Contraseña nueva"
            required
            minLength={8}
            maxLength={128}
            aria-describedby="password-requirements"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="button" className="login-password-toggle" onClick={() => setShow(!show)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={show}>
            {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </button>
        </div>
        <div className="login-input-wrap">
          <label htmlFor="confirm" className="sr-only">
            Repetir contraseña
          </label>
          <LockKeyhole aria-hidden className="login-input-icon" />
          <Input
            className="login-input"
            id="confirm"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Repetir contraseña"
            required
            value={confirm}
            aria-invalid={error === "Las contraseñas no coinciden" ? true : undefined}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (error) setError(null);
            }}
          />
        </div>
        {error === "Las contraseñas no coinciden" && (
          <p role="alert" className="login-field-error">
            {error}
          </p>
        )}
        <PasswordRequirements password={password} confirmation={confirm} />
        <Button type="submit" className="login-submit w-full" loading={loading}>
          Guardar contraseña
          <ArrowRight aria-hidden className="size-5" />
        </Button>
      </form>
    </div>
  );
}
