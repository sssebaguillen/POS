-- =============================================================================
-- PULSAR POS — FUNCIONES ANALYTICS (complemento de schema.sql)
-- Supabase project: zrnthcznbrplzpmxmkwk
-- Generated: 2026-04-10
-- =============================================================================

-- get_stats_evolution
CREATE OR REPLACE FUNCTION public.get_stats_evolution(
  p_business_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_from      date;
  v_to        date;
  v_days      int;
begin
  v_to   := coalesce(p_to,   current_date);
  v_from := coalesce(p_from, date_trunc('month', current_date)::date);
  v_days := (v_to - v_from) + 1;

  if v_days <= 60 then
    return jsonb_build_object(
      'granularity', 'day',
      'data', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'date',         sub.d_str,
            'label',        sub.d_label,
            'revenue',      sub.revenue,
            'count',        sub.cnt,
            'prev_revenue', sub.prev_revenue,
            'prev_count',   sub.prev_cnt
          )
          order by sub.d
        ), '[]'::jsonb)
        from (
          select
            day_series.d,
            to_char(day_series.d, 'YYYY-MM-DD') as d_str,
            to_char(day_series.d, 'DD/MM')       as d_label,
            coalesce(sum(s.total) filter (
              where s.created_at::date = day_series.d::date
            ), 0) as revenue,
            count(s.id) filter (
              where s.created_at::date = day_series.d::date
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where s.created_at::date = (day_series.d - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where s.created_at::date = (day_series.d - v_days * interval '1 day')::date
            )::int as prev_cnt
          from generate_series(v_from, v_to, '1 day'::interval) as day_series(d)
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              s.created_at::date = day_series.d::date
              or s.created_at::date = (day_series.d - v_days * interval '1 day')::date
            )
          group by day_series.d
        ) sub
      )
    );
  else
    return jsonb_build_object(
      'granularity', 'week',
      'data', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'date',         sub.ws_str,
            'label',        sub.ws_label,
            'revenue',      sub.revenue,
            'count',        sub.cnt,
            'prev_revenue', sub.prev_revenue,
            'prev_count',   sub.prev_cnt
          )
          order by sub.week_start
        ), '[]'::jsonb)
        from (
          select
            weeks.week_start,
            to_char(weeks.week_start, 'YYYY-MM-DD') as ws_str,
            to_char(weeks.week_start, 'DD/MM')       as ws_label,
            coalesce(sum(s.total) filter (
              where date_trunc('week', s.created_at)::date = weeks.week_start
            ), 0) as revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at)::date = weeks.week_start
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where date_trunc('week', s.created_at)::date = (weeks.week_start - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at)::date = (weeks.week_start - v_days * interval '1 day')::date
            )::int as prev_cnt
          from (
            select distinct date_trunc('week', d)::date as week_start
            from generate_series(v_from, v_to, '1 day'::interval) as gs(d)
          ) weeks
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              date_trunc('week', s.created_at)::date = weeks.week_start
              or date_trunc('week', s.created_at)::date = (weeks.week_start - v_days * interval '1 day')::date
            )
          group by weeks.week_start
        ) sub
      )
    );
  end if;
end;
$$;

