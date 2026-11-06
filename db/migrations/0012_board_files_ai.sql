-- Archivos del tablero (PDF, imágenes, documentos) y registro de uso de IA.

create table app.board_files (
  id uuid primary key,
  org_id uuid not null,
  board_id uuid not null,
  uploader_id uuid references app.users(id) on delete set null,
  storage_key text not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null,
  -- Resumen generado por IA a pedido (no se genera solo).
  ai_summary text check (ai_summary is null or char_length(ai_summary) <= 4000),
  ai_summary_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, board_id) references app.boards(org_id, id) on delete cascade
);
create index board_files_board_idx on app.board_files(board_id, created_at desc);

-- Consumo de IA por organización: transparencia de costos y tope mensual.
create table app.ai_usage (
  id uuid primary key,
  org_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid references app.users(id) on delete set null,
  board_id uuid,
  feature text not null check (char_length(feature) <= 40),
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_org_month_idx on app.ai_usage(org_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['board_files', 'ai_usage'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on app.%I to app_rw using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()))',
      t
    );
    execute format('grant select, insert, update, delete on app.%I to app_rw', t);
  end loop;
end $$;
