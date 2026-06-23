-- ============================================================
-- get_accounts_receivable_summary — total de cuentas por cobrar (solo lectura)
-- ============================================================
-- Devuelve, para el negocio, el total adeudado por clientes (Σ credit_balance
-- de los clientes con saldo > 0) y el conteo de deudores. Alimenta la tarjeta
-- "Por cobrar" del dashboard (info operativa de caja "de un vistazo").
--
-- El dashboard NO carga la lista de clientes, así que se agrega server-side en
-- una sola fila (sin riesgo del tope silencioso de PostgREST que afectaría a un
-- SELECT de toda la tabla de clientes).
--
-- Solo lectura: no escribe nada. Regla 34: assert_tenant + REVOKE PUBLIC/anon
-- + GRANT authenticated.

CREATE OR REPLACE FUNCTION public.get_accounts_receivable_summary(
  p_business_id uuid
)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_total   numeric;
  v_debtors integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.assert_tenant(p_business_id); END IF;

  SELECT
    COALESCE(SUM(credit_balance) FILTER (WHERE credit_balance > 0), 0),
    COUNT(*) FILTER (WHERE credit_balance > 0)
  INTO v_total, v_debtors
  FROM public.customers
  WHERE business_id = p_business_id
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'total_receivable', v_total,
    'debtors_count', v_debtors
  );
END;
$$;

ALTER FUNCTION public.get_accounts_receivable_summary(uuid) OWNER TO postgres;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_accounts_receivable_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accounts_receivable_summary(uuid) TO authenticated, service_role;
