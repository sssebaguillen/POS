-- ============================================================
-- get_replenishment_list — Reposición F1: lista "qué reponer" (solo lectura)
-- ============================================================
-- Devuelve los productos activos cuyo stock efectivo está en o por debajo del
-- mínimo configurado (stock <= COALESCE(min_stock, 0) — mismos criterios que
-- get_low_stock_summary), enriquecidos con velocidad de venta y días hasta
-- quiebre para PRIORIZAR la reposición.
--
-- Variant-aware: para productos con variantes el stock efectivo es la suma del
-- stock de sus variantes activas (mismo criterio que get_overstock); para el
-- resto es products.stock.
--
-- Velocidad: unidades vendidas (sale_items de ventas completed) en los últimos
-- p_window_days (default 30, clamp 7..90) / ventana => velocidad diaria.
-- Días hasta quiebre = stock_efectivo / velocidad_diaria (NULL si no hay ventas
-- en la ventana: no se puede proyectar).
--
-- Cantidad sugerida = GREATEST(min_stock - stock_efectivo, 0): cuánto pedir para
-- volver al MÍNIMO que el dueño ya configuró. NO inventa lead time ni stock de
-- seguridad (no existen en el schema). Una sugerencia más rica (velocidad ×
-- días de lead + buffer) es una decisión de producto pendiente del dueño.
--
-- Orden: sin stock primero, luego por días-hasta-quiebre asc (más urgente
-- primero, NULLS LAST), luego por velocidad desc y nombre.
--
-- Solo lectura: no escribe stock/ventas. Regla 34: assert_tenant + REVOKE
-- PUBLIC/anon + GRANT authenticated.

CREATE OR REPLACE FUNCTION public.get_replenishment_list(
  p_business_id uuid,
  p_window_days integer DEFAULT 30,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_window integer := LEAST(GREATEST(COALESCE(p_window_days, 30), 7), 90);
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.assert_tenant(p_business_id); END IF;

  RETURN (
    WITH sales_agg AS (
      SELECT
        si.product_id,
        COALESCE(SUM(si.quantity) FILTER (
          WHERE s.created_at >= now() - make_interval(days => v_window)
        ), 0) AS units_window
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.business_id = p_business_id
        AND s.status = 'completed'
      GROUP BY si.product_id
    ),
    variant_agg AS (
      SELECT
        v.product_id,
        COALESCE(SUM(v.stock), 0) AS v_stock
      FROM product_variants v
      WHERE v.business_id = p_business_id
        AND v.is_active = true
      GROUP BY v.product_id
    ),
    base AS (
      SELECT
        p.id, p.name, p.sku, COALESCE(p.cost, 0) AS cost,
        c.name AS category_name,
        b.name AS brand_name,
        (va.product_id IS NOT NULL) AS has_variants,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_stock ELSE p.stock END AS effective_stock,
        COALESCE(p.min_stock, 0) AS min_stock,
        COALESCE(sa.units_window, 0)::numeric AS units_window
      FROM products p
      LEFT JOIN variant_agg va ON va.product_id = p.id
      LEFT JOIN sales_agg   sa ON sa.product_id = p.id
      LEFT JOIN categories  c  ON c.id = p.category_id
      LEFT JOIN brands      b  ON b.id = p.brand_id
      WHERE p.business_id = p_business_id
        AND p.is_active = true
    ),
    flagged AS (
      SELECT
        *,
        ROUND(units_window / v_window::numeric, 4) AS daily_velocity,
        GREATEST(min_stock - effective_stock, 0)   AS suggested_qty,
        CASE
          WHEN units_window > 0
          THEN ROUND(GREATEST(effective_stock, 0) / (units_window / v_window::numeric), 1)
          ELSE NULL
        END AS days_to_stockout
      FROM base
      WHERE effective_stock <= min_stock
    )
    SELECT jsonb_build_object(
      'data', COALESCE((
        SELECT jsonb_agg(to_jsonb(d))
        FROM (
          SELECT
            id, name, sku, category_name, brand_name, has_variants,
            effective_stock, min_stock, cost, units_window, daily_velocity,
            days_to_stockout, suggested_qty
          FROM flagged
          ORDER BY
            (effective_stock <= 0) DESC,
            days_to_stockout ASC NULLS LAST,
            daily_velocity DESC,
            name ASC
          LIMIT v_limit OFFSET v_offset
        ) d
      ), '[]'::jsonb),
      'total', (SELECT COUNT(*) FROM flagged),
      'summary', jsonb_build_object(
        'products_count',     (SELECT COUNT(*) FROM flagged),
        'out_of_stock_count', (SELECT COUNT(*) FROM flagged WHERE effective_stock <= 0),
        'window_days',        v_window
      )
    )
  );
END;
$$;

ALTER FUNCTION public.get_replenishment_list(uuid, integer, integer, integer) OWNER TO postgres;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_replenishment_list(uuid, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_replenishment_list(uuid, integer, integer, integer) TO authenticated, service_role;
