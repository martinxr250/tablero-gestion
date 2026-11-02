-- Quién silenció un tipo de aviso. Las preferencias solo las lee su dueño (RLS); esta función
-- responde únicamente "quién de esta lista silenció este tipo", sin exponer el resto.
create or replace function app.muted_recipients(notification_type text, recipients uuid[])
returns setof uuid
language sql stable security definer set search_path = app, pg_temp as $$
  select s.user_id from app.notification_settings s
  where s.user_id = any(recipients) and notification_type = any(s.muted)
$$;
revoke all on function app.muted_recipients(text, uuid[]) from public;
grant execute on function app.muted_recipients(text, uuid[]) to app_rw;
