-- P12 (paso 3 / Nivel 1) — detectores de candidatos para la IA proactiva.
-- Tres RPCs de DETECCIÓN comparativa (ventana actual vs ventana previa de igual largo, estilo
-- get_period_comparison). Todo el cálculo es EXACTO en SQL: el LLM del Nivel 1 sólo lee números
-- ya calculados + pre-flags por umbral, nunca estima aritmética.
--   1. get_product_demand_shifts  — demanda + precio por producto (gancho de elasticidad)
--   2. get_payment_mix_shift      — corrimiento del mix de métodos de pago
--   3. get_channel_signals        — funnel de pedidos online + share canal catálogo vs POS
--
-- Reuso (NO se rehacen): get_margin_analysis (márgenes flacos + costo sin cargar),
-- get_dead_stock (never_sold/dead), get_overstock (meses de stock/excedente) ya cubren esos dominios.
-- Diferidos a backlog: señales de cliente (RFM/deuda) y cost creep por proveedor.
--
-- Umbrales: defaults sensatos + parametrizables (p_min_*). Las métricas exactas siempre vienen en
-- el payload; el pre-flag (flagged/flags) sólo marca lo "material" para que el assembler filtre barato.
--
-- Seguridad (regla 34): SECURITY DEFINER + search_path public,extensions. Guard dual-use:
--   if auth.uid() is not null -> assert_tenant (el caller authenticated/UI debe ser dueño del negocio);
--   auth.uid() nulo -> único ejecutor posible es el cron service_role (anon EXECUTE revocado), trusted,
--   mismo modelo que refresh_all_daily_snapshots (procesa todos los negocios). REVOKE PUBLIC/anon +
--   GRANT authenticated/service_role.
--
-- Convención de fecha: se compara s.created_at::date contra los bordes (igual que get_margin_analysis /
-- get_sales_by_payment_detail); es aprox. respecto a tz pero consistente con esas RPCs.

-- ============================================================================
-- 1) get_product_demand_shifts
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_product_demand_shifts"(
  "p_business_id" "uuid",
  "p_from" "date" DEFAULT NULL::"date",
  "p_to" "date" DEFAULT NULL::"date",
  "p_min_units_base" integer DEFAULT 5,
  "p_min_delta_pct" numeric DEFAULT 20,
  "p_limit" integer DEFAULT 50,
  "p_offset" integer DEFAULT 0
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_to        date := coalesce(p_to, current_date);
  v_from      date := coalesce(p_from, coalesce(p_to, current_date) - 29);
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
  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with cur as (
      select si.product_id, sum(si.quantity)::numeric as units, sum(si.total) as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id is not null
        and s.created_at::date between v_from and v_to
      group by si.product_id
    ),
    prev as (
      select si.product_id, sum(si.quantity)::numeric as units, sum(si.total) as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id is not null
        and s.created_at::date between v_prev_from and v_prev_to
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

ALTER FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) TO "service_role";

-- ============================================================================
-- 2) get_payment_mix_shift  (fuente idéntica a get_sales_by_payment_detail: payments+sales completed)
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_payment_mix_shift"(
  "p_business_id" "uuid",
  "p_from" "date" DEFAULT NULL::"date",
  "p_to" "date" DEFAULT NULL::"date",
  "p_min_delta_pp" numeric DEFAULT 5
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_to        date := coalesce(p_to, current_date);
  v_from      date := coalesce(p_from, coalesce(p_to, current_date) - 29);
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_pp    numeric := greatest(coalesce(p_min_delta_pp, 5), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;
  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with cur as (
      select pay.method, sum(pay.amount) as amount, count(distinct s.id) as tx
      from payments pay join sales s on s.id = pay.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and pay.status = 'completed'
        and s.created_at::date between v_from and v_to
      group by pay.method
    ),
    prev as (
      select pay.method, sum(pay.amount) as amount, count(distinct s.id) as tx
      from payments pay join sales s on s.id = pay.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and pay.status = 'completed'
        and s.created_at::date between v_prev_from and v_prev_to
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

ALTER FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "service_role";

-- ============================================================================
-- 3) get_channel_signals  (funnel pedidos online + share catálogo vs POS, actual vs previo)
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_channel_signals"(
  "p_business_id" "uuid",
  "p_from" "date" DEFAULT NULL::"date",
  "p_to" "date" DEFAULT NULL::"date",
  "p_min_delta_pp" numeric DEFAULT 5
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_to        date := coalesce(p_to, current_date);
  v_from      date := coalesce(p_from, coalesce(p_to, current_date) - 29);
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_pp    numeric := greatest(coalesce(p_min_delta_pp, 5), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;
  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with co as (
      select
        (created_at::date between v_from and v_to)           as is_cur,
        (created_at::date between v_prev_from and v_prev_to) as is_prev,
        status, total
      from catalog_orders
      where business_id = p_business_id
        and created_at::date between v_prev_from and v_to
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
        coalesce(sum(total) filter (where source = 'catalog' and created_at::date between v_from and v_to), 0)           as catalog_cur,
        coalesce(sum(total) filter (where source = 'pos'     and created_at::date between v_from and v_to), 0)           as pos_cur,
        coalesce(sum(total) filter (where source = 'catalog' and created_at::date between v_prev_from and v_prev_to), 0) as catalog_prev,
        coalesce(sum(total) filter (where source = 'pos'     and created_at::date between v_prev_from and v_prev_to), 0) as pos_prev
      from sales
      where business_id = p_business_id and status = 'completed'
        and created_at::date between v_prev_from and v_to
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

ALTER FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "service_role";
