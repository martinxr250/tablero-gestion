"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/api";

export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"idle" | "verifying" | "ok" | "error">(token ? "verifying" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api<{ message: string }>("/auth/verify-email", { method: "POST", body: { token } })
      .then((r) => {
        setState("ok");
        setMessage(r.message);
      })
      .catch((e) => {
        setState("error");
        setMessage(e.message);
      });
  }, [token]);

  async function resend(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api<{ message: string }>("/auth/resend-verification", { method: "POST", body: { email } });
      setMessage(r.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  if (state === "verifying") return <Spinner />;
  if (state === "ok")
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">¡Correo confirmado!</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Link href="/login" className="mt-6 inline-flex">
          <Button>Iniciar sesión</Button>
        </Link>
      </div>
    );
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Confirmá tu correo</h1>
      <p className="mt-1 text-sm text-muted-foreground">Te enviamos un enlace al registrarte. Si venció o no llegó, pedí uno nuevo.</p>
      <form onSubmit={resend} className="mt-6 space-y-4">
        {message && <Alert tone={state === "error" ? "danger" : "info"}>{message}</Alert>}
        <Field label="Correo" htmlFor="email">
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Reenviar enlace
        </Button>
      </form>
    </div>
  );
}
