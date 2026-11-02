-- Planificación y comodidades: subtareas, etapas (sprints), estimaciones, control de calidad,
-- seguidores, tareas que se repiten y plantillas de tablero. Todo aditivo.

-- ───────────── Etapas de trabajo ─────────────
create table app.sprints (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  goal text check (char_length(goal) <= 500),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'closed')),
  capacity_points numeric(6, 1) check (capacity_points >= 0 and capacity_points <= 10000),
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (org_id, id),
  unique (org_id, board_id, id),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade
);
create index sprints_board_idx on app.sprints(board_id, starts_on);
-- Una sola etapa activa por tablero.
create unique index sprints_one_active_idx on app.sprints(board_id) where status = 'active';

-- ───────────── Tarjetas ─────────────
alter table app.cards
  add column parent_id uuid,
  add column sprint_id uuid,
  add column estimate_points numeric(5, 1) check (estimate_points >= 0 and estimate_points <= 1000),
  add column recurrence text check (recurrence in ('weekly', 'monthly')),
  add column qa_status text not null default 'none' check (qa_status in ('none', 'pending', 'approved', 'rejected')),
  add column qa_by uuid references app.users(id) on delete set null,
  add column qa_at timestamptz,
  add column qa_note text check (char_length(qa_note) <= 500),
  add check (parent_id is null or parent_id <> id),
  -- La subtarea y la etapa pertenecen siempre al mismo tablero que la tarjeta.
  add foreign key (org_id, board_id, parent_id) references app.cards(org_id, board_id, id) on delete set null (parent_id),
  add foreign key (org_id, board_id, sprint_id) references app.sprints(org_id, board_id, id) on delete set null (sprint_id);
create index cards_parent_idx on app.cards(parent_id) where parent_id is not null;
create index cards_sprint_idx on app.cards(sprint_id) where sprint_id is not null;
create index cards_completed_idx on app.cards(board_id, completed_at) where completed_at is not null;

-- ───────────── Tablero: control de calidad y plantillas ─────────────
alter table app.boards
  add column qa_required boolean not null default false,
  add column qa_list_id uuid,
  add column done_list_id uuid,
  add column is_template boolean not null default false,
  add foreign key (org_id, id, qa_list_id) references app.lists(org_id, board_id, id) on delete set null (qa_list_id),
  add foreign key (org_id, id, done_list_id) references app.lists(org_id, board_id, id) on delete set null (done_list_id);

alter table app.board_members add column can_review boolean not null default false;

-- ───────────── Seguidores de tarjetas ─────────────
create table app.card_watchers (
  org_id uuid not null,
  card_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references app.organization_members(org_id, user_id) on delete cascade
);
create index card_watchers_user_idx on app.card_watchers(user_id);

do $$
declare t text;
begin
  foreach t in array array['sprints', 'card_watchers'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on app.%I to app_rw using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()))',
      t
    );
    execute format('grant select, insert, update, delete on app.%I to app_rw', t);
  end loop;
end $$;
