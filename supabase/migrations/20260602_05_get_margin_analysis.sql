-- P12 (paso 1) — get_margin_analysis: rentabilidad por producto para la capa de IA proactiva.
-- El margen ABSOLUTO por producto ya se computaba en get_top_products_detail (gross_profit);
-- esto agrega lo que falta para el insight de pricing: margin_pct, ordenamiento por margen
-- (outliers de margen flaco/negativo) y totales del negocio.
--
-- Correctitud del costo: por la regla de pricing un producto puede tener cost=0 (no cargado) →
-- el margin_pct saldría ~100% falso. Por eso se expone units_without_cost por fila y en los
-- totales; el consumidor (assembler de IA) debe tratar el margen como NO confiable cuando hay
-- unidades sin costo. "N productos vendidos sin costo cargado" es en sí un insight accionable.
--
-- Costo usado: COALESCE(variant.cost, product.cost) por línea (mismo patrón que
-- get_top_products_detail). Es el costo ACTUAL → el margen es aproximado para ventas pasadas.
-- Líneas libres (sale_items.product_id NULL) quedan excluidas por el join a products.
-- Seguridad: SECURITY DEFINER + assert_tenant + REVOKE PUBLIC/anon + GRANT authenticated/service_role (regla 34).

CREATE OR REPLACE FUNCTION "public"."get_margin_analysis"(
  "p_business_id" "uuid",
  "p_from" "date" DEFAULT NULL::"date",
  "p_to" "date" DEFAULT NULL::"date",
  "p_limit" integer DEFAULT 50,
  "p_offset" integer DEFAULT 0
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_data    jsonb;
  v_total   int;
  v_totals  jsonb;
begin
  perform public.assert_tenant(p_business_id);

  -- total de productos distintos (para paginación)
  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and si.product_id is not null
    and (p_from is null or s.created_at::date >= p_from)
    and (p_to   is null or s.created_at::date <= p_to);

  -- totales del negocio (sobre TODO el set, no solo la página)
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
      sum(si.quantity) filter (where COALESCE(pv.cost, p.cost) = 0) as units_without_cost
    from sale_items si
    join sales s    on s.id = si.sale_id
    join products p on p.id = si.product_id
    left join product_variants pv on pv.id = si.variant_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
    group by si.product_id
  ) t;

  -- detalle por producto (página), ordenado por margen ascendente (peor margen primero = más accionable)
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
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
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

ALTER FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "service_role";
