-- Enlaces para compartir un tablero:
--   public: cualquiera con el enlace ve el tablero en solo lectura, sin cuenta.
--   join:   quien tenga sesión y el enlace se une al tablero con el rol elegido.
-- El token se busca por su hash y se guarda cifrado para que los administradores puedan volver a copiarlo.
create table app.board_share_links (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null,
  kind text not null check (kind in ('public', 'join')),
  role text not null default 'viewer' check (role in ('viewer', 'commenter', 'editor')),
  token_hash text not null unique,
  token_enc text not null,
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (board_id, kind),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade
);

alter table app.board_share_links enable row level security;
create policy tenant_isolation on app.board_share_links to app_rw
  using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()));
grant select, insert, update, delete on app.board_share_links to app_rw;
