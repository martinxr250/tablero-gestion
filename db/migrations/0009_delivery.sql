-- Flujo de entrega: reglas de cierre por tablero, capacidad por persona, vínculos manuales
-- de desarrollo y avisos sin duplicados con preferencias. Todo aditivo.

-- Reglas para completar tarjetas: { "subtasks": "off|warn|block", "dependencies": …, "checklists": …,
-- "prApproved": …, "ciPassing": …, "prMerged": … }. La aprobación de QA sigue en qa_required.
alter table app.boards add column completion_rules jsonb not null default '{}'::jsonb;

-- Capacidad por integrante (puntos por etapa) para detectar sobrecarga.
create table app.board_capacity (
  org_id uuid not null,
  board_id uuid not null,
  user_id uuid not null,
  points numeric(6,1) not null check (points >= 0 and points <= 10000),
  updated_at timestamptz not null default now(),
  primary key (board_id, user_id),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade
);

-- PR vinculados a mano (además de los detectados por "#N" o el nombre de la rama).
alter table app.card_dev_refs add column linked_manually boolean not null default false;

-- Avisos idempotentes: el mismo evento no notifica dos veces a la misma persona.
alter table app.notifications add column dedupe_key text;
create unique index notifications_dedupe_idx on app.notifications(user_id, dedupe_key) where dedupe_key is not null;

-- Preferencias de avisos: tipos silenciados por cada persona.
create table app.notification_settings (
  user_id uuid primary key references app.users(id) on delete cascade,
  muted text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table app.board_capacity enable row level security;
create policy tenant_isolation on app.board_capacity to app_rw
  using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()));
grant select, insert, update, delete on app.board_capacity to app_rw;

alter table app.notification_settings enable row level security;
create policy own_settings on app.notification_settings to app_rw
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());
grant select, insert, update, delete on app.notification_settings to app_rw;
