-- Estudio de software (proyectos de diseño con documentos y diagramas) y conversaciones del asistente IA.

create table app.design_projects (
  id uuid primary key,
  org_id uuid not null,
  workspace_id uuid not null,
  -- Tablero donde se ejecuta el plan (se crea o se vincula desde el plan de proyecto).
  board_id uuid references app.boards(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  brief text not null default '' check (char_length(brief) <= 8000),
  created_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, workspace_id) references app.workspaces(org_id, id) on delete cascade
);
create index design_projects_ws_idx on app.design_projects(workspace_id, updated_at desc);

create table app.design_docs (
  id uuid primary key,
  org_id uuid not null,
  project_id uuid not null,
  kind text not null check (kind in ('vision', 'requirements', 'use_cases', 'flow', 'sequence', 'data_model', 'architecture', 'plan', 'note')),
  title text not null check (char_length(title) between 1 and 160),
  -- Estructura generada (casos de uso, plan) y fuente editable (Markdown o Mermaid).
  content jsonb not null default '{}'::jsonb,
  source text not null default '' check (char_length(source) <= 60000),
  position integer not null default 0,
  ai_generated boolean not null default false,
  updated_by uuid references app.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, project_id) references app.design_projects(org_id, id) on delete cascade
);
create index design_docs_project_idx on app.design_docs(project_id, position);

-- Conversaciones del asistente: privadas de cada persona.
create table app.ai_conversations (
  id uuid primary key,
  org_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  title text not null default 'Conversación' check (char_length(title) <= 120),
  messages jsonb not null default '[]'::jsonb,
  -- Acciones propuestas por la IA que esperan la confirmación de la persona.
  pending jsonb,
  -- Evita que dos pedidos procesen la misma conversación a la vez.
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_user_idx on app.ai_conversations(user_id, updated_at desc);

do $$
declare t text;
begin
  foreach t in array array['design_projects', 'design_docs'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy tenant_isolation on app.%I to app_rw using (org_id in (select app.user_org_ids())) with check (org_id in (select app.user_org_ids()))',
      t
    );
    execute format('grant select, insert, update, delete on app.%I to app_rw', t);
  end loop;
end $$;

alter table app.ai_conversations enable row level security;
create policy owner_only on app.ai_conversations to app_rw
  using (user_id = app.current_user_id() and org_id in (select app.user_org_ids()))
  with check (user_id = app.current_user_id() and org_id in (select app.user_org_ids()));
grant select, insert, update, delete on app.ai_conversations to app_rw;
