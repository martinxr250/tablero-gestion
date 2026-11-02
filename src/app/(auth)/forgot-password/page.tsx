"use client";

import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Input } from "@/components/ui/primitives";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ message: string }>("/auth/forgot-password", { method: "POST", body: { email } });
      setMessage(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-form">
      <h1 className="login-title">Recuperar contraseña</h1>
      <p className="login-description">Te enviamos un enlace para elegir una nueva.</p>
      <form onSubmit={submit} className="login-fields" noValidate>
        {message && <Alert tone="success">{message}</Alert>}
        <div className="login-input-wrap">
          <label htmlFor="email" className="sr-only">
            Correo
          </label>
          <Mail aria-hidden className="login-input-icon" />
          <Input
            className="login-input"
            id="email"
            type="email"
            autoComplete="email"
            placeholder="Tu correo electrónico"
            required
            value={email}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "email-error" : undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </div>
        {error && (
          <p id="email-error" role="alert" className="login-field-error">
            {error}
          </p>
        )}
        <Button type="submit" className="login-submit w-full" loading={loading} disabled={!email.trim()}>
          Enviar enlace
          <ArrowRight aria-hidden className="size-5" />
        </Button>
      </form>
      <p className="login-register">
        ¿Te acordaste?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </div>
  );
}
