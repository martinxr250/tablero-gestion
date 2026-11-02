"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
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
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Recuperar contraseña</h1>
      <p className="mt-1 text-sm text-muted-foreground">Te enviamos un enlace para elegir una nueva.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {message && <Alert tone="success">{message}</Alert>}
        {error && <Alert>{error}</Alert>}
        <Field label="Correo" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Enviar enlace
        </Button>
      </form>
      <Link href="/login" className="mt-6 inline-block text-sm text-primary hover:underline">
        Volver a iniciar sesión
      </Link>
    </div>
  );
}
