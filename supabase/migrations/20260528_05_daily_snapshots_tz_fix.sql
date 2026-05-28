-- P11.1 fix: group daily snapshots by the business' local day, not UTC.
-- Sales aggregations cast s.created_at::date, which resolves in the session
-- timezone (UTC on Supabase). An evening sale (e.g. 22:00 ART = 01:00 UTC
-- next day) was bucketed into the following day's snapshot. We now cast in the
-- business' IANA timezone, mirroring get_sales_heatmap (20260528_02).
-- Expenses are unaffected: expenses.date is a plain user-entered date.

CREATE OR REPLACE FUNCTION public.upsert_daily_snapshot(
  p_business_id   uuid,
  p_snapshot_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snapshot_row public.daily_snapshots%ROWTYPE;
  v_timezone     text;
BEGIN
  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  WITH sales_base AS (
    SELECT
      COUNT(*)::integer AS sales_count,
      COALESCE(SUM(s.subtotal), 0) AS gross_revenue,
      COALESCE(SUM(s.discount), 0) AS discounts_total,
      COALESCE(SUM(s.total), 0) AS net_revenue,
      COALESCE(AVG(s.total), 0) AS avg_ticket,
      COUNT(DISTINCT s.customer_id) FILTER (WHERE s.customer_id IS NOT NULL)::integer AS customers_count
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
  ),
  item_stats AS (
    SELECT
      COALESCE(SUM(si.quantity), 0)::integer AS items_sold
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
  ),
  expense_stats AS (
    SELECT
      COALESCE(SUM(e.amount), 0) AS expenses_total,
      COALESCE(SUM(e.amount) FILTER (WHERE e.category <> 'mercaderia'), 0) AS operating_expenses_total,
      COALESCE(SUM(e.amount) FILTER (WHERE e.category = 'mercaderia'), 0) AS inventory_expenses_total
    FROM public.expenses e
    WHERE e.business_id = p_business_id
      AND e.date = p_snapshot_date
  ),
  top_product AS (
    SELECT
      si.product_id AS top_product_id,
      MAX(p.name) AS top_product_name,
      SUM(si.quantity)::integer AS top_product_units,
      COALESCE(SUM(si.total), 0) AS top_product_revenue
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
      AND si.product_id IS NOT NULL
    GROUP BY si.product_id
    ORDER BY SUM(si.quantity) DESC, SUM(si.total) DESC, si.product_id
    LIMIT 1
  )
  INSERT INTO public.daily_snapshots (
    business_id,
    snapshot_date,
    sales_count,
    items_sold,
    gross_revenue,
    discounts_total,
    net_revenue,
    avg_ticket,
    customers_count,
    expenses_total,
    operating_expenses_total,
    inventory_expenses_total,
    top_product_id,
    top_product_name,
    top_product_units,
    top_product_revenue,
    updated_at
  )
  SELECT
    p_business_id,
    p_snapshot_date,
    sb.sales_count,
    ist.items_sold,
    sb.gross_revenue,
    sb.discounts_total,
    sb.net_revenue,
    sb.avg_ticket,
    sb.customers_count,
    es.expenses_total,
    es.operating_expenses_total,
    es.inventory_expenses_total,
    tp.top_product_id,
    tp.top_product_name,
    COALESCE(tp.top_product_units, 0),
    COALESCE(tp.top_product_revenue, 0),
    now()
  FROM sales_base sb
  CROSS JOIN item_stats ist
  CROSS JOIN expense_stats es
  LEFT JOIN top_product tp ON true
  ON CONFLICT (business_id, snapshot_date) DO UPDATE
  SET
    sales_count              = EXCLUDED.sales_count,
    items_sold               = EXCLUDED.items_sold,
    gross_revenue            = EXCLUDED.gross_revenue,
    discounts_total          = EXCLUDED.discounts_total,
    net_revenue              = EXCLUDED.net_revenue,
    avg_ticket               = EXCLUDED.avg_ticket,
    customers_count          = EXCLUDED.customers_count,
    expenses_total           = EXCLUDED.expenses_total,
    operating_expenses_total = EXCLUDED.operating_expenses_total,
    inventory_expenses_total = EXCLUDED.inventory_expenses_total,
    top_product_id           = EXCLUDED.top_product_id,
    top_product_name         = EXCLUDED.top_product_name,
    top_product_units        = EXCLUDED.top_product_units,
    top_product_revenue      = EXCLUDED.top_product_revenue,
    updated_at               = now()
  RETURNING * INTO v_snapshot_row;

  RETURN jsonb_build_object(
    'success', true,
    'data', to_jsonb(v_snapshot_row)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_daily_snapshot(uuid, date) FROM PUBLIC;

-- p_snapshot_date now defaults to NULL → resolved to the business' local
-- "yesterday" inside the body, so the nightly cron snapshots the correct day
-- regardless of the caller's session timezone.
CREATE OR REPLACE FUNCTION public.refresh_daily_snapshot(
  p_business_id   uuid,
  p_snapshot_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_timezone           text;
  v_snapshot_date      date;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  IF p_snapshot_date IS NULL THEN
    SELECT timezone INTO v_timezone
    FROM public.businesses
    WHERE id = p_business_id;

    IF v_timezone IS NULL OR v_timezone = '' THEN
      v_timezone := 'America/Argentina/Buenos_Aires';
    END IF;

    v_snapshot_date := (now() AT TIME ZONE v_timezone)::date - 1;
  ELSE
    v_snapshot_date := p_snapshot_date;
  END IF;

  RETURN public.upsert_daily_snapshot(p_business_id, v_snapshot_date);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_daily_snapshot(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_daily_snapshot(uuid, date) TO authenticated;

-- When p_snapshot_date is NULL each business is refreshed for its own local
-- "yesterday". An explicit date still applies verbatim (backfill / admin).
CREATE OR REPLACE FUNCTION public.refresh_all_daily_snapshots(
  p_snapshot_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business record;
  v_snapshot_date date;
  v_processed integer := 0;
BEGIN
  FOR v_business IN
    SELECT b.id, b.timezone
    FROM public.businesses b
  LOOP
    IF p_snapshot_date IS NULL THEN
      v_snapshot_date := (
        now() AT TIME ZONE COALESCE(NULLIF(v_business.timezone, ''), 'America/Argentina/Buenos_Aires')
      )::date - 1;
    ELSE
      v_snapshot_date := p_snapshot_date;
    END IF;

    PERFORM public.upsert_daily_snapshot(v_business.id, v_snapshot_date);
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'snapshot_date', p_snapshot_date,
    'processed_businesses', v_processed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_all_daily_snapshots(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_all_daily_snapshots(date) TO service_role;

-- Re-backfill with TZ-correct local-day buckets. daily_snapshots is a fully
-- derived table with no dependents, so we rebuild it from scratch: a clean
-- DELETE avoids stale rows for the old UTC buckets that re-bucketing would
-- otherwise leave behind (which would double-count those sales). Atomic within
-- the migration transaction.
DELETE FROM public.daily_snapshots;

WITH source_dates AS (
  SELECT DISTINCT s.business_id, (s.created_at AT TIME ZONE b.timezone)::date AS snapshot_date
  FROM public.sales s
  JOIN public.businesses b ON b.id = s.business_id
  WHERE s.status = 'completed'

  UNION

  SELECT DISTINCT e.business_id, e.date AS snapshot_date
  FROM public.expenses e
),
sales_base AS (
  SELECT
    s.business_id,
    (s.created_at AT TIME ZONE b.timezone)::date AS snapshot_date,
    COUNT(DISTINCT s.id)::integer AS sales_count,
    COALESCE(SUM(s.subtotal), 0) AS gross_revenue,
    COALESCE(SUM(s.discount), 0) AS discounts_total,
    COALESCE(SUM(s.total), 0) AS net_revenue,
    COALESCE(AVG(s.total), 0) AS avg_ticket,
    COUNT(DISTINCT s.customer_id) FILTER (WHERE s.customer_id IS NOT NULL)::integer AS customers_count
  FROM public.sales s
  JOIN public.businesses b ON b.id = s.business_id
  WHERE s.status = 'completed'
  GROUP BY s.business_id, (s.created_at AT TIME ZONE b.timezone)::date
),
item_stats AS (
  SELECT
    s.business_id,
    (s.created_at AT TIME ZONE b.timezone)::date AS snapshot_date,
    COALESCE(SUM(si.quantity), 0)::integer AS items_sold
  FROM public.sales s
  JOIN public.businesses b ON b.id = s.business_id
  JOIN public.sale_items si ON si.sale_id = s.id
  WHERE s.status = 'completed'
  GROUP BY s.business_id, (s.created_at AT TIME ZONE b.timezone)::date
),
expense_stats AS (
  SELECT
    e.business_id,
    e.date AS snapshot_date,
    COALESCE(SUM(e.amount), 0) AS expenses_total,
    COALESCE(SUM(e.amount) FILTER (WHERE e.category <> 'mercaderia'), 0) AS operating_expenses_total,
    COALESCE(SUM(e.amount) FILTER (WHERE e.category = 'mercaderia'), 0) AS inventory_expenses_total
  FROM public.expenses e
  GROUP BY e.business_id, e.date
),
top_products AS (
  SELECT *
  FROM (
    SELECT
      s.business_id,
      (s.created_at AT TIME ZONE b.timezone)::date AS snapshot_date,
      si.product_id AS top_product_id,
      MAX(p.name) AS top_product_name,
      SUM(si.quantity)::integer AS top_product_units,
      COALESCE(SUM(si.total), 0) AS top_product_revenue,
      ROW_NUMBER() OVER (
        PARTITION BY s.business_id, (s.created_at AT TIME ZONE b.timezone)::date
        ORDER BY SUM(si.quantity) DESC, SUM(si.total) DESC, si.product_id
      ) AS row_number
    FROM public.sales s
    JOIN public.businesses b ON b.id = s.business_id
    JOIN public.sale_items si ON si.sale_id = s.id
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE s.status = 'completed'
      AND si.product_id IS NOT NULL
    GROUP BY s.business_id, (s.created_at AT TIME ZONE b.timezone)::date, si.product_id
  ) ranked
  WHERE ranked.row_number = 1
)
INSERT INTO public.daily_snapshots (
  business_id,
  snapshot_date,
  sales_count,
  items_sold,
  gross_revenue,
  discounts_total,
  net_revenue,
  avg_ticket,
  customers_count,
  expenses_total,
  operating_expenses_total,
  inventory_expenses_total,
  top_product_id,
  top_product_name,
  top_product_units,
  top_product_revenue
)
SELECT
  sd.business_id,
  sd.snapshot_date,
  COALESCE(sb.sales_count, 0),
  COALESCE(ist.items_sold, 0),
  COALESCE(sb.gross_revenue, 0),
  COALESCE(sb.discounts_total, 0),
  COALESCE(sb.net_revenue, 0),
  COALESCE(sb.avg_ticket, 0),
  COALESCE(sb.customers_count, 0),
  COALESCE(es.expenses_total, 0),
  COALESCE(es.operating_expenses_total, 0),
  COALESCE(es.inventory_expenses_total, 0),
  tp.top_product_id,
  tp.top_product_name,
  COALESCE(tp.top_product_units, 0),
  COALESCE(tp.top_product_revenue, 0)
FROM source_dates sd
LEFT JOIN sales_base sb
  ON sb.business_id = sd.business_id
 AND sb.snapshot_date = sd.snapshot_date
LEFT JOIN item_stats ist
  ON ist.business_id = sd.business_id
 AND ist.snapshot_date = sd.snapshot_date
LEFT JOIN expense_stats es
  ON es.business_id = sd.business_id
 AND es.snapshot_date = sd.snapshot_date
LEFT JOIN top_products tp
  ON tp.business_id = sd.business_id
 AND tp.snapshot_date = sd.snapshot_date
ON CONFLICT (business_id, snapshot_date) DO UPDATE
SET
  sales_count              = EXCLUDED.sales_count,
  items_sold               = EXCLUDED.items_sold,
  gross_revenue            = EXCLUDED.gross_revenue,
  discounts_total          = EXCLUDED.discounts_total,
  net_revenue              = EXCLUDED.net_revenue,
  avg_ticket               = EXCLUDED.avg_ticket,
  customers_count          = EXCLUDED.customers_count,
  expenses_total           = EXCLUDED.expenses_total,
  operating_expenses_total = EXCLUDED.operating_expenses_total,
  inventory_expenses_total = EXCLUDED.inventory_expenses_total,
  top_product_id           = EXCLUDED.top_product_id,
  top_product_name         = EXCLUDED.top_product_name,
  top_product_units        = EXCLUDED.top_product_units,
  top_product_revenue      = EXCLUDED.top_product_revenue,
  updated_at               = now();
