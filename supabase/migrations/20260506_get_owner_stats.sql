CREATE OR REPLACE FUNCTION public.get_owner_stats(
  p_date_from timestamp with time zone DEFAULT NULL,
  p_date_to   timestamp with time zone DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_business_id   uuid;
  v_total_sales   int;
  v_total_revenue numeric;
  v_top_products  json;
  v_sale_history  json;
BEGIN
  SELECT business_id INTO v_business_id
  FROM profiles
  WHERE id = auth.uid();

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'caller_not_found');
  END IF;

  -- Totales: ventas sin operador asignado (hechas por el owner)
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(total), 0)
  INTO v_total_sales, v_total_revenue
  FROM sales
  WHERE business_id = v_business_id
    AND operator_id IS NULL
    AND status = 'completed'
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to   IS NULL OR created_at <= p_date_to);

  -- Top 5 productos
  SELECT json_agg(t) INTO v_top_products
  FROM (
    SELECT
      p.name AS product_name,
      SUM(si.quantity)::int AS total_quantity,
      SUM(si.quantity * si.unit_price) AS total_revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.business_id = v_business_id
      AND s.operator_id IS NULL
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR s.created_at <= p_date_to)
    GROUP BY p.id, p.name
    ORDER BY total_quantity DESC
    LIMIT 5
  ) t;

  -- Historial (últimas 50)
  SELECT json_agg(t) INTO v_sale_history
  FROM (
    SELECT
      s.id,
      s.total,
      s.created_at,
      s.status,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)::int AS items_count
    FROM sales s
    WHERE s.business_id = v_business_id
      AND s.operator_id IS NULL
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR s.created_at <= p_date_to)
    ORDER BY s.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'success',       true,
    'total_sales',   v_total_sales,
    'total_revenue', v_total_revenue,
    'top_products',  COALESCE(v_top_products, '[]'::json),
    'sale_history',  COALESCE(v_sale_history, '[]'::json)
  );
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;
