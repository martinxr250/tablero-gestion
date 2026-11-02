-- Campos personalizados por tablero (cliente, presupuesto, versión, costo estimado…).
create table app.board_fields (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  type text not null check (type in ('text', 'number', 'currency', 'date', 'checkbox', 'select')),
  -- select: { "options": [{ "id", "name", "color" }] } · currency: { "currency": "ARS" }
  config jsonb not null default '{}'::jsonb,
  show_on_card boolean not null default true,
  position text collate "C" not null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (board_id, name),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade
);
create index board_fields_board_idx on app.board_fields(board_id, position);

create table app.card_field_values (
  org_id uuid not null,
  card_id uuid not null,
  field_id uuid not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (card_id, field_id),
  foreign key (org_id, card_id) references app.cards(org_id, id) on delete cascade,
  foreign key (org_id, field_id) references app.board_fields(org_id, id) on delete cascade
);
create index card_field_values_field_idx on app.card_field_values(field_id);

do $$
declare t text;
begin
  foreach t in array array['board_fields', 'card_field_values'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on app.%I to app_rw using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()))',
      t
    );
    execute format('grant select, insert, update, delete on app.%I to app_rw', t);
  end loop;
end $$;
