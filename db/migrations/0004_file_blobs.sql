-- Almacenamiento de adjuntos dentro de Postgres (STORAGE_DRIVER=database).
-- Alternativa a Supabase Storage para instalaciones chicas: no requiere la clave secreta del proyecto.
-- Solo la usa el servidor con withSystem; app_rw no tiene permisos y RLS queda activo sin políticas.
create table app.file_blobs (
  key text primary key check (key ~ '^[a-zA-Z0-9/_-]+$'),
  content_type text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
alter table app.file_blobs enable row level security;
revoke all on app.file_blobs from app_rw;
