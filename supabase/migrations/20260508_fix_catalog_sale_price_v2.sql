-- Rename RPC output column price → sale_price so the frontend CatalogProduct type
-- (which uses salePrice mapped from sale_price) stays in sync.
-- Fallback when no default price list: p.price (the products table sale price column).
-- NOTE: products.price is the sale price column — there is no products.sale_price column.
CREATE OR REPLACE FUNCTION public.get_catalog_products(p_slug text)
RETURNS TABLE(id uuid, category_id uuid, name text, sale_price numeric, stock integer, image_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business_id uuid;
  v_list_id     uuid;
  v_list_mult   numeric;
BEGIN
  SELECT b.id INTO v_business_id FROM businesses b WHERE b.slug = p_slug;
  IF v_business_id IS NULL THEN RETURN; END IF;

  SELECT pl.id, pl.multiplier
  INTO v_list_id, v_list_mult
  FROM price_lists pl
  WHERE pl.business_id = v_business_id AND pl.is_default = true
  LIMIT 1;

  RETURN QUERY
  SELECT
    p.id,
    p.category_id,
    p.name,
    CASE
      WHEN p.cost > 0 AND v_list_id IS NOT NULL THEN
        (p.cost * COALESCE(
          (SELECT plo.multiplier FROM price_list_overrides plo
           WHERE plo.price_list_id = v_list_id AND plo.product_id = p.id LIMIT 1),
          CASE WHEN p.brand_id IS NOT NULL THEN
            (SELECT plo.multiplier FROM price_list_overrides plo
             WHERE plo.price_list_id = v_list_id
               AND plo.product_id IS NULL AND plo.brand_id = p.brand_id LIMIT 1)
          END,
          v_list_mult
        ))::numeric
      ELSE p.price::numeric
    END AS sale_price,
    p.stock::integer,
    p.image_url
  FROM products p
  WHERE p.business_id = v_business_id
    AND p.is_active = true
    AND p.show_in_catalog = true
  ORDER BY p.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_products(text) TO anon;
