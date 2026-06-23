-- ============================================================
-- Fix: get_sales_by_operator_detail inflaba la facturación por operador
-- ============================================================
-- BUG: la RPC hacía SUM(s.total) y AVG(s.total) sobre un LEFT JOIN a sale_items,
-- así que cada venta se contaba una vez por ítem → "Ingresos" y "Ticket promedio"
-- por operador en /stats/operators quedaban inflados por el nº de ítems por venta
-- (verificado en prod: facturación real $112.098 vs la que mostraba $223.134, ~2×).
-- transaction_count (COUNT DISTINCT) salía bien; units_sold (SUM quantity) necesita
-- el join y estaba bien.
--
-- FIX: se quita el JOIN a sale_items del agregado principal (así SUM/AVG de s.total
-- son correctos) y units_sold se calcula con una subconsulta correlacionada que se
-- apoya en idx_sale_items_sale_id. El agrupamiento (GROUP BY op.id, op.name, op.role)
-- y el output no cambian. Mismo principio que get_customer_stats.

CREATE OR REPLACE FUNCTION public.get_sales_by_operator_detail(
  p_business_id uuid,
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
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

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      COALESCE(op.id::text, 'unknown')  AS operator_id,
      COALESCE(op.name, 'Sin operador') AS operator_name,
      COALESCE(op.role, 'unknown')      AS operator_role,
      COUNT(DISTINCT s.id)::int         AS transaction_count,
      SUM(s.total)                      AS revenue,
      AVG(s.total)                      AS avg_ticket,
      COALESCE(SUM(COALESCE(
        (SELECT SUM(si.quantity) FROM public.sale_items si WHERE si.sale_id = s.id), 0
      )), 0)::int                       AS units_sold
    FROM public.sales s
    LEFT JOIN public.operators op ON op.id = s.operator_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY op.id, op.name, op.role
    ORDER BY revenue DESC
  ) r;

  RETURN jsonb_build_object('data', COALESCE(v_rows, '[]'::jsonb));
END;
$$;
