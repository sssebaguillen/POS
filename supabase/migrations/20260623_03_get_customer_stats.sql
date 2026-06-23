-- ============================================================
-- get_customer_stats — ranking de clientes por ventas (solo lectura)
-- ============================================================
-- Agrega, para los clientes IDENTIFICADOS (ventas con customer_id), las métricas
-- de relación comercial en el rango: facturación, nº de compras, ticket promedio,
-- unidades, última compra + el saldo actual de cuenta corriente. Alimenta la
-- página /stats/customers (ranking ordenable, molde de get_sales_by_operator_detail).
--
-- IMPORTANTE: la facturación se agrega a nivel VENTA en su propio CTE (sales_agg)
-- y las unidades en otro (units_agg) — NO se hace SUM(sales.total) sobre un JOIN a
-- sale_items, que multiplicaría la facturación por la cantidad de ítems por venta.
--
-- Solo lectura. Regla 34: assert_tenant + REVOKE PUBLIC/anon + GRANT authenticated.

CREATE OR REPLACE FUNCTION public.get_customer_stats(
  p_business_id uuid,
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_rows jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  WITH sales_agg AS (
    SELECT
      s.customer_id,
      COUNT(*)::int            AS transaction_count,
      COALESCE(SUM(s.total), 0) AS revenue,
      COALESCE(AVG(s.total), 0) AS avg_ticket,
      MAX(s.created_at)         AS last_purchase_at
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND s.customer_id IS NOT NULL
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY s.customer_id
  ),
  units_agg AS (
    SELECT
      s.customer_id,
      COALESCE(SUM(si.quantity), 0)::int AS units_sold
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND s.customer_id IS NOT NULL
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY s.customer_id
  )
  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      c.id::text            AS customer_id,
      c.name                AS customer_name,
      c.phone               AS customer_phone,
      c.credit_balance      AS credit_balance,
      sa.transaction_count  AS transaction_count,
      sa.revenue            AS revenue,
      sa.avg_ticket         AS avg_ticket,
      COALESCE(ua.units_sold, 0) AS units_sold,
      sa.last_purchase_at   AS last_purchase_at
    FROM public.customers c
    JOIN sales_agg sa ON sa.customer_id = c.id
    LEFT JOIN units_agg ua ON ua.customer_id = c.id
    WHERE c.business_id = p_business_id
      AND c.deleted_at IS NULL
    ORDER BY sa.revenue DESC
  ) r;

  RETURN jsonb_build_object('data', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

ALTER FUNCTION public.get_customer_stats(uuid, date, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_customer_stats(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_stats(uuid, date, date) TO authenticated, service_role;
