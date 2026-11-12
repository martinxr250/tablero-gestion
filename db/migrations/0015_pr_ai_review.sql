-- Verificación con IA de un PR contra lo que pide la tarjeta. Queda guardada junto al PR
-- (la ve todo el que ve la tarjeta, sin volver a gastar) con el commit que se analizó.
alter table app.card_dev_refs
  add column ai_review jsonb,
  add column ai_review_at timestamptz,
  add column ai_review_sha text,
  add column ai_review_by uuid references app.users(id) on delete set null;
