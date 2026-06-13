-- ============================================================
-- get_low_stock_summary — alertas de stock crítico del dashboard
-- ============================================================
-- Reemplaza el fetch de hasta 5000 productos por carga del dashboard. El
-- dashboard tiene DOS consumidores del stock crítico: la KPI card "Stock
-- crítico" (conteos + preview) y el panel "Alertas de stock" (lista completa
-- de críticos con nombre/stock/mín). Ambos solo necesitan el SUBCONJUNTO
-- crítico (is_active AND stock <= min_stock), que es chico — no los 5000.
-- Devuelve ese subconjunto completo + los dos conteos.
--
-- Mismos criterios que el filtro client-side que reemplaza: stock <= 0 cuenta
-- como "sin stock" (stock negativo es válido acá), stock > 0 como "stock bajo".
-- min_stock es nullable: el lado TS coercía null -> 0 (Number(null)); acá
-- usamos COALESCE(min_stock, 0) para mantener paridad exacta (filtro y display).
-- Orden: sin stock primero, luego por stock asc, luego por nombre — espeja el
-- sort de outOfStock/lowStock del componente.

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

  SELECT
    COUNT(*) FILTER (WHERE stock <= 0),
    COUNT(*) FILTER (WHERE stock > 0)
  INTO v_out_count, v_low_count
  FROM products
  WHERE business_id = p_business_id
    AND is_active = true
    AND stock <= COALESCE(min_stock, 0);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', id, 'name', name, 'stock', stock, 'min_stock', COALESCE(min_stock, 0))
      ORDER BY (stock <= 0) DESC, stock ASC, name ASC
    ), '[]'::jsonb)
  INTO v_products
  FROM products
  WHERE business_id = p_business_id
    AND is_active = true
    AND stock <= COALESCE(min_stock, 0);

  RETURN jsonb_build_object(
    'out_count', v_out_count,
    'low_count', v_low_count,
    'products',  v_products
  );
END;
$$;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_low_stock_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_low_stock_summary(uuid) TO authenticated, service_role;
