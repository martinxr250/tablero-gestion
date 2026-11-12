"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitBranch, KeyRound, Link2Off, Plus, RefreshCw } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useOrg } from "@/components/shell/org-context";
import { Alert, Button, Field, Input, Select, Skeleton, Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { Artwork } from "@/components/ui/artwork";
import type { BoardData } from "@/lib/types";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { vcs, type VcsProvider } from "@/lib/vcs";

export type RepoInfo = {
  id: string;
  provider: "github" | "gitlab";
  connectionId: string;
  fullName: string;
  htmlUrl: string;
  settings: { inboxListId?: string; doneListId?: string; reviewListId?: string; importNew?: boolean; autoPush?: boolean };
  webhook: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  linked: number;
  pending: number;
  conflicts: number;
};

type Connection = { id: string; provider: VcsProvider; apiBaseUrl: string; accountLogin: string };

/** Host de la conexión cuando no es el público (GitLab self-managed). */
const hostOf = (c: Connection) => {
  try {
    const h = new URL(c.apiBaseUrl).hostname;
    return h === "api.github.com" || h === "gitlab.com" ? null : h;
  } catch {
    return null;
  }
};
const connLabel = (c: Connection) => `${vcs(c.provider).name}${hostOf(c) ? ` (${hostOf(c)})` : ""} · ${c.accountLogin}`;

export function RepoSettings({ data }: { data: BoardData }) {
  const qc = useQueryClient();
  const { currentOrg } = useOrg();
  const orgAdmin = currentOrg?.role === "owner" || currentOrg?.role === "admin";
  const boardId = data.board.id;
  const [adding, setAdding] = useState(false);
  const repoQ = useQuery({ queryKey: ["board-repo", boardId], queryFn: () => api<{ repo: RepoInfo | null }>(`/boards/${boardId}/repo`) });
  const connQ = useQuery({ queryKey: ["vcs-connections", data.board.orgId], queryFn: () => api<{ connections: Connection[] }>(`/orgs/${data.board.orgId}/vcs/connections`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["board-repo", boardId] });
    qc.invalidateQueries({ queryKey: ["board", boardId] });
  };

  if (repoQ.isLoading || connQ.isLoading) return <Skeleton className="h-40" />;
  const repo = repoQ.data?.repo;
  const connections = connQ.data?.connections ?? [];
  const providers = [...new Set(connections.map((c) => c.provider))];

  return (
    <div className="space-y-6">
      {repo ? (
        <LinkedRepo repo={repo} data={data} onChange={refresh} />
      ) : connections.length === 0 ? (
        orgAdmin ? (
          <ConnectForm orgId={data.board.orgId} onDone={() => connQ.refetch()} />
        ) : (
          <Alert tone="info">Un administrador de la organización tiene que conectar primero una cuenta de GitHub o GitLab.</Alert>
        )
      ) : (
        <LinkRepoForm boardId={boardId} connections={connections} onDone={refresh} />
      )}
      {providers.map((p) => (
        <MemberAccounts key={p} orgId={data.board.orgId} provider={p} canEditOthers={orgAdmin} />
      ))}
      {connections.length > 0 && orgAdmin && (
        <ConnectionsList
          connections={connections}
          onAdd={() => setAdding(true)}
          onChange={() => {
            connQ.refetch();
            refresh();
          }}
        />
      )}
      {adding && orgAdmin && connections.length > 0 && (
        <ConnectForm
          orgId={data.board.orgId}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            connQ.refetch();
          }}
        />
      )}
    </div>
  );
}

const TOKEN_HELP: Record<VcsProvider, (host: string) => ReactNode> = {
  github: () => (
    <>
      Creá un{" "}
      <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
        token fine-grained
      </a>{" "}
      con acceso a los repositorios (públicos o privados) y estos permisos: <strong>Issues</strong> (lectura y escritura), <strong>Pull requests</strong>,{" "}
      <strong>Checks</strong>, <strong>Deployments</strong> y <strong>Metadata</strong> (lectura) y <strong>Webhooks</strong> (lectura y escritura).
    </>
  ),
  gitlab: (host) => (
    <>
      Creá un{" "}
      <a href={`https://${host}/-/user_settings/personal_access_tokens?name=Tableros&scopes=api`} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
        token de acceso personal
      </a>{" "}
      (o uno de proyecto o de grupo) con el alcance <strong>api</strong>. Funciona con proyectos privados: la cuenta necesita rol <strong>Developer</strong> o más, y{" "}
      <strong>Maintainer</strong> para registrar el webhook (si no, se sincroniza por sondeo).
    </>
  ),
};

