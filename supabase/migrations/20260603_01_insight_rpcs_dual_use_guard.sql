-- P12 (paso 4, prep) — normalizar el guard de las RPC analíticas que el assembler de IA reutiliza.
--
-- Problema: el assembler corre en la Edge Function `generate-insights` como service_role (cron),
-- donde auth.uid() es NULL → get_business_id() es NULL. Las RPC get_margin_analysis / get_dead_stock /
-- get_overstock usaban `PERFORM assert_tenant(p_business_id)` INCONDICIONAL, que lanza
-- 'Contexto de negocio invalido' (ERRCODE 42501) para cualquier caller sin contexto de negocio →
-- el cron NO podía reutilizarlas, contradiciendo el plan p12 ("reusan tal cual margin/dead_stock/overstock").
--
-- Fix: alinear estas tres al MISMO patrón dual-use que ya usan los detectores Nivel 1
-- (get_product_demand_shifts / get_payment_mix_shift / get_channel_signals) y get_product_history:
--   if auth.uid() is not null then assert_tenant(p_business_id);  -- caller authenticated/UI: debe ser dueño
--   auth.uid() nulo -> único ejecutor posible es el cron service_role (anon EXECUTE revocado), trusted.
-- Para el caller authenticated el comportamiento es IDÉNTICO (assert_tenant sigue corriendo).
-- Sólo cambia la línea del guard; el cuerpo de cálculo queda intacto (verificado contra pg_get_functiondef).
--
-- Además: get_margin_analysis quedó con `anon EXECUTE = true` (la mig. 20260602_05 revocó PUBLIC pero
-- no `anon` explícito; Supabase otorga a anon por default-privileges). No era explotable (assert_tenant
-- bloqueaba a anon), pero viola la regla 34 → se revoca anon explícito aquí. dead_stock/overstock ya
-- tenían anon revocado.
--
-- NOTA: get_top_products_detail se deja con assert_tenant incondicional A PROPÓSITO: el assembler no la
-- consume (get_product_demand_shifts + get_margin_analysis cubren la señal de producto). Cambiarla sólo
-- ampliaría superficie sin beneficio funcional.

-- ============================================================================
-- 1) get_margin_analysis — guard dual-use + REVOKE anon
-- ============================================================================
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
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and si.product_id is not null
    and (p_from is null or s.created_at::date >= p_from)
    and (p_to   is null or s.created_at::date <= p_to);

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

REVOKE ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "service_role";

