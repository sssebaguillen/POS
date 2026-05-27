-- P11.1 foundation:
-- - daily business snapshots for faster analytics and future AI context
-- - per-business/day upsert helper
-- - all-business daily refresh helper for cron/service-role

CREATE TABLE IF NOT EXISTS public.daily_snapshots (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  snapshot_date             date NOT NULL,
  sales_count               integer NOT NULL DEFAULT 0,
  items_sold                integer NOT NULL DEFAULT 0,
  gross_revenue             numeric NOT NULL DEFAULT 0,
  discounts_total           numeric NOT NULL DEFAULT 0,
  net_revenue               numeric NOT NULL DEFAULT 0,
  avg_ticket                numeric NOT NULL DEFAULT 0,
  customers_count           integer NOT NULL DEFAULT 0,
  expenses_total            numeric NOT NULL DEFAULT 0,
  operating_expenses_total  numeric NOT NULL DEFAULT 0,
  inventory_expenses_total  numeric NOT NULL DEFAULT 0,
  top_product_id            uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  top_product_name          text NULL,
  top_product_units         integer NOT NULL DEFAULT 0,
  top_product_revenue       numeric NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_snapshots_business_date_key UNIQUE (business_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS daily_snapshots_business_date_idx
  ON public.daily_snapshots (business_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS daily_snapshots_snapshot_date_idx
  ON public.daily_snapshots (snapshot_date DESC);

ALTER TABLE public.daily_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_snapshots_select_own_business ON public.daily_snapshots;
CREATE POLICY daily_snapshots_select_own_business
  ON public.daily_snapshots
  FOR SELECT
  TO authenticated
  USING (business_id = public.get_business_id());

-- No direct write policies: snapshots are generated via SECURITY DEFINER helpers.

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
BEGIN
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
      AND s.created_at::date = p_snapshot_date
  ),
  item_stats AS (
    SELECT
      COALESCE(SUM(si.quantity), 0)::integer AS items_sold
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND s.created_at::date = p_snapshot_date
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
      AND s.created_at::date = p_snapshot_date
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

CREATE OR REPLACE FUNCTION public.refresh_daily_snapshot(
  p_business_id   uuid,
  p_snapshot_date date DEFAULT (current_date - 1)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_business_id uuid;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  RETURN public.upsert_daily_snapshot(p_business_id, p_snapshot_date);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_daily_snapshot(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_daily_snapshot(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_all_daily_snapshots(
  p_snapshot_date date DEFAULT (current_date - 1)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business record;
  v_processed integer := 0;
BEGIN
  FOR v_business IN
    SELECT b.id
    FROM public.businesses b
  LOOP
    PERFORM public.upsert_daily_snapshot(v_business.id, p_snapshot_date);
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

CREATE OR REPLACE FUNCTION public.get_daily_snapshots(
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
  v_from               date;
  v_to                 date;
  v_rows               jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb);
  END IF;

  v_to := COALESCE(p_to, current_date);
  v_from := COALESCE(p_from, v_to - 29);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'snapshot_date', ds.snapshot_date,
        'sales_count', ds.sales_count,
        'items_sold', ds.items_sold,
        'gross_revenue', ds.gross_revenue,
        'discounts_total', ds.discounts_total,
        'net_revenue', ds.net_revenue,
        'avg_ticket', ds.avg_ticket,
        'customers_count', ds.customers_count,
        'expenses_total', ds.expenses_total,
        'operating_expenses_total', ds.operating_expenses_total,
        'inventory_expenses_total', ds.inventory_expenses_total,
        'top_product_id', ds.top_product_id,
        'top_product_name', ds.top_product_name,
        'top_product_units', ds.top_product_units,
        'top_product_revenue', ds.top_product_revenue
      )
      ORDER BY ds.snapshot_date
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.daily_snapshots ds
  WHERE ds.business_id = p_business_id
    AND ds.snapshot_date BETWEEN v_from AND v_to;

  RETURN jsonb_build_object('data', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_snapshots(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_snapshots(uuid, date, date) TO authenticated;

WITH source_dates AS (
  SELECT DISTINCT s.business_id, s.created_at::date AS snapshot_date
  FROM public.sales s
  WHERE s.status = 'completed'

  UNION

  SELECT DISTINCT e.business_id, e.date AS snapshot_date
  FROM public.expenses e
),
sales_base AS (
  SELECT
    s.business_id,
    s.created_at::date AS snapshot_date,
    COUNT(DISTINCT s.id)::integer AS sales_count,
    COALESCE(SUM(s.subtotal), 0) AS gross_revenue,
    COALESCE(SUM(s.discount), 0) AS discounts_total,
    COALESCE(SUM(s.total), 0) AS net_revenue,
    COALESCE(AVG(s.total), 0) AS avg_ticket,
    COUNT(DISTINCT s.customer_id) FILTER (WHERE s.customer_id IS NOT NULL)::integer AS customers_count
  FROM public.sales s
  WHERE s.status = 'completed'
  GROUP BY s.business_id, s.created_at::date
),
item_stats AS (
  SELECT
    s.business_id,
    s.created_at::date AS snapshot_date,
    COALESCE(SUM(si.quantity), 0)::integer AS items_sold
  FROM public.sales s
  JOIN public.sale_items si ON si.sale_id = s.id
  WHERE s.status = 'completed'
  GROUP BY s.business_id, s.created_at::date
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
      s.created_at::date AS snapshot_date,
      si.product_id AS top_product_id,
      MAX(p.name) AS top_product_name,
      SUM(si.quantity)::integer AS top_product_units,
      COALESCE(SUM(si.total), 0) AS top_product_revenue,
      ROW_NUMBER() OVER (
        PARTITION BY s.business_id, s.created_at::date
        ORDER BY SUM(si.quantity) DESC, SUM(si.total) DESC, si.product_id
      ) AS row_number
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE s.status = 'completed'
      AND si.product_id IS NOT NULL
    GROUP BY s.business_id, s.created_at::date, si.product_id
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
