-- Fix operator stats contract and owner labeling in analytics RPCs

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
      o.id                              as operator_id,
      case
        when o.id is null then 'Dueño'
        else o.name
      end                               as operator_name,
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
      op.id                              AS operator_id,
      CASE
        WHEN op.id IS NULL THEN 'Dueño'
        ELSE op.name
      END                                AS operator_name,
      CASE
        WHEN op.id IS NULL THEN 'owner'
        ELSE op.role
      END                                AS role,
      COUNT(*)::int                      AS transactions,
      ROUND(SUM(s.total), 2)             AS total_revenue,
      ROUND(AVG(s.total), 2)             AS avg_ticket,
      SUM(item_totals.units)::int        AS units_sold
    FROM public.sales s
    LEFT JOIN public.operators op ON op.id = s.operator_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(si.quantity), 0) AS units
      FROM public.sale_items si
      WHERE si.sale_id = s.id
    ) item_totals ON true
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY op.id, op.name, op.role
    ORDER BY total_revenue DESC
  ) r;

  RETURN jsonb_build_object('data', COALESCE(v_rows, '[]'::jsonb));
END;
$$;
