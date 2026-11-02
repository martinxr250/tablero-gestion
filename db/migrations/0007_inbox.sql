-- Bandeja personal: notas rápidas de cada persona que todavía no son tarjetas de ningún tablero.
create table app.inbox_items (
  id uuid primary key,
  user_id uuid not null references app.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  due_on date,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index inbox_items_user_idx on app.inbox_items(user_id, created_at desc);

alter table app.inbox_items enable row level security;
create policy own_inbox on app.inbox_items to app_rw
  using (user_id = app.current_user_id()) with check (user_id = app.current_user_id());
grant select, insert, update, delete on app.inbox_items to app_rw;
