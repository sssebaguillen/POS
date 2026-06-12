-- ─────────────────────────────────────────────────────────────────────────────
-- Catálogo: una promo solo se expone si realmente abarata algo.
--
-- Bug (beta): un precio de oferta MAYOR al precio del producto no descuenta nada
-- (apply_unit_promo = LEAST), pero get_catalog_products igual proyectaba los
-- campos promo_* → el producto aparecía en la sección Ofertas con badge y sin
-- descuento. Ídem el objeto `promo` del detalle.
--
-- Regla "promo real":
--   · kind percent/quantity → siempre (percent > 0 abarata; quantity descuenta
--     a nivel línea aunque el unitario no cambie).
--   · kind offer_price, sin variantes → oferta < precio efectivo.
--   · kind offer_price, con variantes → EXISTS variante activa con precio
--     efectivo > oferta (si solo baja la variante cara, sigue siendo oferta real
--     aunque el "Desde" — mínimo entre variantes — no cambie).
--
-- Espejo TS: el badge del POS (ProductPanel) aplica la misma regla vía
-- applyUnitPromo sobre el máximo de las variantes. El checkout ya era correcto
-- en ambos lados (resolvePromoLine / create_catalog_order solo registran
-- promotion_id cuando hay descuento efectivo).
--
-- RETURNS sin cambios → CREATE OR REPLACE conserva grants (anon incluida).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_catalog_products(p_slug text)
RETURNS TABLE(
  id uuid,
  category_id uuid,
  name text,
  sale_price numeric,
  stock integer,
  image_url text,
  has_variants boolean,
  brand_id uuid,
  brand_name text,
  variant_count integer,
  original_price numeric,
  promo_kind text,
  promo_percent numeric,
  promo_group_size integer,
  promo_affected_units integer,
  promo_pay_percent numeric,
  promo_ends_at timestamptz,
  promo_featured boolean
)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT b.id INTO v_business_id
  FROM businesses b
  WHERE b.slug = p_slug;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    base.id,
    base.category_id,
    base.name,
    public.apply_unit_promo(fp.kind, fp.percent, fp.offer_price, base.base_price) AS sale_price,
    base.stock,
    base.image_url,
    base.has_variants,
    base.brand_id,
    base.brand_name,
    base.variant_count,
    CASE
      WHEN fp.id IS NOT NULL
       AND public.apply_unit_promo(fp.kind, fp.percent, fp.offer_price, base.base_price) < base.base_price
      THEN base.base_price
    END AS original_price,
    fp.kind AS promo_kind,
    fp.percent AS promo_percent,
    fp.group_size AS promo_group_size,
    fp.affected_units AS promo_affected_units,
    fp.pay_percent AS promo_pay_percent,
    fp.ends_at AS promo_ends_at,
    CASE WHEN fp.id IS NOT NULL THEN fp.show_in_catalog END AS promo_featured
  FROM (
    SELECT
      p.id,
      p.category_id,
      p.name,
      CASE
        WHEN p.has_variants THEN
          COALESCE(
            (SELECT MIN(ep.price)
             FROM (
               SELECT public.compute_effective_price(
                 pv.cost::numeric, pv.price::numeric, pv.price::numeric,
                 NULL, NULL, p.id, p.brand_id) AS price
               FROM product_variants pv
               WHERE pv.product_id = p.id AND pv.is_active = true
             ) ep
             WHERE ep.price > 0),
            CASE
              WHEN pv_def.id IS NOT NULL THEN
                public.compute_effective_price(
                  pv_def.cost::numeric, pv_def.price::numeric, pv_def.price::numeric,
                  NULL, NULL, p.id, p.brand_id)
              ELSE
                public.compute_effective_price(
                  p.cost::numeric, p.price::numeric, NULL,
                  NULL, NULL, p.id, p.brand_id)
            END
          )
        ELSE
          public.compute_effective_price(
            p.cost::numeric, p.price::numeric, NULL,
            NULL, NULL, p.id, p.brand_id)
      END AS base_price,
      CASE
        WHEN p.has_variants AND pv_def.id IS NOT NULL THEN pv_def.stock
        ELSE p.stock::integer
      END AS stock,
      CASE
        WHEN p.has_variants AND pv_def.id IS NOT NULL THEN COALESCE(pv_def.image_url, p.image_url)
        ELSE p.image_url
      END AS image_url,
      p.has_variants,
      p.brand_id,
      b_brand.name AS brand_name,
      CASE
        WHEN p.has_variants THEN (
          SELECT count(*)::int FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
        )
        ELSE 0
      END AS variant_count
    FROM products p
    LEFT JOIN product_variants pv_def ON pv_def.id = p.default_variant_id
    LEFT JOIN brands b_brand ON b_brand.id = p.brand_id
    WHERE p.business_id    = v_business_id
      AND p.is_active      = true
      AND p.show_in_catalog = true
  ) base
  LEFT JOIN LATERAL public.find_applicable_promotion(v_business_id, base.id, base.category_id, base.brand_id) fp0 ON true
  -- fp = fp0 solo si la promo es real (abarata algo); si no, todas sus columnas
  -- quedan NULL y el producto se proyecta sin promo.
  LEFT JOIN LATERAL (
    SELECT fp0.*
    WHERE fp0.id IS NOT NULL
      AND (
        fp0.kind <> 'offer_price'
        OR CASE
             WHEN base.has_variants THEN EXISTS (
               SELECT 1 FROM product_variants pv
               WHERE pv.product_id = base.id
                 AND pv.is_active = true
                 AND public.compute_effective_price(
                       pv.cost::numeric, pv.price::numeric, pv.price::numeric,
                       NULL, NULL, base.id, base.brand_id) > fp0.offer_price
             )
             ELSE fp0.offer_price < base.base_price
           END
      )
  ) fp ON true
  ORDER BY base.name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id     uuid;
  v_product         record;
  v_promo           public.promotions;
  v_promo_real      boolean;
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

  -- Promo real: offer_price solo cuenta si abarata algo (sin variantes: oferta
  -- < precio; con variantes: alguna variante activa cuesta más que la oferta).
  IF v_promo.id IS NOT NULL AND v_promo.kind = 'offer_price' THEN
    IF v_product.has_variants THEN
      SELECT EXISTS (
        SELECT 1 FROM public.product_variants pv
        WHERE pv.product_id = p_product_id
          AND pv.business_id = v_business_id
          AND pv.is_active = true
          AND public.compute_effective_price(
                pv.cost::numeric, pv.price::numeric, pv.price::numeric,
                NULL, NULL, v_product.id, v_product.brand_id) > v_promo.offer_price
      ) INTO v_promo_real;
    ELSE
      v_promo_real := v_promo.offer_price < v_base_price;
    END IF;
    IF NOT v_promo_real THEN
      v_promo := NULL;
    END IF;
  END IF;

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
