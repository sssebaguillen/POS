-- ============================================================
-- Catalog RPCs with variant support
-- 1. get_catalog_product_with_variants(p_slug, p_product_id)
-- 2. get_catalog_variant_filters(p_slug)
-- ============================================================

-- ============================================================
-- 1. get_catalog_product_with_variants
-- Returns full product detail with options and variants for a
-- catalog product, verifying slug ownership.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_catalog_product_with_variants(
  p_slug       text,
  p_product_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_business_id     uuid;
  v_product         record;
  v_computed_price  numeric;
  v_default_list_id uuid;
  v_default_mult    numeric;
  v_options_json    json;
  v_variants_json   json;
BEGIN
  -- Resolve business from slug
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Negocio no encontrado');
  END IF;

  -- Fetch product
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND business_id = v_business_id
    AND is_active = true
    AND show_in_catalog = true
  LIMIT 1;

  IF v_product IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  -- Compute sale price using default price list (same logic as get_catalog_products)
  SELECT id, multiplier INTO v_default_list_id, v_default_mult
  FROM public.price_lists
  WHERE business_id = v_business_id
    AND is_default = true
  LIMIT 1;

  IF v_default_list_id IS NOT NULL AND v_product.cost > 0 THEN
    -- Check product override
    DECLARE
      v_override_mult numeric;
    BEGIN
      SELECT multiplier INTO v_override_mult
      FROM public.price_list_overrides
      WHERE price_list_id = v_default_list_id
        AND product_id = p_product_id
      LIMIT 1;

      IF v_override_mult IS NOT NULL THEN
        v_computed_price := ROUND(v_product.cost * v_override_mult, 2);
      ELSE
        -- Check brand override
        SELECT plo.multiplier INTO v_override_mult
        FROM public.price_list_overrides plo
        WHERE plo.price_list_id = v_default_list_id
          AND plo.brand_id = v_product.brand_id
          AND v_product.brand_id IS NOT NULL
        LIMIT 1;

        IF v_override_mult IS NOT NULL THEN
          v_computed_price := ROUND(v_product.cost * v_override_mult, 2);
        ELSE
          v_computed_price := ROUND(v_product.cost * v_default_mult, 2);
        END IF;
      END IF;
    END;
  ELSIF v_product.price > 0 THEN
    v_computed_price := v_product.price;
  ELSE
    v_computed_price := 0;
  END IF;

  -- Build options JSON
  SELECT json_agg(
    json_build_object(
      'id',                opt.id,
      'attribute_type_id', opt.attribute_type_id,
      'name',              opt.name,
      'position',          opt.position,
      'values', (
        SELECT json_agg(
          json_build_object(
            'id',       pov.id,
            'value',    pov.value,
            'position', pov.position
          ) ORDER BY pov.position
        )
        FROM public.product_option_values pov
        WHERE pov.option_id = opt.id
      )
    ) ORDER BY opt.position
  )
  INTO v_options_json
  FROM public.product_options opt
  WHERE opt.product_id = p_product_id
    AND opt.business_id = v_business_id;

  -- Build variants JSON
  SELECT json_agg(
    json_build_object(
      'id',         pv.id,
      'price',      pv.price,
      'stock',      pv.stock,
      'image_url',  pv.image_url,
      'is_active',  pv.is_active,
      'is_in_stock', pv.stock > 0,
      'option_values', (
        SELECT json_agg(
          json_build_object(
            'option_id',       po.id,
            'option_value_id', pov.id,
            'value',           pov.value
          ) ORDER BY po.position
        )
        FROM public.product_variant_option_values pvov
        JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
        JOIN public.product_options po ON po.id = pov.option_id
        WHERE pvov.variant_id = pv.id
      )
    ) ORDER BY pv.id
  )
  INTO v_variants_json
  FROM public.product_variants pv
  WHERE pv.product_id = p_product_id
    AND pv.business_id = v_business_id
    AND pv.is_active = true;

  RETURN json_build_object(
    'success', true,
    'product', json_build_object(
      'id',           v_product.id,
      'name',         v_product.name,
      'stock',        v_product.stock,
      'image_url',    v_product.image_url,
      'has_variants', v_product.has_variants,
      'computed_price', v_computed_price
    ),
    'options',  COALESCE(v_options_json, '[]'::json),
    'variants', COALESCE(v_variants_json, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_product_with_variants(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_catalog_product_with_variants(text, uuid) TO authenticated;

-- ============================================================
-- 2. get_catalog_variant_filters
-- Returns attribute types + values available in this catalog's
-- variant products, with product IDs per value (for client-side
-- filtering).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_catalog_variant_filters(
  p_slug text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_business_id uuid;
  v_result      json;
BEGIN
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(type_group ORDER BY type_position)
  INTO v_result
  FROM (
    SELECT
      at.id       AS type_id,
      at.label    AS type_name,
      at.position AS type_position,
      (
        SELECT json_agg(val_row ORDER BY val_row->>'value')
        FROM (
          SELECT
            pov.value,
            json_agg(DISTINCT pr2.id::text ORDER BY pr2.id::text) AS product_ids
          FROM public.product_option_values pov
          JOIN public.product_options po2 ON po2.id = pov.option_id
            AND po2.attribute_type_id = at.id
            AND po2.business_id = v_business_id
          JOIN public.products pr2 ON pr2.id = po2.product_id
            AND pr2.business_id = v_business_id
            AND pr2.is_active = true
            AND pr2.show_in_catalog = true
            AND pr2.has_variants = true
          JOIN public.product_variant_option_values pvov ON pvov.option_value_id = pov.id
          JOIN public.product_variants pv ON pv.id = pvov.variant_id
            AND pv.is_active = true
          GROUP BY pov.value
        ) val_data,
        json_build_object('value', val_data.value, 'product_ids', val_data.product_ids) AS val_row
      ) AS values
    FROM public.attribute_types at
    WHERE EXISTS (
      SELECT 1
      FROM public.product_options po
      JOIN public.products pr ON pr.id = po.product_id
        AND pr.business_id = v_business_id
        AND pr.is_active = true
        AND pr.show_in_catalog = true
        AND pr.has_variants = true
      WHERE po.attribute_type_id = at.id
        AND po.business_id = v_business_id
    )
  ) type_group;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_variant_filters(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_catalog_variant_filters(text) TO authenticated;
