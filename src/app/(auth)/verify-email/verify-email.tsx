"use client";

import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Input, Spinner } from "@/components/ui/primitives";
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
        <h1 className="login-title">¡Correo confirmado!</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <Link href="/login" className="mt-6 inline-flex">
          <Button>Iniciar sesión</Button>
        </Link>
      </div>
    );
  return (
    <div className="login-form">
      <h1 className="login-title">Confirmá tu correo</h1>
      <p className="login-description">Te enviamos un enlace al registrarte. Si venció o no llegó, pedí uno nuevo.</p>
      <form onSubmit={resend} className="login-fields">
        {message && <Alert tone={state === "error" ? "danger" : "info"}>{message}</Alert>}
        <div className="login-input-wrap">
          <label htmlFor="email" className="sr-only">
            Correo
          </label>
          <Mail aria-hidden className="login-input-icon" />
          <Input className="login-input" id="email" type="email" placeholder="Tu correo electrónico" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" className="login-submit w-full" loading={loading}>
          Reenviar enlace
          <ArrowRight aria-hidden className="size-5" />
        </Button>
      </form>
      <p className="login-register">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </div>
  );
}
