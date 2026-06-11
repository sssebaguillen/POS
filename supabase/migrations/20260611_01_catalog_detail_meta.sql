-- Detalle de catálogo: expone brand_name y category_name del producto para que
-- la página pública de detalle muestre contexto de marca/categoría (UI delight,
-- crítica 2026-06-11). Cambio aditivo: el resto del JSON queda igual.

CREATE OR REPLACE FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id     uuid;
  v_product         record;
  v_promo           public.promotions;
  v_base_price      numeric;
  v_computed_price  numeric;
  v_options_json    json;
  v_variants_json   json;
  v_brand_name      text;
  v_category_name   text;
BEGIN
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Negocio no encontrado');
  END IF;

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

  SELECT b.name INTO v_brand_name
  FROM public.brands b
  WHERE b.id = v_product.brand_id
    AND b.business_id = v_business_id;

  SELECT c.name INTO v_category_name
  FROM public.categories c
  WHERE c.id = v_product.category_id
    AND c.business_id = v_business_id;

  v_promo := public.find_applicable_promotion(v_business_id, v_product.id, v_product.category_id, v_product.brand_id);

  v_base_price := public.compute_effective_price(
    v_product.cost::numeric,
    v_product.price::numeric,
    NULL,
    NULL,
    NULL,
    v_product.id,
    v_product.brand_id
  );
  v_computed_price := public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, v_base_price);

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

  SELECT json_agg(
    json_build_object(
      'id',          pv.id,
      'price',       public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, pv_base.price),
      'original_price', CASE
                          WHEN public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, pv_base.price) < pv_base.price
                          THEN pv_base.price
                        END,
      'stock',       pv.stock,
      'image_url',   pv.image_url,
      'is_active',   pv.is_active,
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
  CROSS JOIN LATERAL (
    SELECT public.compute_effective_price(
      pv.cost::numeric,
      pv.price::numeric,
      pv.price::numeric,
      NULL,
      NULL,
      v_product.id,
      v_product.brand_id
    ) AS price
  ) pv_base
  WHERE pv.product_id = p_product_id
    AND pv.business_id = v_business_id
    AND pv.is_active = true;

  RETURN json_build_object(
    'success', true,
    'product', json_build_object(
      'id',             v_product.id,
      'name',           v_product.name,
      'stock',          v_product.stock,
      'image_url',      v_product.image_url,
      'has_variants',   v_product.has_variants,
      'computed_price', v_computed_price,
      'original_price', CASE WHEN v_computed_price < v_base_price THEN v_base_price END,
      'brand_name',     v_brand_name,
      'category_name',  v_category_name,
      'promo', CASE WHEN v_promo.id IS NOT NULL THEN json_build_object(
        'kind',           v_promo.kind,
        'percent',        v_promo.percent,
        'group_size',     v_promo.group_size,
        'affected_units', v_promo.affected_units,
        'pay_percent',    v_promo.pay_percent,
        'ends_at',        v_promo.ends_at,
        'featured',       v_promo.show_in_catalog
      ) END
    ),
    'options',  COALESCE(v_options_json, '[]'::json),
    'variants', COALESCE(v_variants_json, '[]'::json)
  );
END;
$$;