-- ============================================================================
-- 2) get_dead_stock — guard dual-use
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dead_stock(p_business_id uuid, p_days_threshold integer DEFAULT 90, p_bucket text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_threshold integer := GREATEST(COALESCE(p_days_threshold, 90), 1);
  v_bucket    text    := CASE
                           WHEN p_bucket IN ('never_sold','dead') THEN p_bucket
                           ELSE NULL
                         END;
  v_limit     integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_offset    integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_tenant(p_business_id);
  END IF;

  RETURN (
    WITH sales_agg AS (
      SELECT
        si.product_id,
        MAX(s.created_at) AS last_sold_at
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.business_id = p_business_id
        AND s.status = 'completed'
      GROUP BY si.product_id
    ),
    variant_agg AS (
      SELECT
        v.product_id,
        COALESCE(SUM(v.stock), 0)                            AS v_stock,
        COALESCE(SUM(v.stock * COALESCE(v.cost, 0)), 0)      AS v_capital
      FROM product_variants v
      WHERE v.business_id = p_business_id
      GROUP BY v.product_id
    ),
    base AS (
      SELECT
        p.id,
        p.name,
        p.sku,
        p.is_active,
        p.image_url,
        p.image_source,
        c.name AS category_name,
        b.name AS brand_name,
        (va.product_id IS NOT NULL)                                                  AS has_variants,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_stock   ELSE p.stock                       END AS effective_stock,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_capital ELSE p.stock * COALESCE(p.cost, 0) END AS frozen_capital,
        CASE WHEN va.product_id IS NOT NULL THEN NULL ELSE p.cost END                 AS unit_cost,
        sa.last_sold_at,
        (CURRENT_DATE - p.created_at::date)                                           AS age_days,
        CASE WHEN sa.last_sold_at IS NULL THEN NULL
             ELSE (CURRENT_DATE - sa.last_sold_at::date) END                          AS days_since_last_sale
      FROM products p
      LEFT JOIN variant_agg va ON va.product_id = p.id
      LEFT JOIN sales_agg   sa ON sa.product_id = p.id
      LEFT JOIN categories  c  ON c.id = p.category_id
      LEFT JOIN brands      b  ON b.id = p.brand_id
      WHERE p.business_id = p_business_id
    ),
    classified AS (
      SELECT
        *,
        CASE
          WHEN age_days < 14                        THEN NULL
          WHEN last_sold_at IS NULL                 THEN 'never_sold'
          WHEN days_since_last_sale >= v_threshold  THEN 'dead'
          ELSE NULL
        END AS bucket,
        (frozen_capital = 0) AS missing_cost
      FROM base
      WHERE effective_stock > 0
    ),
    filtered AS (
      SELECT *
      FROM classified
      WHERE bucket IS NOT NULL
        AND (v_bucket IS NULL OR bucket = v_bucket)
    )
    SELECT jsonb_build_object(
      'data', COALESCE((
        SELECT jsonb_agg(to_jsonb(d))
        FROM (
          SELECT
            id, name, sku, category_name, brand_name, is_active, image_url, image_source,
            has_variants, effective_stock, frozen_capital, unit_cost,
            last_sold_at, days_since_last_sale, age_days, bucket, missing_cost
          FROM filtered
          ORDER BY frozen_capital DESC, days_since_last_sale DESC NULLS LAST, name ASC
          LIMIT v_limit OFFSET v_offset
        ) d
      ), '[]'::jsonb),
      'total', (SELECT COUNT(*) FROM filtered),
      'summary', (
        SELECT jsonb_build_object(
          'total_frozen_capital',  COALESCE(SUM(frozen_capital) FILTER (WHERE bucket IS NOT NULL), 0),
          'products_with_stock',   COUNT(*),
          'products_flagged',      COUNT(*) FILTER (WHERE bucket IS NOT NULL),
          'products_missing_cost', COUNT(*) FILTER (WHERE bucket IS NOT NULL AND missing_cost),
          'count_by_bucket', jsonb_build_object(
            'never_sold', COUNT(*) FILTER (WHERE bucket = 'never_sold'),
            'dead',       COUNT(*) FILTER (WHERE bucket = 'dead')
          ),
          'capital_by_bucket', jsonb_build_object(
            'never_sold', COALESCE(SUM(frozen_capital) FILTER (WHERE bucket = 'never_sold'), 0),
            'dead',       COALESCE(SUM(frozen_capital) FILTER (WHERE bucket = 'dead'), 0)
          )
        )
        FROM classified
      )
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_dead_stock(uuid, integer, text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_dead_stock(uuid, integer, text, integer, integer) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_dead_stock(uuid, integer, text, integer, integer) TO service_role;

-- ============================================================================
-- 3) get_overstock — guard dual-use
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_overstock(p_business_id uuid, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_min_age    integer := 30;
  v_min_months numeric := 6;
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_offset     integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.assert_tenant(p_business_id);
  END IF;

  RETURN (
    WITH sales_agg AS (
      SELECT
        si.product_id,
        COALESCE(SUM(si.quantity) FILTER (WHERE s.created_at >= now() - interval '90 days'), 0) AS units_90d
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.business_id = p_business_id
        AND s.status = 'completed'
      GROUP BY si.product_id
    ),
    variant_agg AS (
      SELECT
        v.product_id,
        COALESCE(SUM(v.stock), 0)                       AS v_stock,
        COALESCE(SUM(v.stock * COALESCE(v.cost, 0)), 0) AS v_capital
      FROM product_variants v
      WHERE v.business_id = p_business_id
      GROUP BY v.product_id
    ),
    base AS (
      SELECT
        p.id, p.name, p.sku, p.is_active, p.image_url, p.image_source,
        c.name AS category_name,
        b.name AS brand_name,
        (va.product_id IS NOT NULL)                                                  AS has_variants,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_stock   ELSE p.stock                       END AS effective_stock,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_capital ELSE p.stock * COALESCE(p.cost, 0) END AS frozen_capital,
        COALESCE(sa.units_90d, 0)::numeric                                           AS units_90d,
        (CURRENT_DATE - p.created_at::date)                                          AS age_days
      FROM products p
      LEFT JOIN variant_agg va ON va.product_id = p.id
      LEFT JOIN sales_agg   sa ON sa.product_id = p.id
      LEFT JOIN categories  c  ON c.id = p.category_id
      LEFT JOIN brands      b  ON b.id = p.brand_id
      WHERE p.business_id = p_business_id
    ),
    calc AS (
      SELECT
        *,
        ROUND(units_90d / (LEAST(age_days, 90)::numeric / 30.0), 2) AS monthly_velocity
      FROM base
      WHERE effective_stock > 0
        AND age_days >= v_min_age
        AND units_90d > 0
    ),
    flagged AS (
      SELECT
        *,
        ROUND(effective_stock / monthly_velocity, 1)                                          AS months_of_stock,
        ROUND(frozen_capital * (effective_stock / monthly_velocity - v_min_months)
              / (effective_stock / monthly_velocity), 2)                                      AS excess_capital
      FROM calc
      WHERE effective_stock / monthly_velocity >= v_min_months
    )
    SELECT jsonb_build_object(
      'data', COALESCE((
        SELECT jsonb_agg(to_jsonb(d))
        FROM (
          SELECT
            id, name, sku, category_name, brand_name, is_active, image_url, image_source,
            has_variants, effective_stock, frozen_capital, monthly_velocity, months_of_stock,
            excess_capital, age_days
          FROM flagged
          ORDER BY excess_capital DESC, months_of_stock DESC, name ASC
          LIMIT v_limit OFFSET v_offset
        ) d
      ), '[]'::jsonb),
      'total', (SELECT COUNT(*) FROM flagged),
      'summary', jsonb_build_object(
        'total_excess_capital',    COALESCE((SELECT SUM(excess_capital) FROM flagged), 0),
        'total_overstock_capital', COALESCE((SELECT SUM(frozen_capital) FROM flagged), 0),
        'products_count',          (SELECT COUNT(*) FROM flagged)
      )
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_overstock(uuid, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_overstock(uuid, integer, integer) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_overstock(uuid, integer, integer) TO service_role;
