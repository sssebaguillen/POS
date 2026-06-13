-- ============================================================
-- Día contable en la timezone del negocio (plan 009)
-- ============================================================
-- Los RPCs de stats filtraban/buckeaban por día UTC (created_at::date,
-- EXTRACT(DOW ...), date_trunc('week', ...)) mientras heatmap/snapshots ya
-- usaban AT TIME ZONE b.timezone — las ventas de 21:00-24:00 ART caían en el
-- día siguiente y la página /stats se contradecía a sí misma. Patrón espejo de
-- get_operator_sales_sparkline / get_sales_heatmap: se resuelve la TZ del
-- negocio (fallback America/Argentina/Buenos_Aires) y todo el bucketing de
-- ventas pasa a (s.created_at AT TIME ZONE v_timezone).
--
-- Alcance: 16 funciones. 14 con CREATE OR REPLACE; get_owner_stats y
-- get_operator_stats cambian la firma (timestamptz -> date) => DROP + CREATE.
-- Además del created_at::date, se corrigen las expresiones de día/semana que
-- compartían el mismo bug de UTC dentro de las funciones en scope:
--   * get_stats_kpis: EXTRACT(DOW FROM s.created_at) (desglose por día semana)
--   * get_stats_evolution: date_trunc('week', s.created_at) (vista semanal)
--   * get_channel_signals: catalog_orders.created_at (funnel de pedidos)
--   * get_sales_by_payment_detail: customer_account_movements.created_at (cobros)
-- Las columnas date sin hora (expenses.date) quedan como están.
-- NO aplicada en este plan: la aplica el dueño (npm run supabase:db:push).
-- Regla 34: cada función re-asienta su REVOKE/GRANT en esta misma migración.
-- ============================================================


