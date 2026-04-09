-- Fix: get_stats_kpis, get_stats_evolution, get_stats_breakdown
-- Root cause: nested aggregate functions (jsonb_agg wrapping SUM/COUNT)
-- Solution: use subqueries to compute per-group aggregates first,
--           then jsonb_agg in the outer query.

-- ============================================================
-- get_stats_kpis (no change needed, added for completeness)
-- ============================================================

create or replace function get_stats_kpis(
  p_business_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
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
begin
  v_to   := coalesce(p_to,   current_date);
  v_from := coalesce(p_from, date_trunc('month', current_date)::date);

  v_days      := (v_to - v_from) + 1;
  v_prev_to   := v_from - interval '1 day';
  v_prev_from := v_prev_to - (v_days - 1) * interval '1 day';

  select
    count(*)::int,
    coalesce(sum(s.total), 0),
    coalesce(sum(si_totals.units), 0)::int,
    case when count(*) > 0 then round(sum(s.total) / count(*), 2) else 0 end
  into v_total_sales, v_total_revenue, v_total_units, v_avg_ticket
  from sales s
  left join lateral (
    select coalesce(sum(si.quantity), 0) as units
    from sale_items si where si.sale_id = s.id
  ) si_totals on true
  where s.business_id = p_business_id
    and s.status = 'completed'
    and s.created_at::date between v_from and v_to;

  select
    count(*)::int,
    coalesce(sum(s.total), 0),
    coalesce(sum(si_totals.units), 0)::int
  into v_prev_sales, v_prev_revenue, v_prev_units
  from sales s
  left join lateral (
    select coalesce(sum(si.quantity), 0) as units
    from sale_items si where si.sale_id = s.id
  ) si_totals on true
  where s.business_id = p_business_id
    and s.status = 'completed'
    and s.created_at::date between v_prev_from and v_prev_to;

  select
    to_char(s.created_at::date, 'YYYY-MM-DD'),
    round(sum(s.total), 2)
  into v_peak_day, v_peak_revenue
  from sales s
  where s.business_id = p_business_id
    and s.status = 'completed'
    and s.created_at::date between v_from and v_to
  group by s.created_at::date
  order by sum(s.total) desc
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'dow',     dow_num,
      'label',   case dow_num
                   when 0 then 'Dom' when 1 then 'Lun' when 2 then 'Mar'
                   when 3 then 'Mié' when 4 then 'Jue' when 5 then 'Vie'
                   else 'Sáb' end,
      'revenue', round(coalesce(revenue, 0), 2),
      'count',   coalesce(cnt, 0)::int
    )
    order by dow_num
  ), '[]'::jsonb)
  into v_day_of_week
  from (
    select
      extract(dow from s.created_at)::int as dow_num,
      sum(s.total)                         as revenue,
      count(*)                             as cnt
    from sales s
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by extract(dow from s.created_at)::int
  ) dow_data;

  return jsonb_build_object(
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
end;
$$;


-- ============================================================
-- get_stats_evolution (FIXED — nested aggregates)
-- ============================================================

create or replace function get_stats_evolution(
  p_business_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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


-- ============================================================
-- get_stats_breakdown (FIXED — nested aggregates + missing GROUP BY)
-- ============================================================

create or replace function get_stats_breakdown(
  p_business_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    )
    order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_category
  from (
    select
      c.id                                     as category_id,
      coalesce(c.name, 'Sin categoría')        as category_name,
      round(sum(si.total), 2)                  as revenue,
      sum(si.quantity)::int                    as units
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
    )
    order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_brand
  from (
    select
      b.id                                as brand_id,
      coalesce(b.name, 'Sin marca')       as brand_name,
      round(sum(si.total), 2)             as revenue,
      sum(si.quantity)::int               as units
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
    )
    order by sub.revenue desc
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

  -- Por operador
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'operator_id',   sub.operator_id,
      'operator_name', sub.operator_name,
      'revenue',       sub.revenue,
      'count',         sub.cnt
    )
    order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_operator
  from (
    select
      coalesce(o.id::text, 'unknown') as operator_id,
      coalesce(o.name, 'Sin operador') as operator_name,
      round(sum(s.total), 2)           as revenue,
      count(s.id)::int                 as cnt
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
