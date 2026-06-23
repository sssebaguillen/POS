-- ============================================================
-- get_low_stock_summary — hacerla variant-aware (consistencia con Reposición)
-- ============================================================
-- Antes: contaba el stock a nivel producto (products.stock <= min_stock), pero
-- para un producto con variantes el stock real vive en las variantes y
-- products.stock suele ser 0 → lo contaba como "sin stock" aunque tuviera stock
-- en variantes. get_overstock / get_replenishment_list YA usan el stock efectivo
-- = SUM(stock de variantes activas), así que el badge "Stock crítico" del
-- dashboard y la pantalla de Reposición podían mostrar conteos distintos para el
-- mismo negocio (bug de confianza).
--
-- Ahora usa el MISMO criterio de stock efectivo que esas dos RPCs, para que las
-- tres pantallas cuenten lo mismo. Solo lectura; firma y output sin cambios
-- (out_count / low_count / products[{id,name,stock,min_stock}]).

CREATE OR REPLACE FUNCTION public.get_low_stock_summary(p_business_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_out_count int;
  v_low_count int;
  v_products  jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  -- Stock efectivo variant-aware: si el producto tiene variantes activas, su
  -- stock real es la suma del stock de esas variantes; si no, products.stock.
  WITH variant_agg AS (
    SELECT v.product_id, COALESCE(SUM(v.stock), 0) AS v_stock
    FROM product_variants v
    WHERE v.business_id = p_business_id
      AND v.is_active = true
    GROUP BY v.product_id
  ),
  flagged AS (
    SELECT
      p.id, p.name,
      CASE WHEN va.product_id IS NOT NULL THEN va.v_stock ELSE p.stock END AS effective_stock,
      COALESCE(p.min_stock, 0) AS min_stock
    FROM products p
    LEFT JOIN variant_agg va ON va.product_id = p.id
    WHERE p.business_id = p_business_id
      AND p.is_active = true
      AND (CASE WHEN va.product_id IS NOT NULL THEN va.v_stock ELSE p.stock END) <= COALESCE(p.min_stock, 0)
  )
  SELECT
    COUNT(*) FILTER (WHERE effective_stock <= 0),
    COUNT(*) FILTER (WHERE effective_stock > 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object('id', id, 'name', name, 'stock', effective_stock, 'min_stock', min_stock)
        ORDER BY (effective_stock <= 0) DESC, effective_stock ASC, name ASC
      ), '[]'::jsonb)
  INTO v_out_count, v_low_count, v_products
  FROM flagged;

  RETURN jsonb_build_object(
    'out_count', v_out_count,
    'low_count', v_low_count,
    'products',  v_products
  );
END;
$$;