function ConnectForm({ orgId, onDone, onCancel }: { orgId: string; onDone: () => void; onCancel?: () => void }) {
  const [provider, setProvider] = useState<VcsProvider>("github");
  const [token, setToken] = useState("");
  const [selfManaged, setSelfManaged] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const t = vcs(provider);
  const custom = provider === "gitlab" && selfManaged && baseUrl.trim() ? baseUrl.trim() : "";
  const host = custom ? custom.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") : "gitlab.com";
  const connect = useMutation({
    mutationFn: () => api<{ accountLogin: string }>(`/orgs/${orgId}/vcs/connections`, { method: "POST", body: { provider, token, ...(custom ? { baseUrl: custom } : {}) } }),
    onSuccess: (r) => {
      toast.success(`Conectado a ${t.name} como ${r.accountLogin}`);
      setToken("");
      onDone();
    },
  });
  return (
    <form
      className="relative space-y-4 rounded-2xl border p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        connect.mutate();
      }}
    >
      <Artwork kind="integrations" className="absolute top-3 right-3 hidden size-20 sm:block" sizes="80px" />
      <div className="flex items-start gap-3 sm:pr-24">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <KeyRound className="size-5" />
        </span>
        <div className="space-y-3 text-sm">
          <p className="font-semibold">Conectar un proveedor de código</p>
          <div role="radiogroup" aria-label="Proveedor" className="inline-flex rounded-xl border bg-muted p-1">
            {(["github", "gitlab"] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={provider === p}
                onClick={() => {
                  setProvider(p);
                  connect.reset();
                }}
                className={cn("rounded-lg px-3 py-1 text-sm font-medium transition-colors", provider === p ? "bg-card shadow-card" : "text-muted-foreground hover:text-foreground")}
              >
                {vcs(p).name}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground">{TOKEN_HELP[provider](host)} Se guarda cifrado y nunca vuelve al navegador.</p>
        </div>
      </div>
      {provider === "gitlab" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selfManaged} onChange={(e) => setSelfManaged(e.target.checked)} />
            Uso un GitLab propio (self-managed)
          </label>
          {selfManaged && (
            <Field label="Dirección del servidor" htmlFor="gl-base" hint="Solo HTTPS. Quien administra Tableros tiene que habilitar ese host (GITLAB_HOSTS).">
              <Input id="gl-base" placeholder="https://gitlab.miempresa.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      <Field label={`Token de ${t.name}`} htmlFor="vcs-token">
        <Input id="vcs-token" type="password" autoComplete="off" spellCheck={false} placeholder={provider === "gitlab" ? "glpat-…" : "github_pat_…"} value={token} onChange={(e) => setToken(e.target.value)} />
      </Field>
      {connect.error && <Alert>{(connect.error as Error).message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" loading={connect.isPending} disabled={token.trim().length < 20 || (provider === "gitlab" && selfManaged && !baseUrl.trim())}>
          Conectar {t.name}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

function LinkRepoForm({ boardId, connections, onDone }: { boardId: string; connections: Connection[]; onDone: () => void }) {
  const [connectionId, setConnectionId] = useState(connections[0]!.id);
  const [repo, setRepo] = useState("");
  const repos = useQuery({
    queryKey: ["vcs-repos", connectionId],
    queryFn: () => api<{ repos: { id: number; fullName: string; private: boolean; canPush: boolean }[] }>(`/vcs/connections/${connectionId}/repos`),
  });
  const link = useMutation({
    mutationFn: () => api<{ webhook: boolean }>(`/boards/${boardId}/repo`, { method: "PUT", body: { connectionId, repoFullName: repo } }),
    onSuccess: (r) => {
      toast.success(r.webhook ? "Repositorio vinculado con webhook" : "Repositorio vinculado. Se sincroniza al abrir el tablero y con “Sincronizar”.");
      onDone();
    },
  });
  return (
    <div className="space-y-4 rounded-2xl border p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <GitBranch className="size-4 text-primary" /> Vincular un repositorio a este tablero
      </p>
      {connections.length > 1 && (
        <Select aria-label="Cuenta conectada" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {connLabel(c)}
            </option>
          ))}
        </Select>
      )}
      {repos.isLoading ? (
        <Spinner />
      ) : (
        <Select aria-label="Repositorio" value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="">Elegí un repositorio…</option>
          {repos.data?.repos
            .filter((r) => r.canPush)
            .map((r) => (
              <option key={r.id} value={r.fullName}>
                {r.fullName}
                {r.private ? " (privado)" : ""}
              </option>
            ))}
        </Select>
      )}
      {repos.error && <Alert>{(repos.error as Error).message}</Alert>}
      {repos.data && repos.data.repos.filter((r) => r.canPush).length === 0 && (
        <Alert tone="info">La cuenta no tiene repositorios donde pueda escribir. Revisá que el token tenga acceso a los repositorios (también los privados).</Alert>
      )}
      <p className="text-xs text-muted-foreground">Se importan los issues abiertos como tarjetas. Las tarjetas actuales no se modifican.</p>
      <Button disabled={!repo} loading={link.isPending} onClick={() => link.mutate()}>
        Vincular e importar
      </Button>
    </div>
  );
}

function LinkedRepo({ repo, data, onChange }: { repo: RepoInfo; data: BoardData; onChange: () => void }) {
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api(`/boards/${data.board.id}/repo/sync`, { method: "POST", body: {} }),
    onSuccess: () => toast.success("Sincronizado"),
    onSettled: onChange,
  });
  const save = useMutation({
    mutationFn: (body: Partial<RepoInfo["settings"]> & { reviewListId?: string | null }) =>
      api(`/boards/${data.board.id}/repo/settings`, { method: "PATCH", body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["board-repo", data.board.id] }),
  });
  const unlink = useMutation({
    mutationFn: () => api(`/boards/${data.board.id}/repo`, { method: "DELETE" }),
    onSuccess: () => toast.success("Repositorio desvinculado. Las tarjetas quedaron como locales."),
    onSettled: onChange,
  });
  const t = vcs(repo.provider);
  const listSelect = (id: string, label: string, key: "inboxListId" | "doneListId" | "reviewListId", optional = false) => (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={repo.settings[key] ?? ""} onChange={(e) => save.mutate({ [key]: e.target.value || (optional ? null : undefined) })}>
        {optional && <option value="">No mover</option>}
        {data.lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-4">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <GitBranch className="size-5" />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <a href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-primary">
            {repo.fullName} <ExternalLink className="size-3.5" />
          </a>
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t.name}</span>
          <p className="text-xs text-muted-foreground">
            {repo.linked} tarjetas vinculadas · {repo.webhook ? "webhook activo" : "sincronización por sondeo"} ·{" "}
            {repo.lastSyncedAt ? `última sincronización ${ago(repo.lastSyncedAt)}` : "sin sincronizar"}
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={sync.isPending} onClick={() => sync.mutate()}>
          <RefreshCw /> Sincronizar
        </Button>
      </div>
      {repo.lastSyncError && <Alert>Último error: {repo.lastSyncError}</Alert>}
      {(repo.pending > 0 || repo.conflicts > 0) && (
        <Alert tone="info">
          {repo.pending > 0 && `${plural(repo.pending, "cambio pendiente", "cambios pendientes")} de enviar. `}
          {repo.conflicts > 0 && `${plural(repo.conflicts, "conflicto", "conflictos")} para resolver desde la tarjeta.`}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {listSelect("gh-inbox", "Issues nuevos llegan a", "inboxListId")}
        {listSelect("gh-done", "Mover acá cierra el issue", "doneListId")}
        {listSelect("gh-review", `Issue cerrado en ${t.name} → mover a`, "reviewListId", true)}
      </div>
      <p className="text-xs text-muted-foreground">Cerrar un issue (o fusionar un {t.prShort} que lo cierra) nunca completa la tarjeta: la decisión final queda en el tablero.</p>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={repo.settings.importNew !== false} onChange={(e) => save.mutate({ importNew: e.target.checked })} />
          Crear tarjetas para issues nuevos del repositorio
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={repo.settings.autoPush !== false} onChange={(e) => save.mutate({ autoPush: e.target.checked })} />
          Enviar a {t.name} los cambios de las tarjetas vinculadas
        </label>
      </div>
      <Button variant="danger" size="sm" loading={unlink.isPending} onClick={() => confirm("¿Desvincular el repositorio? Las tarjetas quedan en el tablero.") && unlink.mutate()}>
        <Link2Off /> Desvincular repositorio
      </Button>
    </div>
  );
}

const LOGIN_RULE: Record<VcsProvider, { pattern: string; max: number; title: string }> = {
  github: { pattern: "[A-Za-z0-9\-]{1,39}", max: 39, title: "Letras, números y guiones (máximo 39)" },
  gitlab: { pattern: "[A-Za-z0-9_.\-]{1,100}", max: 100, title: "Letras, números, puntos, guiones y guiones bajos" },
};

function MemberAccounts({ orgId, provider, canEditOthers }: { orgId: string; provider: VcsProvider; canEditOthers: boolean }) {
  const t = vcs(provider);
  const rule = LOGIN_RULE[provider];
  const { me } = useOrg();
  const q = useQuery({
    queryKey: ["vcs-users", orgId, provider],
    queryFn: () => api<{ members: { userId: string; name: string; provider: string | null; login: string | null }[] }>(`/orgs/${orgId}/vcs/users?provider=${provider}`),
  });
  const save = useMutation({
    mutationFn: (v: { userId: string; login: string }) => api(`/orgs/${orgId}/vcs/users/${v.userId}`, { method: "PUT", body: { provider, login: v.login || null } }),
    onSuccess: () => toast.success("Cuenta guardada"),
    onSettled: () => q.refetch(),
  });
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Usuarios de {t.name}</p>
        <p className="text-xs text-muted-foreground">Para sincronizar el responsable de cada tarjeta con el asignado del issue.</p>
      </div>
      <ul className="divide-y rounded-2xl border">
        {q.data?.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const login = String(new FormData(e.currentTarget).get("login") ?? "").trim();
                save.mutate({ userId: m.userId, login });
              }}
            >
              <Input
                name="login"
                aria-label={`${t.userLabel} de ${m.name}`}
                defaultValue={m.login ?? ""}
                maxLength={rule.max}
                pattern={rule.pattern}
                title={rule.title}
                placeholder="usuario"
                className="h-9 w-40"
                disabled={!canEditOthers && m.userId !== me?.user.id}
              />
              {(canEditOthers || m.userId === me?.user.id) && (
                <Button type="submit" size="sm" variant="secondary">
                  Guardar
                </Button>
              )}
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectionsList({ connections, onAdd, onChange }: { connections: Connection[]; onAdd: () => void; onChange: () => void }) {
  const remove = useMutation({
    mutationFn: (id: string) => api(`/vcs/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => toast.success("Cuenta desconectada"),
    onSettled: onChange,
  });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Cuentas conectadas a la organización</p>
        <Button size="sm" variant="secondary" onClick={onAdd}>
          <Plus /> Conectar otra cuenta
        </Button>
      </div>
      <ul className="divide-y rounded-2xl border">
        {connections.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex-1">
              {vcs(c.provider).name}
              {hostOf(c) && <span className="text-muted-foreground"> ({hostOf(c)})</span>} · <strong>{c.accountLogin}</strong>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => confirm("¿Desconectar? Se desvinculan los repositorios de todos los tableros de la organización (las tarjetas se conservan).") && remove.mutate(c.id)}
            >
              Desconectar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
