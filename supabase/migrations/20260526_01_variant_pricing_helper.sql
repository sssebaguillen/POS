-- Variant pricing rule, unified server-side.
--
-- Regla:
--   1. variant_price > 0           → variant_price (precio explícito de variante manda)
--   2. cost > 0 && list_id NOT NULL → cost × multiplicador (override producto > marca > lista)
--   3. cost = 0                     → price (precio crudo del producto/variante)
--
-- Espejo en TS: src/lib/price-lists.ts → calculateProductPrice(...).
--
-- Esta migration:
--   - Crea el helper compute_effective_price().
--   - Refactorea get_catalog_products para usarlo (antes ignoraba listas para variantes).
--   - Refactorea get_catalog_product_with_variants para devolver el precio efectivo
--     por variante en variants[].price (antes devolvía el price crudo, sin lista).
--
-- Sin cambios de schema. Sin migración de datos.

CREATE OR REPLACE FUNCTION public.compute_effective_price(
  p_cost            numeric,
  p_price           numeric,
  p_variant_price   numeric,  -- NULL para productos sin variantes
  p_list_id         uuid,     -- NULL si no hay lista activa
  p_list_multiplier numeric,  -- multiplicador base de la lista (NULL si no hay lista)
  p_product_id      uuid,     -- id del producto padre (para lookup de override)
  p_brand_id        uuid      -- id de la marca del padre (para lookup de override)
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_mult numeric;
BEGIN
  -- 1. Precio explícito de variante manda
  IF p_variant_price IS NOT NULL AND p_variant_price > 0 THEN
    RETURN ROUND(p_variant_price, 2);
  END IF;

  -- 2. Sin cost no podemos calcular con multiplicador → devolver price crudo
  IF COALESCE(p_cost, 0) <= 0 THEN
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  -- 3. Sin lista activa devolvemos price crudo
  IF p_list_id IS NULL THEN
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  -- 4. Override por producto (gana sobre marca)
  SELECT plo.multiplier INTO v_mult
  FROM public.price_list_overrides plo
  WHERE plo.price_list_id = p_list_id
    AND plo.product_id = p_product_id
  LIMIT 1;

  -- 5. Override por marca (sólo si no hay override por producto)
  IF v_mult IS NULL AND p_brand_id IS NOT NULL THEN
    SELECT plo.multiplier INTO v_mult
    FROM public.price_list_overrides plo
    WHERE plo.price_list_id = p_list_id
      AND plo.product_id IS NULL
      AND plo.brand_id = p_brand_id
    LIMIT 1;
  END IF;

  -- 6. Fallback al multiplicador de la lista
  v_mult := COALESCE(v_mult, p_list_multiplier);

  RETURN ROUND(p_cost * v_mult, 2);
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_catalog_products(p_slug text)
RETURNS TABLE(
  id           uuid,
  category_id  uuid,
  name         text,
  sale_price   numeric,
  stock        integer,
  image_url    text,
  has_variants boolean,
  brand_id     uuid,
  brand_name   text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_business_id uuid;
  v_list_id     uuid;
  v_list_mult   numeric;
BEGIN
  SELECT b.id INTO v_business_id
  FROM businesses b
  WHERE b.slug = p_slug;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  SELECT pl.id, pl.multiplier
  INTO v_list_id, v_list_mult
  FROM price_lists pl
  WHERE pl.business_id = v_business_id
    AND pl.is_default = true
  LIMIT 1;

  RETURN QUERY
  SELECT
    p.id,
    p.category_id,
    p.name,
    CASE
      WHEN p.has_variants AND pv_def.id IS NOT NULL THEN
        public.compute_effective_price(
          pv_def.cost::numeric,
          pv_def.price::numeric,
          pv_def.price::numeric,
          v_list_id,
          v_list_mult,
          p.id,
          p.brand_id
        )
      ELSE
        public.compute_effective_price(
          p.cost::numeric,
          p.price::numeric,
          NULL,
          v_list_id,
          v_list_mult,
          p.id,
          p.brand_id
        )
    END AS sale_price,
    CASE
      WHEN p.has_variants AND pv_def.id IS NOT NULL THEN pv_def.stock
      ELSE p.stock::integer
    END AS stock,
    p.image_url,
    p.has_variants,
    p.brand_id,
    b_brand.name AS brand_name
  FROM products p
  LEFT JOIN product_variants pv_def ON pv_def.id = p.default_variant_id
  LEFT JOIN brands b_brand ON b_brand.id = p.brand_id
  WHERE p.business_id    = v_business_id
    AND p.is_active      = true
    AND p.show_in_catalog = true
  ORDER BY p.name ASC;
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_catalog_product_with_variants(p_slug text, p_product_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_business_id     uuid;
  v_product         record;
  v_computed_price  numeric;
  v_default_list_id uuid;
  v_default_mult    numeric;
  v_options_json    json;
  v_variants_json   json;
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

  SELECT id, multiplier
  INTO v_default_list_id, v_default_mult
  FROM public.price_lists
  WHERE business_id = v_business_id
    AND is_default = true
  LIMIT 1;

  -- Precio computado del producto padre (para el caso sin variantes — cuando hay variantes
  -- el front usa displayVariant.price, pero igualmente devolvemos un valor sensato).
  v_computed_price := public.compute_effective_price(
    v_product.cost::numeric,
    v_product.price::numeric,
    NULL,
    v_default_list_id,
    v_default_mult,
    v_product.id,
    v_product.brand_id
  );

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

  -- variants[].price = precio efectivo (regla unificada).
  -- Se preserva el shape del JSON; el front (ProductDetailView) ya leía .price.
  SELECT json_agg(
    json_build_object(
      'id',          pv.id,
      'price',       public.compute_effective_price(
                       pv.cost::numeric,
                       pv.price::numeric,
                       pv.price::numeric,
                       v_default_list_id,
                       v_default_mult,
                       v_product.id,
                       v_product.brand_id
                     ),
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
      'computed_price', v_computed_price
    ),
    'options',  COALESCE(v_options_json, '[]'::json),
    'variants', COALESCE(v_variants_json, '[]'::json)
  );
END;
$function$;
