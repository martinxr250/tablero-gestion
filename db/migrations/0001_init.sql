-- Esquema inicial de Faro.
-- Convenciones:
--  * Todas las tablas viven en el esquema "app" (no expuesto por la Data API de Supabase).
--  * Toda tabla de un tenant tiene org_id y FKs compuestas (org_id, x_id) para que un hijo
--    nunca pueda apuntar a un padre de otra organización.
--  * La aplicación ejecuta cada request con SET LOCAL ROLE app_rw (sin BYPASSRLS) y
--    app.user_id configurado; RLS es la segunda capa de aislamiento.

create extension if not exists citext;
create schema if not exists app;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rw') then
    create role app_rw nologin;
  end if;
end $$;

grant app_rw to current_user;
grant usage on schema app to app_rw;

create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────── Usuarios y autenticación ─────────────────────────

create table app.users (
  id uuid primary key,
  email citext not null unique check (char_length(email) <= 254),
  password_hash text not null,
  name text not null check (char_length(name) between 1 and 80),
  avatar_key text,
  email_verified_at timestamptz,
  mfa_enabled boolean not null default false,
  mfa_secret_enc text,
  mfa_pending_secret_enc text,
  failed_login_count int not null default 0,
  locked_until timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger users_touch before update on app.users for each row execute function app.touch_updated_at();

create table app.sessions (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  refresh_hash text not null unique,
  prev_refresh_hash text,
  rotated_at timestamptz,
  user_agent text,
  ip_hash text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text
);
create index sessions_user_idx on app.sessions(user_id);
create index sessions_prev_refresh_idx on app.sessions(prev_refresh_hash);

create table app.mfa_recovery_codes (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  code_hash text not null unique,
  used_at timestamptz
);
create index mfa_recovery_user_idx on app.mfa_recovery_codes(user_id);

create table app.auth_tokens (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  type text not null check (type in ('verify_email', 'reset_password')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index auth_tokens_user_idx on app.auth_tokens(user_id, type);

-- ───────────────────────── Organizaciones ─────────────────────────

create table app.organizations (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger organizations_touch before update on app.organizations for each row execute function app.touch_updated_at();

create table app.organization_members (
  org_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'guest')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on app.organization_members(user_id);

-- ───────────────────────── Espacios de trabajo ─────────────────────────

create table app.workspaces (
  id uuid primary key,
  org_id uuid not null references app.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  color text not null default 'slate',
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (org_id, id)
);
create index workspaces_org_idx on app.workspaces(org_id);
create trigger workspaces_touch before update on app.workspaces for each row execute function app.touch_updated_at();

create table app.workspace_members (
  org_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (org_id, workspace_id) references app.workspaces(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade
);
create index workspace_members_user_idx on app.workspace_members(user_id);

-- ───────────────────────── Tableros ─────────────────────────

create table app.boards (
  id uuid primary key,
  org_id uuid not null,
  workspace_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  color text not null default 'indigo',
  visibility text not null default 'workspace' check (visibility in ('private', 'workspace')),
  workspace_access text not null default 'editor' check (workspace_access in ('viewer', 'commenter', 'editor')),
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, workspace_id) references app.workspaces(org_id, id) on delete cascade
);
create index boards_workspace_idx on app.boards(workspace_id);
create trigger boards_touch before update on app.boards for each row execute function app.touch_updated_at();

create table app.board_members (
  org_id uuid not null,
  board_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('admin', 'editor', 'commenter', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade
);
create index board_members_user_idx on app.board_members(user_id);

create table app.lists (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default 'slate',
  position text collate "C" not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (org_id, id),
  unique (org_id, board_id, id),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade
);
create index lists_board_position_idx on app.lists(board_id, position);
create trigger lists_touch before update on app.lists for each row execute function app.touch_updated_at();

create table app.cards (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null,
  list_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  description jsonb,
  description_text text not null default '',
  priority text not null default 'none' check (priority in ('none', 'low', 'medium', 'high', 'urgent')),
  owner_id uuid,
  due_at timestamptz,
  completed_at timestamptz,
  position text collate "C" not null,
  archived_at timestamptz,
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_tsv tsvector generated always as (
    to_tsvector('spanish', title || ' ' || description_text)
  ) stored,
  unique (org_id, id),
  unique (org_id, board_id, id),
  foreign key (org_id, board_id, list_id) references app.lists(org_id, board_id, id) on delete cascade,
  foreign key (org_id, owner_id) references app.organization_members(org_id, user_id) on delete set null (owner_id)
);
create index cards_list_position_idx on app.cards(list_id, position);
create index cards_board_idx on app.cards(board_id);
create index cards_owner_idx on app.cards(owner_id);
create index cards_due_idx on app.cards(org_id, due_at) where archived_at is null and completed_at is null;
create index cards_search_idx on app.cards using gin(search_tsv);
create trigger cards_touch before update on app.cards for each row execute function app.touch_updated_at();

create table app.card_assignees (
  org_id uuid not null,
  card_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade
);
create index card_assignees_user_idx on app.card_assignees(user_id);

create table app.labels (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  color text not null,
  created_at timestamptz not null default now(),
  unique (board_id, name),
  unique (org_id, board_id, id),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade
);

create table app.card_labels (
  org_id uuid not null,
  board_id uuid not null,
  card_id uuid not null,
  label_id uuid not null,
  primary key (card_id, label_id),
  foreign key (org_id, board_id, card_id) references app.cards(org_id, board_id, id) on delete cascade,
  foreign key (org_id, board_id, label_id) references app.labels(org_id, board_id, id) on delete cascade
);
create index card_labels_label_idx on app.card_labels(label_id);

create table app.checklists (
  id uuid primary key,
  org_id uuid not null,
  card_id uuid not null,
  title text not null check (char_length(title) between 1 and 100),
  position text collate "C" not null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade
);
create index checklists_card_idx on app.checklists(card_id);

create table app.checklist_items (
  id uuid primary key,
  org_id uuid not null,
  checklist_id uuid not null,
  text text not null check (char_length(text) between 1 and 300),
  position text collate "C" not null,
  done_at timestamptz,
  done_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, checklist_id) references app.checklists(org_id, id) on delete cascade
);
create index checklist_items_checklist_idx on app.checklist_items(checklist_id);

create table app.card_relations (
  org_id uuid not null,
  from_card_id uuid not null,
  to_card_id uuid not null,
  type text not null check (type in ('blocks', 'relates', 'duplicates')),
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (from_card_id, to_card_id, type),
  check (from_card_id <> to_card_id),
  foreign key (org_id, from_card_id) references app.cards(org_id, id) on delete cascade,
  foreign key (org_id, to_card_id) references app.cards(org_id, id) on delete cascade
);
create index card_relations_to_idx on app.card_relations(to_card_id);

create table app.comments (
  id uuid primary key,
  org_id uuid not null,
  card_id uuid not null,
  author_id uuid references app.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (org_id, id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade
);
create index comments_card_idx on app.comments(card_id, created_at);

create table app.comment_mentions (
  org_id uuid not null,
  comment_id uuid not null,
  user_id uuid not null,
  primary key (comment_id, user_id),
  foreign key (org_id, comment_id) references app.comments(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade
);

create table app.attachments (
  id uuid primary key,
  org_id uuid not null,
  card_id uuid not null,
  uploader_id uuid references app.users(id) on delete set null,
  storage_key text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 150),
  mime text not null,
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade
);
create index attachments_card_idx on app.attachments(card_id);

-- ───────────────────────── Colaboración ─────────────────────────

create table app.notifications (
  id uuid primary key,
  org_id uuid not null,
  user_id uuid not null,
  type text not null,
  actor_id uuid references app.users(id) on delete set null,
  board_id uuid,
  card_id uuid,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade,
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade
);
create index notifications_user_idx on app.notifications(user_id, created_at desc);
create index notifications_unread_idx on app.notifications(user_id) where read_at is null;

create table app.activity_logs (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  board_id uuid not null,
  card_id uuid,
  actor_id uuid references app.users(id) on delete set null,
  action text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade
);
create index activity_board_idx on app.activity_logs(board_id, id);
create index activity_card_idx on app.activity_logs(card_id, id);

create table app.invitations (
  id uuid primary key,
  org_id uuid not null references app.organizations(id) on delete cascade,
  scope text not null check (scope in ('org', 'workspace', 'board')),
  workspace_id uuid,
  board_id uuid,
  email citext not null,
  role text not null,
  token_hash text not null unique,
  invited_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references app.users(id) on delete set null,
  revoked_at timestamptz,
  foreign key (org_id, workspace_id) references app.workspaces(org_id, id) on delete cascade,
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade,
  check (
    (scope = 'org' and workspace_id is null and board_id is null and role in ('admin', 'member', 'guest'))
    or (scope = 'workspace' and workspace_id is not null and board_id is null and role in ('admin', 'member', 'viewer'))
    or (scope = 'board' and board_id is not null and workspace_id is null and role in ('admin', 'editor', 'commenter', 'viewer'))
  )
);
create unique index invitations_pending_uidx on app.invitations (
  org_id, scope,
  coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(board_id, '00000000-0000-0000-0000-000000000000'::uuid),
  email
) where accepted_at is null and revoked_at is null;

-- ───────────────────────── Auditoría y sistema ─────────────────────────

create table app.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  ip_hash text,
  user_agent text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_org_idx on app.audit_logs(org_id, id desc);
create index audit_actor_idx on app.audit_logs(actor_id, id desc);

-- La auditoría es append-only: solo la purga de retención (sesión de sistema) puede borrar.
create or replace function app.audit_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('app.audit_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'audit_logs es de solo inserción';
end $$;
create trigger audit_logs_immutable before update or delete on app.audit_logs
  for each row execute function app.audit_immutable();

create table app.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

-- Objetos de almacenamiento pendientes de borrar (se llena al borrar adjuntos).
create table app.storage_gc (
  key text primary key,
  created_at timestamptz not null default now()
);

create or replace function app.attachments_gc() returns trigger
language plpgsql security definer set search_path = app, pg_temp as $$
begin
  insert into app.storage_gc(key) values (old.storage_key) on conflict do nothing;
  return old;
end $$;
create trigger attachments_gc after delete on app.attachments
  for each row execute function app.attachments_gc();

-- ───────────────────────── Resolución de permisos ─────────────────────────
-- Única fuente de verdad del rol efectivo en un tablero. La usan la vista my_boards
-- y board_roles(); la API solo traduce rol → acciones.

create or replace function app.resolve_board_role(
  org_role text, ws_role text, board_role text, visibility text, workspace_access text
) returns text
language sql immutable as $$
  select case
    when org_role in ('owner', 'admin') then 'admin'
    when board_role is not null then board_role
    when org_role = 'guest' then null
    when ws_role = 'admin' then 'admin'
    when visibility = 'workspace' and ws_role = 'viewer' then 'viewer'
    when visibility = 'workspace' and ws_role = 'member' then workspace_access
    else null
  end
$$;

create or replace function app.user_org_ids() returns setof uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select m.org_id
  from app.organization_members m
  join app.organizations o on o.id = m.org_id and o.deleted_at is null
  where m.user_id = app.current_user_id()
$$;

create or replace function app.visible_user_ids() returns setof uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select distinct m.user_id
  from app.organization_members m
  where m.org_id in (select app.user_org_ids())
  union
  select app.current_user_id()
$$;

create view app.my_boards with (security_invoker = true) as
select
  b.id as board_id,
  b.org_id,
  b.workspace_id,
  app.resolve_board_role(om.role, wm.role, bm.role, b.visibility, b.workspace_access) as role,
  (om.role in ('owner', 'admin') and wm.role is null and bm.role is null) as via_override
from app.boards b
join app.organization_members om on om.org_id = b.org_id and om.user_id = app.current_user_id()
left join app.workspace_members wm on wm.workspace_id = b.workspace_id and wm.user_id = om.user_id
left join app.board_members bm on bm.board_id = b.id and bm.user_id = om.user_id
where app.resolve_board_role(om.role, wm.role, bm.role, b.visibility, b.workspace_access) is not null;

create view app.my_workspaces with (security_invoker = true) as
select
  w.id as workspace_id,
  w.org_id,
  case when om.role in ('owner', 'admin') then 'admin' else wm.role end as role
from app.workspaces w
join app.organization_members om on om.org_id = w.org_id and om.user_id = app.current_user_id()
left join app.workspace_members wm on wm.workspace_id = w.id and wm.user_id = om.user_id
where om.role in ('owner', 'admin') or wm.role is not null;

-- Rol efectivo de cada miembro de la organización en un tablero (para asignaciones y menciones).
create or replace function app.board_roles(p_board_id uuid)
returns table (user_id uuid, role text)
language sql stable security invoker as $$
  select om.user_id,
         app.resolve_board_role(om.role, wm.role, bm.role, b.visibility, b.workspace_access)
  from app.boards b
  join app.organization_members om on om.org_id = b.org_id
  left join app.workspace_members wm on wm.workspace_id = b.workspace_id and wm.user_id = om.user_id
  left join app.board_members bm on bm.board_id = b.id and bm.user_id = om.user_id
  where b.id = p_board_id
    and app.resolve_board_role(om.role, wm.role, bm.role, b.visibility, b.workspace_access) is not null
$$;

-- ───────────────────────── Row-Level Security ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces', 'workspace_members', 'boards', 'board_members', 'lists', 'cards',
    'card_assignees', 'labels', 'card_labels', 'checklists', 'checklist_items',
    'card_relations', 'comments', 'comment_mentions', 'attachments', 'notifications',
    'activity_logs', 'invitations', 'organization_members'
  ] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on app.%I to app_rw using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()))',
      t
    );
  end loop;
end $$;

alter table app.organizations enable row level security;
create policy tenant_isolation on app.organizations to app_rw
  using (id in (select app.user_org_ids()))
  with check (id in (select app.user_org_ids()));

-- Las notificaciones solo las lee, marca o borra su destinatario (cualquier miembro puede generarlas).
create policy own_notifications_select on app.notifications as restrictive for select to app_rw
  using (user_id = app.current_user_id());
create policy own_notifications_update on app.notifications as restrictive for update to app_rw
  using (user_id = app.current_user_id());
create policy own_notifications_delete on app.notifications as restrictive for delete to app_rw
  using (user_id = app.current_user_id());

alter table app.users enable row level security;
create policy visible_users on app.users for select to app_rw
  using (id in (select app.visible_user_ids()));
create policy self_update on app.users for update to app_rw
  using (id = app.current_user_id()) with check (id = app.current_user_id());

alter table app.sessions enable row level security;
create policy own_sessions on app.sessions to app_rw
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

alter table app.mfa_recovery_codes enable row level security;
create policy own_codes on app.mfa_recovery_codes to app_rw
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());

alter table app.auth_tokens enable row level security;
-- sin políticas: solo la sesión de sistema accede.

alter table app.audit_logs enable row level security;
create policy audit_insert on app.audit_logs for insert to app_rw
  with check (actor_id is not distinct from app.current_user_id());
create policy audit_read on app.audit_logs for select to app_rw
  using (org_id in (
    select m.org_id from app.organization_members m
    where m.user_id = app.current_user_id() and m.role in ('owner', 'admin')
  ));

alter table app.rate_limits enable row level security;
alter table app.storage_gc enable row level security;

-- ───────────────────────── Permisos del rol de aplicación ─────────────────────────

grant select, insert, update, delete on all tables in schema app to app_rw;
revoke all on app.rate_limits, app.storage_gc, app.auth_tokens from app_rw;
revoke update, delete on app.audit_logs from app_rw;
revoke insert, delete on app.users from app_rw;
grant select on app.my_boards, app.my_workspaces to app_rw;
grant usage on all sequences in schema app to app_rw;
grant execute on all functions in schema app to app_rw;
