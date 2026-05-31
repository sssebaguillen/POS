-- Advanced analytics: sobrestock / capital comprado de más.
--
-- get_overstock detecta productos que SÍ rotan pero se compró de más: cobertura
-- (meses de stock = stock ÷ velocidad mensual) >= OVERSTOCK_MIN_MONTHS.
--
-- A diferencia de get_dead_stock (stock inmovilizado, eje recencia), acá la plata NO
-- está congelada — se va a vender, solo que tarda demasiado. Por eso el titular es el
-- EXCEDENTE (lo que pasa de la cobertura objetivo), no el stock entero:
--   excess_capital = frozen_capital × (months_of_stock − OVERSTOCK_MIN_MONTHS) / months_of_stock
-- Es variant-safe: usa la proporción del capital, no el costo unitario (que con
-- variantes varía por variante).
--
-- Velocidad (fix del bug de la v1): units_90d ÷ (min(90, age)/30) meses. Dividir por
-- los meses REALES de historia (no por 3 fijo) evita inflar la cobertura de productos
-- recién salidos de la gracia. Por eso además se exige >= NEW_MIN_AGE días de historia
-- para una velocidad confiable.
--
-- Mutuamente excluyente con get_dead_stock: un producto sin ventas en 90d tiene
-- velocidad 0 → cobertura indefinida → nunca cae acá.
--
-- Constantes:
--   NEW_MIN_AGE          = 30 días  (mínimo de historia para velocidad confiable)
--   OVERSTOCK_MIN_MONTHS = 6  meses (cobertura para marcar sobrestock)
--
-- Devuelve: { data: OverstockRow[], total, summary }
--   data    → paginado, ordenado por excedente desc.
--   summary → total_excess_capital, total_overstock_capital, products_count.

CREATE OR REPLACE FUNCTION public.get_overstock(
  p_business_id uuid,
  p_limit       integer DEFAULT 500,
  p_offset      integer DEFAULT 0
)
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
  PERFORM public.assert_tenant(p_business_id);

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