-- ------------------------------------------------------------
-- 1. get_business_balance
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_business_balance(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone    text;
  v_from        date;
  v_to          date;
  v_income      numeric := 0;
  v_expenses    numeric := 0;
  v_by_category jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_from := COALESCE(p_from, date_trunc('month', (now() AT TIME ZONE v_timezone)::date)::date);
  v_to   := COALESCE(p_to, (now() AT TIME ZONE v_timezone)::date);

  SELECT COALESCE(SUM(total), 0)
  INTO v_income
  FROM public.sales
  WHERE business_id = p_business_id
    AND status = 'completed'
    AND (created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_expenses
  FROM public.expenses
  WHERE business_id = p_business_id
    AND date BETWEEN v_from AND v_to;

  SELECT COALESCE(jsonb_object_agg(category, total_amount), '{}'::jsonb)
  INTO v_by_category
  FROM (
    SELECT category::text, SUM(amount) AS total_amount
    FROM public.expenses
    WHERE business_id = p_business_id
      AND date BETWEEN v_from AND v_to
    GROUP BY category
  ) sub;

  RETURN jsonb_build_object(
    'income',       v_income,
    'expenses',     v_expenses,
    'profit',       v_income - v_expenses,
    'margin',       CASE WHEN v_income > 0 THEN ROUND(((v_income - v_expenses) / v_income) * 100, 2) ELSE 0 END,
    'by_category',  v_by_category,
    'period_from',  v_from,
    'period_to',    v_to
  );
END;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_business_balance(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_balance(uuid, date, date) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 2. get_product_demand_shifts (dual-use)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_demand_shifts(
  p_business_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_min_units_base integer DEFAULT 5,
  p_min_delta_pct numeric DEFAULT 20,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_to        date;
  v_from      date;
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_base  int     := greatest(coalesce(p_min_units_base, 5), 0);
  v_min_pct   numeric := greatest(coalesce(p_min_delta_pct, 20), 0);
  v_limit     int     := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset    int     := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to, (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, coalesce(p_to, (now() at time zone v_timezone)::date) - 29);

  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with cur as (
      select si.product_id, sum(si.quantity)::numeric as units, sum(si.total) as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id is not null
        and (s.created_at at time zone v_timezone)::date between v_from and v_to
      group by si.product_id
    ),
    prev as (
      select si.product_id, sum(si.quantity)::numeric as units, sum(si.total) as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id is not null
        and (s.created_at at time zone v_timezone)::date between v_prev_from and v_prev_to
      group by si.product_id
    ),
    joined as (
      select
        coalesce(c.product_id, p.product_id) as product_id,
        coalesce(c.units, 0)   as units_cur,
        coalesce(p.units, 0)   as units_prev,
        coalesce(c.revenue, 0) as revenue_cur,
        coalesce(p.revenue, 0) as revenue_prev
      from cur c full outer join prev p on p.product_id = c.product_id
    ),
    computed as (
      select j.*,
        (units_cur - units_prev)     as units_delta,
        (revenue_cur - revenue_prev) as revenue_delta,
        greatest(units_cur, units_prev) as base_units,
        case when units_cur  > 0 then round(revenue_cur  / units_cur,  2) end as avg_price_cur,
        case when units_prev > 0 then round(revenue_prev / units_prev, 2) end as avg_price_prev,
        case when units_prev = 0 then null else round((units_cur - units_prev) / units_prev * 100, 2) end as units_delta_pct,
        case
          when units_prev = 0 and units_cur > 0 then 'new'
          when units_cur  = 0 and units_prev > 0 then 'stopped'
          when units_cur  > units_prev then 'up'
          when units_cur  < units_prev then 'down'
          else 'steady'
        end as direction
      from joined j
    ),
    enriched as (
      select cm.*,
        case when cm.avg_price_prev is null or cm.avg_price_prev = 0 then null
             else round((cm.avg_price_cur - cm.avg_price_prev) / cm.avg_price_prev * 100, 2) end as price_delta_pct,
        pr.name, pr.sku, cat.name as category_name, br.name as brand_name
      from computed cm
      join products pr on pr.id = cm.product_id
      left join categories cat on cat.id = pr.category_id
      left join brands br on br.id = pr.brand_id
    ),
    flagged as (
      select e.*,
        (e.price_delta_pct is not null and abs(e.price_delta_pct) >= v_min_pct) as price_shift
      from enriched e
      where e.base_units >= v_min_base
        and (
          e.units_delta_pct is null
          or abs(coalesce(e.units_delta_pct, 0)) >= v_min_pct
          or (e.price_delta_pct is not null and abs(e.price_delta_pct) >= v_min_pct)
        )
    )
    select jsonb_build_object(
      'window', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'length_days', v_len),
      'params', jsonb_build_object('min_units_base', v_min_base, 'min_delta_pct', v_min_pct),
      'total',  (select count(*) from flagged),
      'data', coalesce((
        select jsonb_agg(to_jsonb(d)) from (
          select
            product_id as id, name, sku, category_name, brand_name, direction, price_shift,
            units_cur, units_prev, units_delta, units_delta_pct,
            revenue_cur, revenue_prev, revenue_delta,
            avg_price_cur, avg_price_prev, price_delta_pct
          from flagged
          order by abs(revenue_delta) desc, abs(units_delta) desc, name asc
          limit v_limit offset v_offset
        ) d
      ), '[]'::jsonb),
      'summary', (
        select jsonb_build_object(
          'flagged',        count(*),
          'up',             count(*) filter (where direction = 'up'),
          'down',           count(*) filter (where direction = 'down'),
          'new',            count(*) filter (where direction = 'new'),
          'stopped',        count(*) filter (where direction = 'stopped'),
          'steady',         count(*) filter (where direction = 'steady'),
          'price_shifts',   count(*) filter (where price_shift),
          'revenue_gained', coalesce(sum(revenue_delta) filter (where revenue_delta > 0), 0),
          'revenue_lost',   coalesce(sum(revenue_delta) filter (where revenue_delta < 0), 0),
          'revenue_net',    coalesce(sum(revenue_delta), 0)
        ) from flagged
      )
    )
  );
end;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_product_demand_shifts(uuid, date, date, integer, numeric, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_demand_shifts(uuid, date, date, integer, numeric, integer, integer) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 3. get_payment_mix_shift (dual-use)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_payment_mix_shift(
  p_business_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_min_delta_pp numeric DEFAULT 5
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_to        date;
  v_from      date;
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_pp    numeric := greatest(coalesce(p_min_delta_pp, 5), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to, (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, coalesce(p_to, (now() at time zone v_timezone)::date) - 29);

  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with cur as (
      select pay.method, sum(pay.amount) as amount, count(distinct s.id) as tx
      from payments pay join sales s on s.id = pay.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and pay.status = 'completed'
        and (s.created_at at time zone v_timezone)::date between v_from and v_to
      group by pay.method
    ),
    prev as (
      select pay.method, sum(pay.amount) as amount, count(distinct s.id) as tx
      from payments pay join sales s on s.id = pay.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and pay.status = 'completed'
        and (s.created_at at time zone v_timezone)::date between v_prev_from and v_prev_to
      group by pay.method
    ),
    tot as (
      select coalesce((select sum(amount) from cur), 0)  as total_cur,
             coalesce((select sum(amount) from prev), 0) as total_prev
    ),
    joined as (
      select
        coalesce(c.method, p.method) as method,
        coalesce(c.amount, 0) as amount_cur,
        coalesce(p.amount, 0) as amount_prev,
        coalesce(c.tx, 0)     as tx_cur,
        coalesce(p.tx, 0)     as tx_prev
      from cur c full outer join prev p on p.method = c.method
    ),
    final as (
      select j.*,
        case when t.total_cur  > 0 then round(j.amount_cur  / t.total_cur  * 100, 2) end as share_cur,
        case when t.total_prev > 0 then round(j.amount_prev / t.total_prev * 100, 2) end as share_prev,
        (j.amount_cur - j.amount_prev) as amount_delta,
        case when j.amount_prev = 0 then null else round((j.amount_cur - j.amount_prev) / j.amount_prev * 100, 2) end as amount_delta_pct,
        round(coalesce(case when t.total_cur  > 0 then j.amount_cur  / t.total_cur  * 100 end, 0)
            - coalesce(case when t.total_prev > 0 then j.amount_prev / t.total_prev * 100 end, 0), 2) as share_delta_pp,
        case
          when j.amount_prev = 0 and j.amount_cur > 0 then 'new'
          when j.amount_cur  = 0 and j.amount_prev > 0 then 'stopped'
          when j.amount_cur  > j.amount_prev then 'up'
          when j.amount_cur  < j.amount_prev then 'down'
          else 'steady'
        end as direction
      from joined j cross join tot t
    )
    select jsonb_build_object(
      'window', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'length_days', v_len),
      'params', jsonb_build_object('min_delta_pp', v_min_pp),
      'totals', jsonb_build_object(
        'total_cur',       (select total_cur from tot),
        'total_prev',      (select total_prev from tot),
        'total_delta_pct', case when (select total_prev from tot) = 0 then null
                                else round(((select total_cur from tot) - (select total_prev from tot)) / (select total_prev from tot) * 100, 2) end
      ),
      'data', coalesce((
        select jsonb_agg(to_jsonb(d) order by abs(d.share_delta_pp) desc, d.amount_cur desc) from (
          select method, amount_cur, amount_prev, amount_delta, amount_delta_pct,
                 tx_cur, tx_prev, share_cur, share_prev, share_delta_pp, direction,
                 (abs(share_delta_pp) >= v_min_pp) as flagged
          from final
        ) d
      ), '[]'::jsonb),
      'summary', (
        select jsonb_build_object(
          'methods',         count(*),
          'methods_flagged', count(*) filter (where abs(share_delta_pp) >= v_min_pp)
        ) from final
      )
    )
  );
end;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_payment_mix_shift(uuid, date, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_mix_shift(uuid, date, date, numeric) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 4. get_channel_signals (dual-use) — incluye catalog_orders.created_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_channel_signals(
  p_business_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_min_delta_pp numeric DEFAULT 5
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_to        date;
  v_from      date;
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_pp    numeric := greatest(coalesce(p_min_delta_pp, 5), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to, (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, coalesce(p_to, (now() at time zone v_timezone)::date) - 29);

  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with co as (
      select
        ((created_at at time zone v_timezone)::date between v_from and v_to)           as is_cur,
        ((created_at at time zone v_timezone)::date between v_prev_from and v_prev_to) as is_prev,
        status, total
      from catalog_orders
      where business_id = p_business_id
        and (created_at at time zone v_timezone)::date between v_prev_from and v_to
    ),
    funnel as (
      select
        count(*) filter (where is_cur)                                       as total_cur,
        count(*) filter (where is_cur and status = 'completado')             as completed_cur,
        count(*) filter (where is_cur and status = 'rechazado')              as rejected_cur,
        count(*) filter (where is_cur and status = 'cancelado')              as cancelled_cur,
        coalesce(sum(total) filter (where is_cur and status = 'completado'), 0)  as gmv_cur,
        count(*) filter (where is_prev)                                      as total_prev,
        count(*) filter (where is_prev and status = 'completado')            as completed_prev,
        count(*) filter (where is_prev and status = 'rechazado')             as rejected_prev,
        count(*) filter (where is_prev and status = 'cancelado')             as cancelled_prev,
        coalesce(sum(total) filter (where is_prev and status = 'completado'), 0) as gmv_prev
      from co
    ),
    sales_ch as (
      select
        coalesce(sum(total) filter (where source = 'catalog' and (created_at at time zone v_timezone)::date between v_from and v_to), 0)           as catalog_cur,
        coalesce(sum(total) filter (where source = 'pos'     and (created_at at time zone v_timezone)::date between v_from and v_to), 0)           as pos_cur,
        coalesce(sum(total) filter (where source = 'catalog' and (created_at at time zone v_timezone)::date between v_prev_from and v_prev_to), 0) as catalog_prev,
        coalesce(sum(total) filter (where source = 'pos'     and (created_at at time zone v_timezone)::date between v_prev_from and v_prev_to), 0) as pos_prev
      from sales
      where business_id = p_business_id and status = 'completed'
        and (created_at at time zone v_timezone)::date between v_prev_from and v_to
    ),
    calc as (
      select f.*, sc.*,
        case when f.total_cur  = 0 then null else round(f.completed_cur::numeric / f.total_cur  * 100, 2) end as conv_cur,
        case when f.total_prev = 0 then null else round(f.completed_prev::numeric / f.total_prev * 100, 2) end as conv_prev,
        case when f.total_cur  = 0 then null else round(f.rejected_cur::numeric  / f.total_cur  * 100, 2) end as rej_cur,
        case when f.total_prev = 0 then null else round(f.rejected_prev::numeric / f.total_prev * 100, 2) end as rej_prev,
        case when (sc.catalog_cur  + sc.pos_cur)  = 0 then null else round(sc.catalog_cur  / (sc.catalog_cur  + sc.pos_cur)  * 100, 2) end as cat_share_cur,
        case when (sc.catalog_prev + sc.pos_prev) = 0 then null else round(sc.catalog_prev / (sc.catalog_prev + sc.pos_prev) * 100, 2) end as cat_share_prev
      from funnel f cross join sales_ch sc
    )
    select jsonb_build_object(
      'window', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'length_days', v_len),
      'params', jsonb_build_object('min_delta_pp', v_min_pp),
      'funnel', jsonb_build_object(
        'current',  jsonb_build_object('orders', total_cur,  'completed', completed_cur,  'rejected', rejected_cur,  'cancelled', cancelled_cur,  'gmv', gmv_cur,  'conversion_rate', conv_cur,  'rejection_rate', rej_cur),
        'previous', jsonb_build_object('orders', total_prev, 'completed', completed_prev, 'rejected', rejected_prev, 'cancelled', cancelled_prev, 'gmv', gmv_prev, 'conversion_rate', conv_prev, 'rejection_rate', rej_prev),
        'delta', jsonb_build_object(
          'orders',             total_cur - total_prev,
          'gmv',                gmv_cur - gmv_prev,
          'conversion_rate_pp', round(coalesce(conv_cur, 0) - coalesce(conv_prev, 0), 2),
          'rejection_rate_pp',  round(coalesce(rej_cur, 0)  - coalesce(rej_prev, 0),  2)
        )
      ),
      'channel', jsonb_build_object(
        'current',  jsonb_build_object('catalog_revenue', catalog_cur,  'pos_revenue', pos_cur,  'catalog_share', cat_share_cur),
        'previous', jsonb_build_object('catalog_revenue', catalog_prev, 'pos_revenue', pos_prev, 'catalog_share', cat_share_prev),
        'delta', jsonb_build_object('catalog_share_pp', round(coalesce(cat_share_cur, 0) - coalesce(cat_share_prev, 0), 2))
      ),
      'flags', jsonb_build_object(
        'rejection_up',        (round(coalesce(rej_cur, 0)  - coalesce(rej_prev, 0),  2) >= v_min_pp),
        'conversion_down',     (round(coalesce(conv_cur, 0) - coalesce(conv_prev, 0), 2) <= -v_min_pp),
        'catalog_share_shift', (abs(round(coalesce(cat_share_cur, 0) - coalesce(cat_share_prev, 0), 2)) >= v_min_pp)
      )
    )
    from calc
  );
end;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_channel_signals(uuid, date, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_channel_signals(uuid, date, date, numeric) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 5. get_promo_impact
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_promo_impact(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_data   jsonb;
  v_totals jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

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
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
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
    AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
    AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to);

  RETURN jsonb_build_object(
    'totals', v_totals,
    'data',   COALESCE(v_data, '[]'::jsonb)
  );
END;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_promo_impact(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promo_impact(uuid, date, date) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 6. get_sales_by_brand_detail
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_brand_detail(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_rows  jsonb;
  v_total bigint;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  SELECT COUNT(DISTINCT COALESCE(b.id::text, 'sin-marca'))
  INTO v_total
  FROM public.sale_items si
  JOIN public.sales    s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.brands b ON b.id = p.brand_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
    AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      COALESCE(b.id::text, 'sin-marca') AS brand_id,
      COALESCE(b.name, 'Sin marca')     AS brand_name,
      COUNT(DISTINCT s.id)::int         AS transaction_count,
      SUM(si.quantity)::int             AS units_sold,
      SUM(si.total)                     AS revenue,
      COUNT(DISTINCT p.id)::int         AS product_count
    FROM public.sale_items si
    JOIN public.sales    s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    LEFT JOIN public.brands b ON b.id = p.brand_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY b.id, b.name
    ORDER BY revenue DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'data',  COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_sales_by_brand_detail(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_brand_detail(uuid, date, date, integer, integer) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 7. get_sales_by_category_detail
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_category_detail(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_rows  jsonb;
  v_total bigint;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  SELECT COUNT(DISTINCT COALESCE(c.id::text, 'sin-categoria'))
  INTO v_total
  FROM public.sale_items si
  JOIN public.sales s       ON s.id = si.sale_id
  JOIN public.products p    ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
    AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to);

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
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
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

-- Regla 34
REVOKE ALL ON FUNCTION public.get_sales_by_category_detail(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_category_detail(uuid, date, date, integer, integer) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 8. get_sales_by_operator_detail
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_operator_detail(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
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
      COALESCE(op.id::text, 'unknown')       AS operator_id,
      COALESCE(op.name, 'Sin operador')      AS operator_name,
      COALESCE(op.role, 'unknown')           AS operator_role,
      COUNT(DISTINCT s.id)::int              AS transaction_count,
      SUM(s.total)                           AS revenue,
      AVG(s.total)                           AS avg_ticket,
      SUM(si.quantity)::int                  AS units_sold
    FROM public.sales s
    LEFT JOIN public.operators op ON op.id = s.operator_id
    LEFT JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY op.id, op.name, op.role
    ORDER BY revenue DESC
  ) r;

  RETURN jsonb_build_object(
    'data', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_sales_by_operator_detail(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_operator_detail(uuid, date, date) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 9. get_sales_by_payment_detail — incluye customer_account_movements.created_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_by_payment_detail(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone    text;
  v_rows        jsonb;
  v_collections jsonb;
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
      pay.method,
      COUNT(DISTINCT s.id)::int AS transactions,
      SUM(pay.amount)           AS total_amount,
      AVG(pay.amount)           AS avg_ticket
    FROM public.payments pay
    JOIN public.sales s ON s.id = pay.sale_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND pay.status = 'completed'
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY pay.method
    ORDER BY total_amount DESC
  ) r;

  SELECT jsonb_agg(row_to_json(c))
  INTO v_collections
  FROM (
    SELECT
      m.method,
      COUNT(*)::int   AS transactions,
      SUM(m.amount)   AS total_amount,
      AVG(m.amount)   AS avg_ticket
    FROM public.customer_account_movements m
    WHERE m.business_id = p_business_id
      AND m.type = 'payment'
      AND (p_from IS NULL OR (m.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (m.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY m.method
    ORDER BY total_amount DESC
  ) c;

  RETURN jsonb_build_object(
    'data',        COALESCE(v_rows, '[]'::jsonb),
    'collections', COALESCE(v_collections, '[]'::jsonb)
  );
END;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_sales_by_payment_detail(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_payment_detail(uuid, date, date) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 10. get_stats_breakdown
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stats_breakdown(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_timezone     text;
  v_from         date;
  v_to           date;
  v_by_category  jsonb;
  v_by_brand     jsonb;
  v_by_payment   jsonb;
  v_by_operator  jsonb;
begin
  perform public.assert_tenant(p_business_id);

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to,   (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, date_trunc('month', (now() at time zone v_timezone)::date)::date);

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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
    group by c.id, c.name
  ) sub;

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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
    group by b.id, b.name
  ) sub;

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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
    group by py.method
  ) sub;

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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
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

-- Regla 34
REVOKE ALL ON FUNCTION public.get_stats_breakdown(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stats_breakdown(uuid, date, date) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 11. get_stats_evolution — incluye date_trunc('week', ...) en TZ local
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stats_evolution(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_from      date;
  v_to        date;
  v_days      int;
begin
  perform public.assert_tenant(p_business_id);

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to,   (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, date_trunc('month', (now() at time zone v_timezone)::date)::date);
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
              where (s.created_at at time zone v_timezone)::date = day_series.d::date
            ), 0) as revenue,
            count(s.id) filter (
              where (s.created_at at time zone v_timezone)::date = day_series.d::date
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where (s.created_at at time zone v_timezone)::date = (day_series.d - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where (s.created_at at time zone v_timezone)::date = (day_series.d - v_days * interval '1 day')::date
            )::int as prev_cnt
          from generate_series(v_from, v_to, '1 day'::interval) as day_series(d)
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              (s.created_at at time zone v_timezone)::date = day_series.d::date
              or (s.created_at at time zone v_timezone)::date = (day_series.d - v_days * interval '1 day')::date
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
              where date_trunc('week', s.created_at at time zone v_timezone)::date = weeks.week_start
            ), 0) as revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at at time zone v_timezone)::date = weeks.week_start
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where date_trunc('week', s.created_at at time zone v_timezone)::date = (weeks.week_start - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at at time zone v_timezone)::date = (weeks.week_start - v_days * interval '1 day')::date
            )::int as prev_cnt
          from (
            select distinct date_trunc('week', d)::date as week_start
            from generate_series(v_from, v_to, '1 day'::interval) as gs(d)
          ) weeks
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              date_trunc('week', s.created_at at time zone v_timezone)::date = weeks.week_start
              or date_trunc('week', s.created_at at time zone v_timezone)::date = (weeks.week_start - v_days * interval '1 day')::date
            )
          group by weeks.week_start
        ) sub
      )
    );
  end if;
end;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_stats_evolution(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stats_evolution(uuid, date, date) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 12. get_stats_kpis — incluye EXTRACT(DOW ...) en TZ local
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_stats_kpis(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone    text;
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
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_to   := COALESCE(p_to,   (now() AT TIME ZONE v_timezone)::date);
  v_from := COALESCE(p_from, date_trunc('month', (now() AT TIME ZONE v_timezone)::date)::date);

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
    AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to;

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
    AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_prev_from AND v_prev_to;

  SELECT
    to_char((s.created_at AT TIME ZONE v_timezone)::date, 'YYYY-MM-DD'),
    ROUND(SUM(s.total), 2)
  INTO v_peak_day, v_peak_revenue
  FROM sales s
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
  GROUP BY (s.created_at AT TIME ZONE v_timezone)::date
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
    )
    ORDER BY dow_num
  ), '[]'::jsonb)
  INTO v_day_of_week
  FROM (
    SELECT
      EXTRACT(DOW FROM (s.created_at AT TIME ZONE v_timezone))::int AS dow_num,
      SUM(s.total)                         AS revenue,
      COUNT(*)                             AS cnt
    FROM sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
    GROUP BY EXTRACT(DOW FROM (s.created_at AT TIME ZONE v_timezone))::int
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

-- Regla 34
REVOKE ALL ON FUNCTION public.get_stats_kpis(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_stats_kpis(uuid, date, date) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 13. get_top_products_detail
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_top_products_detail(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_timezone text;
  v_data  jsonb;
  v_total int;
begin
  perform public.assert_tenant(p_business_id);

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
    and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to);

  select jsonb_agg(row)
  into v_data
  from (
    select
      p.id,
      p.name,
      p.sku,
      c.name                                                    as category_name,
      b.name                                                    as brand_name,
      COALESCE(pv_def.price, p.price)                          as price,
      COALESCE(pv_def.cost,  p.cost)                           as cost,
      sum(si.quantity)                                          as units_sold,
      sum(si.total)                                             as revenue,
      sum(si.total) - sum(si.quantity * COALESCE(pv.cost, p.cost)) as gross_profit,
      count(distinct s.id)                                      as transaction_count
    from sale_items si
    join sales s           on s.id = si.sale_id
    join products p        on p.id = si.product_id
    left join product_variants pv     on pv.id = si.variant_id
    left join product_variants pv_def on pv_def.id = p.default_variant_id
    left join categories c on c.id = p.category_id
    left join brands b     on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
      and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to)
    group by p.id, p.name, p.sku, c.name, b.name, p.price, p.cost, pv_def.price, pv_def.cost
    order by units_sold desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',  coalesce(v_data, '[]'::jsonb),
    'total', v_total
  );
end;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_top_products_detail(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_products_detail(uuid, date, date, integer, integer) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 14. get_margin_analysis (dual-use)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_margin_analysis(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_timezone text;
  v_data    jsonb;
  v_total   int;
  v_totals  jsonb;
begin
  if auth.uid() is not null then perform public.assert_tenant(p_business_id); end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and si.product_id is not null
    and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
    and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to);

  select jsonb_build_object(
    'revenue',              coalesce(sum(t.revenue), 0),
    'cost_total',           coalesce(sum(t.cost_total), 0),
    'gross_profit',         coalesce(sum(t.revenue) - sum(t.cost_total), 0),
    'margin_pct',           case when coalesce(sum(t.revenue), 0) = 0 then null
                                 else round((sum(t.revenue) - sum(t.cost_total)) / sum(t.revenue) * 100, 2) end,
    'products_count',       count(*),
    'products_without_cost', count(*) filter (where t.units_without_cost > 0)
  )
  into v_totals
  from (
    select
      si.product_id,
      sum(si.total)                                              as revenue,
      sum(si.quantity * COALESCE(pv.cost, p.cost))               as cost_total,
      coalesce(sum(si.quantity) filter (where COALESCE(pv.cost, p.cost) = 0), 0) as units_without_cost
    from sale_items si
    join sales s    on s.id = si.sale_id
    join products p on p.id = si.product_id
    left join product_variants pv on pv.id = si.variant_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
      and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to)
    group by si.product_id
  ) t;

  select jsonb_agg(row)
  into v_data
  from (
    select
      p.id,
      p.name,
      p.sku,
      c.name as category_name,
      b.name as brand_name,
      sum(si.quantity)                                                       as units_sold,
      coalesce(sum(si.quantity) filter (where COALESCE(pv.cost, p.cost) = 0), 0) as units_without_cost,
      sum(si.total)                                                as revenue,
      sum(si.quantity * COALESCE(pv.cost, p.cost))                 as cost_total,
      sum(si.total) - sum(si.quantity * COALESCE(pv.cost, p.cost)) as gross_profit,
      case when sum(si.total) = 0 then null
           else round((sum(si.total) - sum(si.quantity * COALESCE(pv.cost, p.cost))) / sum(si.total) * 100, 2)
      end                                                          as margin_pct
    from sale_items si
    join sales s    on s.id = si.sale_id
    join products p on p.id = si.product_id
    left join product_variants pv on pv.id = si.variant_id
    left join categories c on c.id = p.category_id
    left join brands b     on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
      and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to)
    group by p.id, p.name, p.sku, c.name, b.name
    order by margin_pct asc nulls last, revenue desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',   coalesce(v_data, '[]'::jsonb),
    'total',  v_total,
    'totals', v_totals
  );
end;
$$;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_margin_analysis(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_margin_analysis(uuid, date, date, integer, integer) TO authenticated, service_role;


-- ============================================================
-- 15-16. Cambio de firma timestamptz -> date (DROP + CREATE)
-- ============================================================
-- El caller actual (operator/me) manda strings ISO con offset -03:00; el cast
-- text->date toma la parte textual de la fecha (verificado: ignora hora/offset),
-- así que la ventana entre aplicar esta migración y deployar el plan 010 es
-- compatible. El plan 010 pasa a mandar dates planas.

DROP FUNCTION IF EXISTS public.get_owner_stats(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_operator_stats(uuid, timestamptz, timestamptz);


-- 15. get_owner_stats
CREATE FUNCTION public.get_owner_stats(p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id   uuid;
  v_timezone      text;
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

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = v_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
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
    AND (p_date_from IS NULL OR (created_at AT TIME ZONE v_timezone)::date >= p_date_from)
    AND (p_date_to   IS NULL OR (created_at AT TIME ZONE v_timezone)::date <= p_date_to);

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
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
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
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
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

ALTER FUNCTION public.get_owner_stats(date, date) OWNER TO postgres;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_owner_stats(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_stats(date, date) TO authenticated, service_role;


-- 16. get_operator_stats
CREATE FUNCTION public.get_operator_stats(p_operator_id uuid, p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_id uuid;
  v_business_id uuid;
  v_operator_business_id uuid;
  v_timezone text;
  v_total_sales int;
  v_total_revenue numeric;
  v_top_products json;
  v_sale_history json;
BEGIN
  v_caller_id := auth.uid();

  -- Obtener business_id del caller
  SELECT business_id INTO v_business_id
  FROM profiles
  WHERE id = v_caller_id;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'caller_not_found');
  END IF;

  -- Verificar que el operario pertenece al mismo business
  SELECT business_id INTO v_operator_business_id
  FROM operators
  WHERE id = p_operator_id;

  IF v_operator_business_id <> v_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = v_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  -- Totales
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(total), 0)
  INTO v_total_sales, v_total_revenue
  FROM sales
  WHERE operator_id = p_operator_id
    AND business_id = v_business_id
    AND status = 'completed'
    AND (p_date_from IS NULL OR (created_at AT TIME ZONE v_timezone)::date >= p_date_from)
    AND (p_date_to   IS NULL OR (created_at AT TIME ZONE v_timezone)::date <= p_date_to);

  -- Top 5 productos vendidos por este operario
  SELECT json_agg(t) INTO v_top_products
  FROM (
    SELECT
      p.name AS product_name,
      SUM(si.quantity)::int AS total_quantity,
      SUM(si.quantity * si.unit_price) AS total_revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.operator_id = p_operator_id
      AND s.business_id = v_business_id
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
    GROUP BY p.id, p.name
    ORDER BY total_quantity DESC
    LIMIT 5
  ) t;

  -- Historial de ventas (últimas 50)
  SELECT json_agg(t) INTO v_sale_history
  FROM (
    SELECT
      s.id,
      s.total,
      s.created_at,
      s.status,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)::int AS items_count
    FROM sales s
    WHERE s.operator_id = p_operator_id
      AND s.business_id = v_business_id
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
    ORDER BY s.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'success',        true,
    'total_sales',    v_total_sales,
    'total_revenue',  v_total_revenue,
    'top_products',   COALESCE(v_top_products, '[]'::json),
    'sale_history',   COALESCE(v_sale_history, '[]'::json)
  );
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;

ALTER FUNCTION public.get_operator_stats(uuid, date, date) OWNER TO postgres;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_operator_stats(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operator_stats(uuid, date, date) TO authenticated, service_role;
