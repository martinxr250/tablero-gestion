-- Despliegues (GitHub Deployments, por ejemplo los que crea la integración de Vercel) y su
-- relación verificable con tarjetas: por commit exacto (preview) o por inclusión del commit de
-- merge del PR en el commit desplegado (producción/staging, comprobada con la API de GitHub).

-- Commits de cada PR: cabeza de la rama y resultado del merge.
alter table app.card_dev_refs add column head_sha text, add column merge_sha text;

create table app.deployments (
  id uuid primary key,
  org_id uuid not null,
  board_repo_id uuid not null,
  external_id bigint not null,
  sha text not null check (sha ~ '^[0-9a-f]{7,64}$'),
  ref text,
  environment text not null check (char_length(environment) <= 100),
  env_kind text not null check (env_kind in ('preview', 'staging', 'production', 'other')),
  state text not null check (state in ('pending', 'building', 'deploying', 'deployed', 'failed', 'canceled', 'unknown')),
  url text check (url is null or url ~ '^https://'),
  started_at timestamptz,
  finished_at timestamptz,
  remote_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (board_repo_id, external_id),
  foreign key (org_id, board_repo_id) references app.board_repos(org_id, id) on delete cascade
);
create index deployments_repo_idx on app.deployments(board_repo_id, created_at desc);

create table app.card_deployments (
  org_id uuid not null,
  card_id uuid not null,
  deployment_id uuid not null,
  linked_at timestamptz not null default now(),
  primary key (card_id, deployment_id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade,
  foreign key (org_id, deployment_id) references app.deployments(org_id, id) on delete cascade
);
create index card_deployments_deployment_idx on app.card_deployments(deployment_id);

do $$
declare t text;
begin
  foreach t in array array['deployments', 'card_deployments'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on app.%I to app_rw using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()))',
      t
    );
    execute format('grant select, insert, update, delete on app.%I to app_rw', t);
  end loop;
end $$;
