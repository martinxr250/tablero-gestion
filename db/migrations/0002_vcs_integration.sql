-- Integración con proveedores de código (GitHub ahora, GitLab después).
-- Todo es aditivo: no modifica datos existentes.

-- Conexión de una organización con un proveedor. El token se guarda cifrado (AES-GCM) por la app.
create table app.vcs_connections (
  id uuid primary key,
  org_id uuid not null references app.organizations(id) on delete cascade,
  provider text not null check (provider in ('github', 'gitlab')),
  api_base_url text not null,
  token_enc text not null,
  account_login text not null,
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create index vcs_connections_org_idx on app.vcs_connections(org_id);

-- Repositorio asociado a un tablero (uno por tablero en esta fase).
create table app.board_repos (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null unique,
  connection_id uuid not null,
  provider text not null check (provider in ('github', 'gitlab')),
  repo_full_name text not null check (char_length(repo_full_name) <= 200),
  repo_id bigint not null,
  html_url text not null,
  webhook_id bigint,
  webhook_secret_enc text,
  settings jsonb not null default '{}',
  last_synced_at timestamptz,
  last_sync_error text,
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade,
  foreign key (org_id, connection_id) references app.vcs_connections(org_id, id) on delete cascade
);

-- Vínculo tarjeta ↔ issue. synced_hash permite detectar ecos propios y conflictos.
create table app.card_issue_links (
  card_id uuid primary key,
  org_id uuid not null,
  board_repo_id uuid not null,
  issue_number int not null,
  issue_id bigint not null,
  html_url text not null,
  remote_state text not null default 'open' check (remote_state in ('open', 'closed')),
  remote_updated_at timestamptz,
  synced_hash text,
  synced_at timestamptz,
  pending_push boolean not null default false,
  last_error text,
  conflict jsonb,
  unique (board_repo_id, issue_number),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade,
  foreign key (org_id, board_repo_id) references app.board_repos(org_id, id) on delete cascade
);
create index card_issue_links_pending_idx on app.card_issue_links(board_repo_id) where pending_push;

-- Actividad de desarrollo vinculada a una tarjeta (PRs y su estado de checks y revisión).
create table app.card_dev_refs (
  id uuid primary key,
  org_id uuid not null,
  card_id uuid not null,
  kind text not null check (kind in ('pr', 'branch', 'commit')),
  external_id text not null,
  title text not null,
  state text not null,
  url text not null,
  author text,
  branch text,
  merged boolean not null default false,
  draft boolean not null default false,
  checks_status text,
  review_status text,
  remote_updated_at timestamptz,
  unique (card_id, kind, external_id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade
);
create index card_dev_refs_card_idx on app.card_dev_refs(card_id);

-- Correspondencia entre miembros y cuentas del proveedor (para sincronizar el responsable).
create table app.vcs_user_links (
  org_id uuid not null,
  user_id uuid not null,
  provider text not null check (provider in ('github', 'gitlab')),
  login text not null check (char_length(login) between 1 and 100),
  primary key (org_id, user_id, provider),
  unique (org_id, provider, login),
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade
);

-- Entregas de webhooks ya procesadas (deduplicación). Solo la usa la sesión de sistema.
create table app.webhook_deliveries (
  delivery_id text primary key,
  board_repo_id uuid not null references app.board_repos(id) on delete cascade,
  event text not null,
  received_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['vcs_connections', 'board_repos', 'card_issue_links', 'card_dev_refs', 'vcs_user_links'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on app.%I to app_rw using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()))',
      t
    );
    execute format('grant select, insert, update, delete on app.%I to app_rw', t);
  end loop;
end $$;

alter table app.webhook_deliveries enable row level security;
