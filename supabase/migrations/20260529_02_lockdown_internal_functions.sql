-- 20260529_02_lockdown_internal_functions.sql
--
-- Auditoría de seguridad (docs/tests/08-auditoria-seguridad.md), fix parte b.
--
-- Estas tres funciones SECURITY DEFINER NO deben ser invocables por anon/authenticated:
--   * log_audit_event           — helper interno; lo llaman 43 RPC SECURITY DEFINER
--                                 (owner postgres) que corren como owner, así que el
--                                 revoke no afecta los llamados internos. Exponerlo a
--                                 anon/auth permitía FORJAR entradas de auditoría de
--                                 cualquier negocio.
--   * upsert_daily_snapshot     — helper interno; lo llaman refresh_all_daily_snapshots
--                                 y el refresher por-negocio (ambos owner postgres).
--                                 Exponerlo permitía recomputar el snapshot de cualquier
--                                 negocio.
--   * refresh_all_daily_snapshots — recomputa snapshots de TODOS los negocios (DoS).
--                                 Único llamador legítimo: el cron diario (pg_cron ->
--                                 edge function 'refresh-daily-snapshots' -> service_role).
--
-- NO llevan guard get_business_id(): el cron corre como service_role, donde
-- get_business_id() = NULL. El aislamiento aquí se logra cerrando el EXECUTE, no con guard.
--
-- REVOKE FROM PUBLIC es necesario además de anon/authenticated: Supabase concede EXECUTE
-- por default a PUBLIC sobre toda función nueva en public, así que revocar solo a anon/auth
-- dejaría el agujero abierto vía PUBLIC.

-- log_audit_event: helper interno puro. Nadie externo lo llama.
REVOKE EXECUTE ON FUNCTION public.log_audit_event(uuid, uuid, text, text, text, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- upsert_daily_snapshot: helper interno puro. Nadie externo lo llama.
REVOKE EXECUTE ON FUNCTION public.upsert_daily_snapshot(uuid, date) FROM PUBLIC, anon, authenticated;

-- refresh_all_daily_snapshots: solo el job programado (service_role) debe ejecutarla.
REVOKE EXECUTE ON FUNCTION public.refresh_all_daily_snapshots(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_all_daily_snapshots(date) TO service_role;
