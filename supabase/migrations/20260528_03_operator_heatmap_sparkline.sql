-- P11.3.5 — heatmap y sparkline per-operador (perfil /operator/me)
-- - get_sales_heatmap: nuevo parámetro p_operator_id (opcional).
--   * NULL  → sin filtro de operador (todas las ventas del negocio)
--   * sentinel '00000000-0000-0000-0000-000000000000' → owner (sales.operator_id IS NULL)
--   * otro UUID → sub-operador específico
--   Mismo patrón que get_audit_log (ver CLAUDE.md regla 31).
-- - get_operator_sales_sparkline: serie diaria simple para decorar el hero del perfil.

CREATE OR REPLACE FUNCTION public.get_sales_heatmap(
  p_business_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_timezone           text;
  v_from               date;
  v_to                 date;
  v_owner_sentinel     constant uuid := '00000000-0000-0000-0000-000000000000';
  v_rows               jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb);
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_to := COALESCE(p_to, current_date);
  v_from := COALESCE(p_from, v_to - 29);

  WITH local_sales AS (
    SELECT
      EXTRACT(DOW  FROM (s.created_at AT TIME ZONE v_timezone))::smallint AS weekday,
      EXTRACT(HOUR FROM (s.created_at AT TIME ZONE v_timezone))::smallint AS hour,
      s.total
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = v_owner_sentinel AND s.operator_id IS NULL)
        OR s.operator_id = p_operator_id
      )
  ),
  agg AS (
    SELECT
      weekday,
      hour,
      COUNT(*)::integer       AS sales_count,
      COALESCE(SUM(total), 0) AS net_revenue
    FROM local_sales
    GROUP BY weekday, hour
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'weekday',     weekday,
        'hour',        hour,
        'sales_count', sales_count,
        'net_revenue', net_revenue
      )
      ORDER BY weekday, hour
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM agg;

  RETURN jsonb_build_object('data', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_heatmap(uuid, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_heatmap(uuid, date, date, uuid) TO authenticated;

-- Quitamos la firma vieja para evitar ambigüedad (3-arg vs 4-arg).
DROP FUNCTION IF EXISTS public.get_sales_heatmap(uuid, date, date);


CREATE OR REPLACE FUNCTION public.get_operator_sales_sparkline(
  p_business_id uuid,
  p_operator_id uuid DEFAULT NULL,
  p_days        integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_timezone           text;
  v_owner_sentinel     constant uuid := '00000000-0000-0000-0000-000000000000';
  v_to                 date;
  v_from               date;
  v_rows               jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb);
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_to := (now() AT TIME ZONE v_timezone)::date;
  v_from := v_to - GREATEST(COALESCE(p_days, 30) - 1, 0);

  WITH days_series AS (
    SELECT generate_series(v_from, v_to, '1 day'::interval)::date AS day
  ),
  local_sales AS (
    SELECT
      (s.created_at AT TIME ZONE v_timezone)::date AS day,
      s.total
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = v_owner_sentinel AND s.operator_id IS NULL)
        OR s.operator_id = p_operator_id
      )
  ),
  agg AS (
    SELECT
      ds.day,
      COALESCE(SUM(ls.total), 0) AS total,
      COUNT(ls.total)::integer    AS sales_count
    FROM days_series ds
    LEFT JOIN local_sales ls ON ls.day = ds.day
    GROUP BY ds.day
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',         day,
        'total',       total,
        'sales_count', sales_count
      )
      ORDER BY day
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM agg;

  RETURN jsonb_build_object('data', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_operator_sales_sparkline(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_operator_sales_sparkline(uuid, uuid, integer) TO authenticated;
