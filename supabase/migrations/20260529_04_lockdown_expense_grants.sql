-- 20260529_04_lockdown_expense_grants.sql
--
-- Auditoría de seguridad (docs/tests/08-auditoria-seguridad.md), sección 5 — confirmación
-- de la familia de gastos `auth.uid`.
--
-- Hallazgo: las 5 RPC de gastos YA están protegidas contra cross-tenant (guard
--   `EXISTS (profiles WHERE id = auth.uid() AND business_id = p_business_id)` como primera
--   sentencia; anon → auth.uid() NULL → 'unauthorized'). NO eran explotables.
--
-- Gap menor (defensa en profundidad): seguían con EXECUTE para PUBLIC (y `create_mercaderia_expense`
--   además con un GRANT explícito a anon). Son RPC de escritura que nunca deben ser públicas.
--   Se revoca PUBLIC/anon dejando solo authenticated + service_role — consistente con el
--   patrón de las migraciones 01/02 de esta auditoría. Las llamadas legítimas son del owner
--   autenticado (role `authenticated`), así que no se rompe nada.

REVOKE EXECUTE ON FUNCTION public.create_expense(uuid, text, numeric, text, date, uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_expense(uuid, text, numeric, text, date, uuid, uuid, text, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_mercaderia_expense(uuid, text, date, uuid, uuid, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_mercaderia_expense(uuid, text, date, uuid, uuid, text, jsonb, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_expense(uuid, uuid, text, date, uuid, text, numeric, text, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_expense(uuid, uuid, text, date, uuid, text, numeric, text, text, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_expense(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_expense(uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_mercaderia_expense(uuid, uuid, text, date, uuid, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_mercaderia_expense(uuid, uuid, text, date, uuid, text, jsonb, uuid) TO authenticated;
