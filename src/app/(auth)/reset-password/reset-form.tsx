"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";

export function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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

  if (!token) return <Alert>El enlace no es válido.</Alert>;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Nueva contraseña</h1>
      <p className="mt-1 text-sm text-muted-foreground">Se cerrarán todas tus sesiones abiertas.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Contraseña nueva" htmlFor="password" hint="Mínimo 10 caracteres.">
          <Input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Repetir contraseña" htmlFor="confirm">
          <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Guardar contraseña
        </Button>
      </form>
    </div>
  );
}
