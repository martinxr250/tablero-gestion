"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useOrg } from "@/components/shell/org-context";
import { Avatar } from "@/components/ui/user-avatar";
import { Dialog, TabPanel, Tabs } from "@/components/ui/overlay";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";
import { ago, fmtDateTime } from "@/lib/format";

export default function SettingsPage() {
  const [tab, setTab] = useState("profile");
  return (
    <div className="settings-scene w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Mi cuenta" artwork="security-access" />
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "profile", label: "Perfil" },
          { value: "security", label: "Seguridad" },
          { value: "account", label: "Cuenta" },
        ]}
      >
        <TabPanel value="profile">
          <ProfileLoader />
        </TabPanel>
        <TabPanel value="security" className="grid items-start gap-6 xl:grid-cols-2 [&>*:last-child]:xl:col-span-2">
          <ChangePassword />
          <Mfa />
          <Sessions />
        </TabPanel>
        <TabPanel value="account">
          <DeleteAccount />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function ProfileLoader() {
  const { me } = useOrg();
  return me ? <Profile key={me.user.name} me={me} /> : null;
}

function Profile({ me }: { me: NonNullable<ReturnType<typeof useOrg>["me"]> }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.user.name);
  const file = useRef<HTMLInputElement>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["me"] });
    // fuerza a recargar la imagen del avatar
    setTimeout(() => location.reload(), 300);
  };
  const save = useMutation({
    mutationFn: () => api("/me", { method: "PATCH", body: { name } }),
    onSuccess: () => {
      toast.success("Perfil actualizado");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const upload = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.set("file", f);
      return api("/me/avatar", { method: "POST", form });
    },
    onSuccess: refresh,
  });
  const removeAvatar = useMutation({ mutationFn: () => api("/me/avatar", { method: "DELETE" }), onSuccess: refresh });
  return (
    <Card className="grid gap-8 p-6 lg:grid-cols-[18rem_1fr] lg:p-8">
      <div className="flex items-center gap-4 lg:flex-col lg:items-start">
        <Avatar user={me.user} size={96} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => file.current?.click()}>
            Cambiar foto
          </Button>
          {me.user.hasAvatar && (
            <Button variant="ghost" size="sm" onClick={() => removeAvatar.mutate()}>
              Quitar
            </Button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size > 1024 * 1024) toast.error("La imagen supera 1 MB");
              else if (f) upload.mutate(f);
            }}
          />
          <p className="w-full text-xs text-muted-foreground">PNG, JPEG, GIF o WebP · máx. 1 MB</p>
        </div>
      </div>
      <form
        className="grid content-start gap-4 md:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nombre" htmlFor="p-name">
          <Input id="p-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Correo" htmlFor="p-email" hint="El correo no se puede cambiar.">
          <Input id="p-email" value={me.user.email} disabled />
        </Field>
        <div className="md:col-span-2">
          <Button type="submit" loading={save.isPending} disabled={!name.trim() || name === me.user.name}>
            Guardar
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api("/me/password", { method: "POST", body: { currentPassword: form.currentPassword, newPassword: form.newPassword } }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success("Contraseña actualizada. Cerramos tus otras sesiones.");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      setError(null);
    },
    onError: (e) => setError(e instanceof ApiError && e.details ? e.details.map((d) => d.message).join(". ") : (e as Error).message),
  });
  return (
    <Card className="p-6">
      <h2 className="mb-4 font-semibold">Contraseña</h2>
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (form.newPassword !== form.confirm) return setError("Las contraseñas no coinciden");
          change.mutate();
        }}
      >
        {error && <Alert>{error}</Alert>}
        <Field label="Contraseña actual" htmlFor="pw-current">
          <Input id="pw-current" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nueva contraseña" htmlFor="pw-new" hint="8 a 128 caracteres, con mayúscula, minúscula y número. Evitá claves comunes o repetitivas.">
            <Input id="pw-new" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          </Field>
          <Field label="Repetir" htmlFor="pw-confirm">
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </Field>
        </div>
        <Button type="submit" loading={change.isPending} disabled={!form.currentPassword || !form.newPassword}>
          Cambiar contraseña
        </Button>
      </form>
    </Card>
  );
}

