-- ============================================================
-- get_promo_impact — impacto de promociones para /stats
-- ============================================================
-- Lee sale_items en vivo (no snapshots: el cron nocturno no cubre "hoy"
-- y los snapshots no desglosan por promo). Líneas NETAS (regla 36):
-- revenue = SUM(si.total) ya descontado; discount_total = SUM(si.promo_discount)
-- es el descuento resignado en ambos tipos de promo (unitaria y cantidad).
-- Mismo manejo de fechas que get_top_products_detail (s.created_at::date).

CREATE OR REPLACE FUNCTION public.get_promo_impact(
  p_business_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_data   jsonb;
  v_totals jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT jsonb_agg(row) INTO v_data
  FROM (
    SELECT
      pr.id                              AS promotion_id,
      pr.name,
      pr.kind,
      pr.percent,
      pr.group_size,
      pr.affected_units,
      pr.pay_percent,
      (pr.archived_at IS NOT NULL)       AS archived,
      count(DISTINCT s.id)               AS sales_count,
      sum(si.quantity)                   AS units_sold,
      sum(si.total)                      AS revenue,
      sum(si.promo_discount)             AS discount_total
    FROM sale_items si
    JOIN sales s      ON s.id = si.sale_id
    JOIN promotions pr ON pr.id = si.promotion_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY pr.id
    ORDER BY sum(si.total) DESC
  ) row;

  SELECT jsonb_build_object(
    'promo_sales_count',    COALESCE(count(DISTINCT s.id) FILTER (WHERE si.promotion_id IS NOT NULL), 0),
    'total_sales_count',    COALESCE(count(DISTINCT s.id), 0),
    'promo_units',          COALESCE(sum(si.quantity)      FILTER (WHERE si.promotion_id IS NOT NULL), 0),
    'promo_revenue',        COALESCE(sum(si.total)         FILTER (WHERE si.promotion_id IS NOT NULL), 0),
    'promo_discount_total', COALESCE(sum(si.promo_discount) FILTER (WHERE si.promotion_id IS NOT NULL), 0)
  ) INTO v_totals
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR s.created_at::date >= p_from)
    AND (p_to   IS NULL OR s.created_at::date <= p_to);

  RETURN jsonb_build_object(
    'totals', v_totals,
    'data',   COALESCE(v_data, '[]'::jsonb)
  );
END;
$$;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_promo_impact(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promo_impact(uuid, date, date) TO authenticated, service_role;
