-- Tarjetas espejo: una misma tarjeta visible en otros tableros de la organización.
-- El espejo es solo una referencia (tablero, lista y posición propias); los datos son los de la tarjeta original.
create table app.card_mirrors (
  id uuid primary key,
  org_id uuid not null,
  card_id uuid not null,
  board_id uuid not null,
  list_id uuid not null,
  position text collate "C" not null,
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (card_id, board_id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade,
  foreign key (org_id, board_id, list_id) references app.lists(org_id, board_id, id) on delete cascade
);
create index card_mirrors_list_idx on app.card_mirrors(list_id, position);
create index card_mirrors_board_idx on app.card_mirrors(board_id);

alter table app.card_mirrors enable row level security;
create policy tenant_isolation on app.card_mirrors to app_rw
  using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()));
grant select, insert, update, delete on app.card_mirrors to app_rw;
