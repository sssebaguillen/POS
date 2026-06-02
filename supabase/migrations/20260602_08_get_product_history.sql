-- P12 (paso 3 / Nivel 2) — get_product_history: historial profundo de UN producto para la
-- profundización dirigida. Cuando el Nivel 1 marca un producto (demand/price shift), esta RPC trae
-- el timeline mensual exacto que el modelo fuerte necesita para narrar la correlación con números:
--   "cuando X valía $A en jun-2025 vendías 13% más; lo subiste a $B sin que el costo se moviera".
--
-- Por mes (últimos p_months, incluye el mes en curso parcial):
--   ventas  -> sale_items+sales completed (todos los canales): units_sold, revenue, avg_price (=rev/units)
--   compras -> expense_items+expenses, buckeadas por expenses.date (fecha real de compra):
--              purchase_qty, avg_unit_cost (ponderado por cantidad)
--   est_margin_pct -> sólo cuando hay avg_price Y avg_unit_cost ese mes (aprox: costo de compra del mes).
-- Se agregan TODAS las variantes al nivel del producto (igual que el detector de demanda).
--
-- Matiz de costo (ver plan p12): sale_items NO guarda costo al instante de venta; el costo histórico
-- exacto disponible es el de las COMPRAS (expense_items.unit_cost). En meses sin compras avg_unit_cost
-- es null (honesto, no se inventa). El consumidor debe tratar el margen como aproximado.
--
-- Seguridad (regla 34): guard dual-use — if auth.uid() not null -> assert_tenant; el único caller con
-- auth.uid() nulo capaz de ejecutar es el cron service_role (anon revocado). Todas las queries filtran
-- business_id = p_business_id (un product_id ajeno devuelve serie vacía). REVOKE PUBLIC/anon + GRANT
-- authenticated/service_role.

CREATE OR REPLACE FUNCTION "public"."get_product_history"(
  "p_business_id" "uuid",
  "p_product_id" "uuid",
  "p_months" integer DEFAULT 12
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_months     int  := least(greatest(coalesce(p_months, 12), 1), 36);
  v_to_month   date := date_trunc('month', current_date)::date;
  v_from_month date;
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  v_from_month := (v_to_month - ((v_months - 1) || ' months')::interval)::date;

  return (
    with months as (
      select generate_series(v_from_month, v_to_month, interval '1 month')::date as m
    ),
    sales_m as (
      select date_trunc('month', s.created_at)::date as m,
             sum(si.quantity)::numeric as units,
             sum(si.total)             as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id = p_product_id
        and s.created_at >= v_from_month
      group by 1
    ),
    purch_m as (
      select date_trunc('month', e.date)::date as m,
             sum(ei.quantity)::numeric            as pq,
             sum(ei.quantity * ei.unit_cost)      as cost_sum
      from expense_items ei join expenses e on e.id = ei.expense_id
      where ei.business_id = p_business_id and ei.product_id = p_product_id
        and e.date >= v_from_month
      group by 1
    ),
    variant_agg as (
      select coalesce(sum(v.stock), 0) as v_stock
      from product_variants v
      where v.business_id = p_business_id and v.product_id = p_product_id
    ),
    series as (
      select
        mo.m as month,
        coalesce(sm.units, 0)   as units_sold,
        coalesce(sm.revenue, 0) as revenue,
        case when coalesce(sm.units, 0) > 0 then round(sm.revenue / sm.units, 2) end as avg_price,
        coalesce(pm.pq, 0)      as purchase_qty,
        case when coalesce(pm.pq, 0) > 0 then round(pm.cost_sum / pm.pq, 2) end as avg_unit_cost
      from months mo
      left join sales_m sm on sm.m = mo.m
      left join purch_m pm on pm.m = mo.m
    ),
    series2 as (
      select s.*,
        case when s.avg_price is not null and s.avg_unit_cost is not null and s.avg_price <> 0
             then round((s.avg_price - s.avg_unit_cost) / s.avg_price * 100, 2) end as est_margin_pct
      from series s
    )
    select jsonb_build_object(
      'product', (
        select jsonb_build_object(
          'id', p.id, 'name', p.name, 'sku', p.sku,
          'category_name', c.name, 'brand_name', b.name,
          'has_variants', (va.v_stock > 0 or exists (select 1 from product_variants pv where pv.business_id = p_business_id and pv.product_id = p.id)),
          'current_cost', p.cost, 'current_price', p.price,
          'effective_stock', case when exists (select 1 from product_variants pv where pv.business_id = p_business_id and pv.product_id = p.id)
                                  then (select va.v_stock) else p.stock end
        )
        from products p
        left join categories c on c.id = p.category_id
        left join brands b on b.id = p.brand_id
        cross join variant_agg va
        where p.id = p_product_id and p.business_id = p_business_id
      ),
      'window', jsonb_build_object('from_month', v_from_month, 'to_month', v_to_month, 'months', v_months),
      'series', coalesce((
        select jsonb_agg(to_jsonb(d) order by d.month)
        from (select month, units_sold, revenue, avg_price, purchase_qty, avg_unit_cost, est_margin_pct from series2) d
      ), '[]'::jsonb),
      'summary', (
        select jsonb_build_object(
          'total_units',           coalesce(sum(units_sold), 0),
          'total_revenue',         coalesce(sum(revenue), 0),
          'overall_avg_price',     case when coalesce(sum(units_sold), 0) > 0 then round(sum(revenue) / sum(units_sold), 2) end,
          'months_with_sales',     count(*) filter (where units_sold > 0),
          'months_with_purchases', count(*) filter (where purchase_qty > 0),
          'first_sale_month',      min(month) filter (where units_sold > 0),
          'last_sale_month',       max(month) filter (where units_sold > 0),
          'latest_purchase_cost',  (select s3.avg_unit_cost from series2 s3 where s3.avg_unit_cost is not null order by s3.month desc limit 1)
        )
        from series2
      )
    )
  );
end;
$$;

ALTER FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) TO "service_role";