function Mfa() {
  const qc = useQueryClient();
  const { me } = useOrg();
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disable, setDisable] = useState({ password: "", code: "" });
  const start = useMutation({ mutationFn: () => api<{ secret: string; qrDataUrl: string }>("/me/mfa/setup", { method: "POST" }), onSuccess: setSetup });
  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>("/me/mfa/enable", { method: "POST", body: { code } }),
    onSuccess: (r) => {
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode("");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const off = useMutation({
    mutationFn: () => api("/me/mfa/disable", { method: "POST", body: disable }),
    onSuccess: () => {
      setDisableOpen(false);
      setDisable({ password: "", code: "" });
      toast.success("Verificación en dos pasos desactivada");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const enabled = me?.user.mfaEnabled;
  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className={enabled ? "h-6 w-6 text-success" : "h-6 w-6 text-muted-foreground"} />
        <div className="flex-1">
          <h2 className="font-semibold">Verificación en dos pasos</h2>
          <p className="text-sm text-muted-foreground">{enabled ? "Activa. Al iniciar sesión te pedimos un código de tu app autenticadora." : "Agregá una capa extra de seguridad con una app como Google Authenticator, 1Password o Authy."}</p>
        </div>
        {enabled ? (
          <Button variant="secondary" onClick={() => setDisableOpen(true)}>
            Desactivar
          </Button>
        ) : (
          !setup && (
            <Button onClick={() => start.mutate()} loading={start.isPending}>
              Activar
            </Button>
          )
        )}
      </div>
      {setup && (
        <div className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-[180px_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qrDataUrl} alt="Código QR para la app autenticadora" className="h-44 w-44 rounded-lg bg-white p-2" />
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              enable.mutate();
            }}
          >
            <p className="text-sm">1. Escaneá el código con tu app. Si no podés, ingresá esta clave:</p>
            <code className="block break-all rounded-lg bg-muted px-2 py-1 font-mono text-xs">{setup.secret}</code>
            <Field label="2. Ingresá el código de 6 dígitos" htmlFor="mfa-code">
              <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
              Confirmar
            </Button>
          </form>
        </div>
      )}
      <Dialog open={!!codes} onOpenChange={(o) => !o && setCodes(null)} title="Guardá tus códigos de recuperación" description="Cada código sirve una sola vez si perdés el acceso a tu app. No los vamos a volver a mostrar.">
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 font-mono text-sm">
          {codes?.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              navigator.clipboard.writeText(codes?.join("\n") ?? "").then(() => toast.success("Copiados"));
            }}
          >
            Copiar
          </Button>
          <Button onClick={() => setCodes(null)}>Ya los guardé</Button>
        </div>
      </Dialog>
      <Dialog open={disableOpen} onOpenChange={setDisableOpen} title="Desactivar verificación en dos pasos">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            off.mutate();
          }}
        >
          <Field label="Contraseña" htmlFor="d-pw">
            <Input id="d-pw" type="password" autoComplete="current-password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
          </Field>
          <Field label="Código o código de recuperación" htmlFor="d-code">
            <Input id="d-code" autoComplete="one-time-code" maxLength={20} value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} />
          </Field>
          <Button type="submit" variant="danger" loading={off.isPending}>
            Desactivar
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api<{ sessions: { id: string; userAgent: string | null; createdAt: string; lastUsedAt: string; current: boolean }[] }>("/me/sessions"),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/me/sessions/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }) });
  const all = useMutation({
    mutationFn: () => api("/auth/logout-all", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      router.replace("/login");
    },
  });
  const device = (ua: string | null) => {
    if (!ua) return "Dispositivo desconocido";
    const browser = /Firefox/.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Navegador";
    const os = /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    return `${browser}${os ? ` en ${os}` : ""}`;
  };
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-semibold">Sesiones activas</h2>
        <Button variant="secondary" size="sm" onClick={() => confirm("¿Cerrar todas las sesiones, incluida esta?") && all.mutate()} loading={all.isPending}>
          Cerrar todas
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {q.data?.sessions.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3 text-sm">
            <Laptop className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {device(s.userAgent)} {s.current && <span className="text-xs font-normal text-success">· esta sesión</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                Inició {fmtDateTime(s.createdAt)} · último uso {ago(s.lastUsedAt)}
              </p>
            </div>
            {!s.current && (
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                Cerrar
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const del = useMutation({
    mutationFn: () => api("/me", { method: "DELETE", body: { password } }),
    onSuccess: () => {
      qc.clear();
      router.replace("/login");
    },
  });
  return (
    <Card className="space-y-4 border-destructive/40 p-6">
      <div className="flex items-start gap-3">
        <Trash2 className="h-6 w-6 text-destructive" />
        <div>
          <h2 className="font-semibold text-destructive">Eliminar mi cuenta</h2>
          <p className="text-sm text-muted-foreground">
            Salís de todas las organizaciones y se anonimizan tus datos personales. Tus comentarios y tareas quedan como “Usuario eliminado”. Si sos el único dueño de una
            organización, primero transferí la propiedad o eliminala.
          </p>
        </div>
      </div>
      <Field label="Confirmá con tu contraseña" htmlFor="del-pw">
        <Input id="del-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button variant="danger" disabled={!password} loading={del.isPending} onClick={() => confirm("Esta acción no se puede deshacer. ¿Continuar?") && del.mutate()}>
        Eliminar cuenta
      </Button>
    </Card>
  );
}
