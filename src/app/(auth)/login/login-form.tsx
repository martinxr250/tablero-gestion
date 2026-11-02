"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
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
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{step === "password" ? "Iniciar sesión" : "Verificación en dos pasos"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {step === "password" ? "Entrá con tu correo y contraseña." : "Ingresá el código de 6 dígitos de tu app autenticadora o un código de recuperación."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {params.get("reset") === "1" && <Alert tone="success">Contraseña actualizada. Iniciá sesión.</Alert>}
        {error && (
          <Alert>
            {error.message}
            {error.code === "email_not_verified" && (
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
            <Field label="Correo" htmlFor="email">
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Contraseña" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                Olvidé mi contraseña
              </Link>
            </div>
          </>
        ) : (
          <Field label="Código" htmlFor="code">
            <Input id="code" inputMode="text" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        <Button type="submit" className="w-full" loading={loading}>
          {step === "password" ? "Entrar" : "Verificar"}
        </Button>
      </form>
      {step === "password" && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿No tenés cuenta?{" "}
          <Link href={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-primary hover:underline">
            Registrate
          </Link>
        </p>
      )}
    </div>
  );
}
