-- P11.3 part 1: hourly sales heatmap
-- - get_sales_heatmap aggregates completed sales by (weekday, hour) in the
--   business' local timezone, returning only cells that have data.
-- - UI fills the empty cells with zeros.

CREATE OR REPLACE FUNCTION public.get_sales_heatmap(
  p_business_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
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

REVOKE ALL ON FUNCTION public.get_sales_heatmap(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_heatmap(uuid, date, date) TO authenticated;
