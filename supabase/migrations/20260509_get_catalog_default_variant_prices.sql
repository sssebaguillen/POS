-- Returns (product_id, price, stock) for the default variant of every
-- catalog-visible variant product belonging to the given slug.
-- SECURITY DEFINER bypasses RLS so the anon client can call this.

CREATE OR REPLACE FUNCTION public.get_catalog_default_variant_prices(p_slug text)
RETURNS TABLE(product_id uuid, price numeric, stock int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT id INTO v_business_id FROM businesses WHERE slug = p_slug LIMIT 1;
  IF v_business_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    p.id            AS product_id,
    pv.price        AS price,
    pv.stock        AS stock
  FROM products p
  JOIN product_variants pv ON pv.id = p.default_variant_id
  WHERE p.business_id    = v_business_id
    AND p.is_active      = true
    AND p.show_in_catalog = true
    AND p.has_variants   = true
    AND p.default_variant_id IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_default_variant_prices(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_catalog_default_variant_prices(text) TO authenticated;
