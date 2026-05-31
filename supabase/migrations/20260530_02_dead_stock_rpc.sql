-- Advanced analytics: stock inmovilizado / capital inmovilizado.
--
-- get_dead_stock clasifica los productos CON stock disponible por el eje RECENCIA
-- (never_sold | dead) y reporta el capital inmovilizado (stock × costo).
--
-- Un solo eje, una sola acción del dueño (liquidar / dejar de reponer):
--   * never_sold → nunca registró una venta desde que entró.
--   * dead       → vendió alguna vez pero lleva >= p_days_threshold días sin moverse.
-- El eje COBERTURA (sobrestock de productos que sí rotan) es una pantalla aparte
-- ("Sobrestock", lente 2 pendiente) — NO se mezcla acá para no inflar el titular de
-- capital inmovilizado con mercadería que en realidad rota.
--
-- Señales y por qué (ver docs/todo/backlog.md "inventory_movements — tabla parcial huérfana"):
--   * Última venta → sale_items ⋈ sales (status='completed'). Fuente confiable.
--   * Capital/stock → variant-aware: si el producto tiene variantes, el stock vive en
--                     product_variants (no en products.stock); si no, products.stock.
--   * Antigüedad   → products.created_at. NO se usa inventory_movements: es una tabla
--                    parcial (no la escribe create_product) y de solo-escritura.
--
-- Incluye productos discontinuados (is_active = false) con stock — su capital sigue congelado.
-- Excluye productos demasiado nuevos (< NEW_GRACE días) para evitar falsos positivos.
--
-- Devuelve: { data: DeadStockRow[], total, summary }
--   data    → filtrado por p_bucket + paginado, ordenado por capital inmovilizado desc.
--   total   → cantidad de filas que matchean p_bucket (para paginar).
--   summary → agregados sobre TODOS los buckets (sin filtro p_bucket, sin paginar).
--
-- Constantes de clasificación (ajustables):
--   NEW_GRACE = 14 días (producto demasiado nuevo → excluido)
--   p_days_threshold = 90 días sin venta → 'dead' (default; perilla no expuesta en UI)

CREATE OR REPLACE FUNCTION public.get_dead_stock(
  p_business_id    uuid,
  p_days_threshold integer DEFAULT 90,
  p_bucket         text    DEFAULT NULL,
  p_limit          integer DEFAULT 50,
  p_offset         integer DEFAULT 0
)
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
  PERFORM public.assert_tenant(p_business_id);

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
        -- costo unitario para display: sólo tiene sentido sin variantes (con variantes el costo varía por variante)
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
          WHEN age_days < 14                        THEN NULL          -- demasiado nuevo
          WHEN last_sold_at IS NULL                 THEN 'never_sold'
          WHEN days_since_last_sale >= v_threshold  THEN 'dead'
          ELSE NULL                                                    -- vendió hace poco → rota
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