-- get_stats_breakdown
CREATE OR REPLACE FUNCTION public.get_stats_breakdown(
  p_business_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_from         date;
  v_to           date;
  v_by_category  jsonb;
  v_by_brand     jsonb;
  v_by_payment   jsonb;
  v_by_operator  jsonb;
begin
  v_to   := coalesce(p_to,   current_date);
  v_from := coalesce(p_from, date_trunc('month', current_date)::date);

  -- Por categoría
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category_id',   sub.category_id,
      'category_name', sub.category_name,
      'revenue',       sub.revenue,
      'units',         sub.units
    ) order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_category
  from (
    select
      c.id                                  as category_id,
      coalesce(c.name, 'Sin categoría')     as category_name,
      round(sum(si.total), 2)               as revenue,
      sum(si.quantity)::int                 as units
    from sales s
    join sale_items si on si.sale_id = s.id
    join products p    on p.id = si.product_id
    left join categories c on c.id = p.category_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by c.id, c.name
  ) sub;

  -- Por marca
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'brand_id',   sub.brand_id,
      'brand_name', sub.brand_name,
      'revenue',    sub.revenue,
      'units',      sub.units
    ) order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_brand
  from (
    select
      b.id                            as brand_id,
      coalesce(b.name, 'Sin marca')   as brand_name,
      round(sum(si.total), 2)         as revenue,
      sum(si.quantity)::int           as units
    from sales s
    join sale_items si on si.sale_id = s.id
    join products p    on p.id = si.product_id
    left join brands b on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by b.id, b.name
  ) sub;

  -- Por método de pago
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'method',  sub.method,
      'revenue', sub.revenue,
      'count',   sub.cnt
    ) order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_payment
  from (
    select
      py.method,
      round(sum(py.amount), 2)      as revenue,
      count(distinct s.id)::int     as cnt
    from sales s
    join payments py on py.sale_id = s.id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by py.method
  ) sub;

  -- Por operario
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'operator_id',   sub.operator_id,
      'operator_name', sub.operator_name,
      'revenue',       sub.revenue,
      'count',         sub.cnt
    ) order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_operator
  from (
    select
      coalesce(o.id::text, 'unknown')   as operator_id,
      coalesce(o.name, 'Sin operador')  as operator_name,
      round(sum(s.total), 2)            as revenue,
      count(s.id)::int                  as cnt
    from sales s
    left join operators o on o.id = s.operator_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by o.id, o.name
  ) sub;

  return jsonb_build_object(
    'by_category', v_by_category,
    'by_brand',    v_by_brand,
    'by_payment',  v_by_payment,
    'by_operator', v_by_operator
  );
end;
$$;

