"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitBranch, KeyRound, Link2Off, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useOrg } from "@/components/shell/org-context";
import { Alert, Button, Field, Input, Select, Skeleton, Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import type { BoardData } from "@/lib/types";

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

type Connection = { id: string; provider: string; accountLogin: string };

const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

export function RepoSettings({ data }: { data: BoardData }) {
  const qc = useQueryClient();
  const { currentOrg } = useOrg();
  const orgAdmin = currentOrg?.role === "owner" || currentOrg?.role === "admin";
  const boardId = data.board.id;
  const repoQ = useQuery({ queryKey: ["board-repo", boardId], queryFn: () => api<{ repo: RepoInfo | null }>(`/boards/${boardId}/repo`) });
  const connQ = useQuery({ queryKey: ["vcs-connections", data.board.orgId], queryFn: () => api<{ connections: Connection[] }>(`/orgs/${data.board.orgId}/vcs/connections`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["board-repo", boardId] });
    qc.invalidateQueries({ queryKey: ["board", boardId] });
  };

  if (repoQ.isLoading || connQ.isLoading) return <Skeleton className="h-40" />;
  const repo = repoQ.data?.repo;
  const connections = connQ.data?.connections ?? [];

  return (
    <div className="space-y-6">
      {repo ? (
        <LinkedRepo repo={repo} data={data} onChange={refresh} />
      ) : connections.length === 0 ? (
        orgAdmin ? (
          <ConnectForm orgId={data.board.orgId} onDone={() => connQ.refetch()} />
        ) : (
          <Alert tone="info">Un administrador de la organización tiene que conectar primero una cuenta de GitHub.</Alert>
        )
      ) : (
        <LinkRepoForm boardId={boardId} connections={connections} onDone={refresh} />
      )}
      {connections.length > 0 && <MemberAccounts orgId={data.board.orgId} canEditOthers={orgAdmin} />}
      {connections.length > 0 && orgAdmin && <ConnectionsList orgId={data.board.orgId} connections={connections} onChange={() => { connQ.refetch(); refresh(); }} />}
    </div>
  );
}

function ConnectForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [token, setToken] = useState("");
  const connect = useMutation({
    mutationFn: () => api<{ accountLogin: string }>(`/orgs/${orgId}/vcs/connections`, { method: "POST", body: { provider: "github", token } }),
    onSuccess: (r) => {
      toast.success(`Conectado como ${r.accountLogin}`);
      setToken("");
      onDone();
    },
  });
  return (
    <form
      className="space-y-4 rounded-2xl border p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        connect.mutate();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <KeyRound className="size-5" />
        </span>
        <div className="text-sm">
          <p className="font-semibold">Conectar GitHub</p>
          <p className="text-muted-foreground">
            Creá un{" "}
            <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">
              token fine-grained
            </a>{" "}
            con acceso al repositorio y estos permisos: <strong>Issues</strong> (lectura y escritura), <strong>Pull requests</strong>,{" "}
            <strong>Checks</strong> y <strong>Metadata</strong> (lectura) y <strong>Webhooks</strong> (lectura y escritura). Se guarda cifrado y nunca vuelve al
            navegador.
          </p>
        </div>
      </div>
      <Field label="Token de GitHub" htmlFor="gh-token">
        <Input id="gh-token" type="password" autoComplete="off" spellCheck={false} placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
      </Field>
      <Button type="submit" loading={connect.isPending} disabled={token.trim().length < 20}>
        Conectar
      </Button>
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
        <Select aria-label="Cuenta" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.accountLogin}
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
          {repo.pending > 0 && `${repo.pending} cambio(s) pendiente(s) de enviar. `}
          {repo.conflicts > 0 && `${repo.conflicts} conflicto(s) para resolver desde la tarjeta.`}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        {listSelect("gh-inbox", "Issues nuevos llegan a", "inboxListId")}
        {listSelect("gh-done", "Mover acá cierra el issue", "doneListId")}
        {listSelect("gh-review", "Issue cerrado en GitHub → mover a", "reviewListId", true)}
      </div>
      <p className="text-xs text-muted-foreground">Cerrar un issue (o fusionar un PR que lo cierra) nunca completa la tarjeta: la decisión final queda en el tablero.</p>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={repo.settings.importNew !== false} onChange={(e) => save.mutate({ importNew: e.target.checked })} />
          Crear tarjetas para issues nuevos del repositorio
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={repo.settings.autoPush !== false} onChange={(e) => save.mutate({ autoPush: e.target.checked })} />
          Enviar a GitHub los cambios de las tarjetas vinculadas
        </label>
      </div>
      <Button variant="danger" size="sm" loading={unlink.isPending} onClick={() => confirm("¿Desvincular el repositorio? Las tarjetas quedan en el tablero.") && unlink.mutate()}>
        <Link2Off /> Desvincular repositorio
      </Button>
    </div>
  );
}

function MemberAccounts({ orgId, canEditOthers }: { orgId: string; canEditOthers: boolean }) {
  const { me } = useOrg();
  const q = useQuery({
    queryKey: ["vcs-users", orgId],
    queryFn: () => api<{ members: { userId: string; name: string; provider: string | null; login: string | null }[] }>(`/orgs/${orgId}/vcs/users`),
  });
  const save = useMutation({
    mutationFn: (v: { userId: string; login: string }) => api(`/orgs/${orgId}/vcs/users/${v.userId}`, { method: "PUT", body: { provider: "github", login: v.login || null } }),
    onSuccess: () => toast.success("Cuenta guardada"),
    onSettled: () => q.refetch(),
  });
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Usuarios de GitHub</p>
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
                aria-label={`Usuario de GitHub de ${m.name}`}
                defaultValue={m.login ?? ""}
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

function ConnectionsList({ connections, onChange }: { orgId: string; connections: Connection[]; onChange: () => void }) {
  const remove = useMutation({
    mutationFn: (id: string) => api(`/vcs/connections/${id}`, { method: "DELETE" }),
    onSuccess: () => toast.success("Cuenta desconectada"),
    onSettled: onChange,
  });
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Cuentas conectadas a la organización</p>
      <ul className="divide-y rounded-2xl border">
        {connections.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex-1">
              GitHub · <strong>{c.accountLogin}</strong>
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