-- get_top_products_detail
CREATE OR REPLACE FUNCTION public.get_top_products_detail(
  p_business_id uuid,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_limit       integer DEFAULT 20,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_data  jsonb;
  v_total int;
begin
  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and (p_from is null or s.created_at::date >= p_from)
    and (p_to   is null or s.created_at::date <= p_to);

  select jsonb_agg(row)
  into v_data
  from (
    select
      p.id,
      p.name,
      p.sku,
      c.name                                      as category_name,
      b.name                                      as brand_name,
      p.price,
      p.cost,
      sum(si.quantity)                            as units_sold,
      sum(si.total)                               as revenue,
      sum(si.total) - sum(si.quantity * p.cost)   as gross_profit,
      count(distinct s.id)                        as transaction_count
    from sale_items si
    join sales s         on s.id = si.sale_id
    join products p      on p.id = si.product_id
    left join categories c on c.id = p.category_id
    left join brands b     on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
    group by p.id, p.name, p.sku, c.name, b.name, p.price, p.cost
    order by units_sold desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',  coalesce(v_data, '[]'::jsonb),
    'total', v_total
  );
end;
$$;

-- get_sales_by_category_detail
CREATE OR REPLACE FUNCTION public.get_sales_by_category_detail(
  p_business_id uuid,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows  jsonb;
  v_total bigint;
BEGIN
  SELECT COUNT(DISTINCT COALESCE(c.id::text, 'sin-categoria'))
  INTO v_total
  FROM public.sale_items si
  JOIN public.sales s       ON s.id = si.sale_id
  JOIN public.products p    ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR s.created_at::date >= p_from)
    AND (p_to   IS NULL OR s.created_at::date <= p_to);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      COALESCE(c.id::text, 'sin-categoria')   AS category_id,
      COALESCE(c.name, 'Sin categoría')        AS category_name,
      COALESCE(c.icon, '📦')                   AS category_icon,
      COUNT(DISTINCT s.id)::int                AS transaction_count,
      SUM(si.quantity)::int                    AS units_sold,
      SUM(si.total)                            AS revenue,
      COUNT(DISTINCT p.id)::int                AS product_count
    FROM public.sale_items si
    JOIN public.sales s       ON s.id = si.sale_id
    JOIN public.products p    ON p.id = si.product_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY c.id, c.name, c.icon
    ORDER BY revenue DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'data',  COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$$;

-- get_sales_by_operator_detail
CREATE OR REPLACE FUNCTION public.get_sales_by_operator_detail(
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
  v_rows jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      COALESCE(op.id::text, 'unknown')   AS operator_id,
      COALESCE(op.name, 'Sin operador')  AS operator_name,
      COALESCE(op.role, 'unknown')       AS operator_role,
      COUNT(DISTINCT s.id)::int          AS transaction_count,
      SUM(s.total)                       AS revenue,
      AVG(s.total)                       AS avg_ticket,
      SUM(si.quantity)::int              AS units_sold
    FROM public.sales s
    LEFT JOIN public.operators op   ON op.id = s.operator_id
    LEFT JOIN public.sale_items si  ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY op.id, op.name, op.role
    ORDER BY revenue DESC
  ) r;

  RETURN jsonb_build_object('data', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

-- get_sales_by_payment_detail
CREATE OR REPLACE FUNCTION public.get_sales_by_payment_detail(
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
  v_rows jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      pay.method,
      COUNT(DISTINCT s.id)::int   AS transaction_count,
      SUM(pay.amount)             AS total_amount,
      AVG(pay.amount)             AS avg_amount,
      ROUND(
        SUM(pay.amount) * 100.0 /
        NULLIF(SUM(SUM(pay.amount)) OVER (), 0),
        2
      )                           AS percentage
    FROM public.payments pay
    JOIN public.sales s ON s.id = pay.sale_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND pay.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY pay.method
    ORDER BY total_amount DESC
  ) r;

  RETURN jsonb_build_object('data', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

-- get_stats_kpis (versión completa con declaración correcta de variables)
CREATE OR REPLACE FUNCTION public.get_stats_kpis(
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
  v_from        date;
  v_to          date;
  v_prev_from   date;
  v_prev_to     date;
  v_days        int;
  v_total_sales     int;
  v_total_revenue   numeric;
  v_total_units     int;
  v_avg_ticket      numeric;
  v_prev_sales      int;
  v_prev_revenue    numeric;
  v_prev_units      int;
  v_peak_day        text;
  v_peak_revenue    numeric;
  v_day_of_week     jsonb;
BEGIN
  v_to   := COALESCE(p_to,   CURRENT_DATE);
  v_from := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
  v_days      := (v_to - v_from) + 1;
  v_prev_to   := v_from - interval '1 day';
  v_prev_from := v_prev_to - (v_days - 1) * interval '1 day';

  SELECT
    COUNT(*)::int,
    COALESCE(SUM(s.total), 0),
    COALESCE(SUM(si_totals.units), 0)::int,
    CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(s.total) / COUNT(*), 2) ELSE 0 END
  INTO v_total_sales, v_total_revenue, v_total_units, v_avg_ticket
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(si.quantity), 0) AS units
    FROM sale_items si WHERE si.sale_id = s.id
  ) si_totals ON true
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_from AND v_to;

  SELECT
    COUNT(*)::int,
    COALESCE(SUM(s.total), 0),
    COALESCE(SUM(si_totals.units), 0)::int
  INTO v_prev_sales, v_prev_revenue, v_prev_units
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(si.quantity), 0) AS units
    FROM sale_items si WHERE si.sale_id = s.id
  ) si_totals ON true
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_prev_from AND v_prev_to;

  SELECT
    to_char(s.created_at::date, 'YYYY-MM-DD'),
    ROUND(SUM(s.total), 2)
  INTO v_peak_day, v_peak_revenue
  FROM sales s
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_from AND v_to
  GROUP BY s.created_at::date
  ORDER BY SUM(s.total) DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'dow',     dow_num,
      'label',   CASE dow_num
                   WHEN 0 THEN 'Dom' WHEN 1 THEN 'Lun' WHEN 2 THEN 'Mar'
                   WHEN 3 THEN 'Mié' WHEN 4 THEN 'Jue' WHEN 5 THEN 'Vie'
                   ELSE 'Sáb' END,
      'revenue', ROUND(COALESCE(revenue, 0), 2),
      'count',   COALESCE(cnt, 0)::int
    ) ORDER BY dow_num
  ), '[]'::jsonb)
  INTO v_day_of_week
  FROM (
    SELECT
      EXTRACT(DOW FROM s.created_at)::int AS dow_num,
      SUM(s.total)                         AS revenue,
      COUNT(*)                             AS cnt
    FROM sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND s.created_at::date BETWEEN v_from AND v_to
    GROUP BY EXTRACT(DOW FROM s.created_at)::int
  ) dow_data;

  RETURN jsonb_build_object(
    'total_sales',        v_total_sales,
    'total_revenue',      v_total_revenue,
    'total_units',        v_total_units,
    'avg_ticket',         v_avg_ticket,
    'prev_total_sales',   v_prev_sales,
    'prev_total_revenue', v_prev_revenue,
    'prev_total_units',   v_prev_units,
    'peak_day',           v_peak_day,
    'peak_revenue',       v_peak_revenue,
    'day_of_week',        v_day_of_week,
    'period_from',        v_from,
    'period_to',          v_to
  );
END;
$$;
