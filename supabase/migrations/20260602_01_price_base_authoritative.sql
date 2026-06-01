-- Precio base autoritativo + listas como tiers opt-in (Fase 1).
--
-- Cambio de modelo: el precio de venta de todos los días es el campo base
-- (products.price / product_variants.price), leído tal cual en POS, catálogo e
-- inventario. Las listas de precios pasan a ser tiers alternativos (mayorista),
-- opt-in, con multiplicador sobre el costo. Desaparece la "lista default".
--
-- IMPORTANTE (deploy): esta migración cambia la firma de create_price_list y
-- elimina la columna is_default. La app desplegada que todavía consulta is_default
-- o pasa p_is_default se rompería, así que APLICAR COORDINADO con el deploy del
-- código nuevo.

-- ---------------------------------------------------------------------------
-- 1) Hornear el precio base donde hoy se derivaba de la lista default.
--    Regla: precio_base = (price > 0 ? price : round(cost * mult_efectivo)).
--    - Nunca pisa un price > 0 (preserva el precio manual).
--    - Nunca toca cost.
--    - Solo negocios que tienen lista default (los que no, quedan intactos).
--    mult_efectivo = override de producto ?? override de marca ?? multiplier de la lista.
-- ---------------------------------------------------------------------------
UPDATE products p
SET price = ROUND(
  COALESCE(
    (SELECT plo.multiplier FROM price_list_overrides plo
       WHERE plo.price_list_id = d.list_id AND plo.product_id = p.id LIMIT 1),
    (SELECT plo.multiplier FROM price_list_overrides plo
       WHERE plo.price_list_id = d.list_id AND plo.product_id IS NULL AND plo.brand_id = p.brand_id LIMIT 1),
    d.multiplier
  ) * p.cost, 2)
FROM (
  SELECT business_id, id AS list_id, multiplier
  FROM price_lists WHERE is_default = true
) d
WHERE p.business_id = d.business_id
  AND p.price <= 0
  AND p.cost > 0;

-- Variantes: el override se busca por el product_id (padre) y la marca del padre,
-- igual que compute_effective_price en las RPCs de catálogo.
UPDATE product_variants v
SET price = ROUND(
  COALESCE(
    (SELECT plo.multiplier FROM price_list_overrides plo
       WHERE plo.price_list_id = d.list_id AND plo.product_id = v.product_id LIMIT 1),
    (SELECT plo.multiplier FROM price_list_overrides plo
       WHERE plo.price_list_id = d.list_id AND plo.product_id IS NULL AND plo.brand_id = pr.brand_id LIMIT 1),
    d.multiplier
  ) * v.cost, 2)
FROM (
  SELECT business_id, id AS list_id, multiplier
  FROM price_lists WHERE is_default = true
) d
JOIN products pr ON pr.business_id = d.business_id
WHERE v.product_id = pr.id
  AND v.business_id = d.business_id
  AND v.price <= 0
  AND v.cost > 0;

-- ---------------------------------------------------------------------------
-- 2) compute_effective_price: la regla "variante con price>0 manda" aplica SOLO
--    al precio base (list NULL). Con una lista alternativa y cost>0, el costo
--    manda (cost * multiplier), también para variantes. Paridad con
--    calculateProductPrice en src/lib/price-lists.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_effective_price(
  p_cost numeric, p_price numeric, p_variant_price numeric,
  p_list_id uuid, p_list_multiplier numeric, p_product_id uuid, p_brand_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mult numeric;
BEGIN
  -- Sin lista: precio base (precio explícito de variante si existe, si no el base).
  IF p_list_id IS NULL THEN
    IF p_variant_price IS NOT NULL AND p_variant_price > 0 THEN
      RETURN ROUND(p_variant_price, 2);
    END IF;
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  -- Lista alternativa (markup sobre costo). Sin costo, caemos al precio explícito.
  IF COALESCE(p_cost, 0) <= 0 THEN
    IF p_variant_price IS NOT NULL AND p_variant_price > 0 THEN
      RETURN ROUND(p_variant_price, 2);
    END IF;
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  SELECT plo.multiplier INTO v_mult
  FROM public.price_list_overrides plo
  WHERE plo.price_list_id = p_list_id
    AND plo.product_id = p_product_id
  LIMIT 1;

  IF v_mult IS NULL AND p_brand_id IS NOT NULL THEN
    SELECT plo.multiplier INTO v_mult
    FROM public.price_list_overrides plo
    WHERE plo.price_list_id = p_list_id
      AND plo.product_id IS NULL
      AND plo.brand_id = p_brand_id
    LIMIT 1;
  END IF;

  v_mult := COALESCE(v_mult, p_list_multiplier);

  RETURN ROUND(p_cost * v_mult, 2);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) RPCs de catálogo: el catálogo público muestra SIEMPRE el precio base.
--    Ya no se busca la lista default; se pasa list NULL a compute_effective_price.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_catalog_products(p_slug text)
RETURNS TABLE(id uuid, category_id uuid, name text, sale_price numeric, stock integer, image_url text, has_variants boolean, brand_id uuid, brand_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT b.id INTO v_business_id FROM businesses b WHERE b.slug = p_slug;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.category_id,
    p.name,
    CASE
      WHEN p.has_variants AND pv_def.id IS NOT NULL THEN
        public.compute_effective_price(pv_def.cost::numeric, pv_def.price::numeric, pv_def.price::numeric, NULL, NULL, p.id, p.brand_id)
      ELSE
        public.compute_effective_price(p.cost::numeric, p.price::numeric, NULL, NULL, NULL, p.id, p.brand_id)
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
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id     uuid;
  v_product         record;
  v_computed_price  numeric;
  v_options_json    json;
  v_variants_json   json;
BEGIN
  SELECT id INTO v_business_id FROM public.businesses WHERE slug = p_slug LIMIT 1;

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

  v_computed_price := public.compute_effective_price(
    v_product.cost::numeric, v_product.price::numeric, NULL,
    NULL, NULL, v_product.id, v_product.brand_id
  );

  SELECT json_agg(
    json_build_object(
      'id', opt.id, 'attribute_type_id', opt.attribute_type_id, 'name', opt.name, 'position', opt.position,
      'values', (
        SELECT json_agg(json_build_object('id', pov.id, 'value', pov.value, 'position', pov.position) ORDER BY pov.position)
        FROM public.product_option_values pov WHERE pov.option_id = opt.id
      )
    ) ORDER BY opt.position
  )
  INTO v_options_json
  FROM public.product_options opt
  WHERE opt.product_id = p_product_id AND opt.business_id = v_business_id;

  SELECT json_agg(
    json_build_object(
      'id', pv.id,
      'price', public.compute_effective_price(pv.cost::numeric, pv.price::numeric, pv.price::numeric, NULL, NULL, v_product.id, v_product.brand_id),
      'stock', pv.stock,
      'image_url', pv.image_url,
      'is_active', pv.is_active,
      'is_in_stock', pv.stock > 0,
      'option_values', (
        SELECT json_agg(json_build_object('option_id', po.id, 'option_value_id', pov.id, 'value', pov.value) ORDER BY po.position)
        FROM public.product_variant_option_values pvov
        JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
        JOIN public.product_options po ON po.id = pov.option_id
        WHERE pvov.variant_id = pv.id
      )
    ) ORDER BY pv.id
  )
  INTO v_variants_json
  FROM public.product_variants pv
  WHERE pv.product_id = p_product_id AND pv.business_id = v_business_id AND pv.is_active = true;

  RETURN json_build_object(
    'success', true,
    'product', json_build_object(
      'id', v_product.id, 'name', v_product.name, 'stock', v_product.stock,
      'image_url', v_product.image_url, 'has_variants', v_product.has_variants,
      'computed_price', v_computed_price
    ),
    'options',  COALESCE(v_options_json, '[]'::json),
    'variants', COALESCE(v_variants_json, '[]'::json)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) create_price_list sin p_is_default (ya no hay lista default).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_price_list(uuid, uuid, text, text, numeric, boolean, jsonb);

CREATE OR REPLACE FUNCTION public.create_price_list(
  p_operator_id uuid, p_business_id uuid, p_name text, p_description text,
  p_multiplier numeric, p_overrides jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_list_id            uuid;
  v_list               jsonb;
  v_overrides          jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  IF p_multiplier IS NULL OR p_multiplier <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El margen debe ser mayor a 0');
  END IF;

  SELECT permissions->>'price_lists_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de listas de precios insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  INSERT INTO price_lists (business_id, name, description, multiplier)
  VALUES (v_caller_business_id, btrim(p_name), NULLIF(btrim(p_description), ''), p_multiplier)
  RETURNING id, to_jsonb(price_lists.*) INTO v_list_id, v_list;

  IF p_overrides IS NOT NULL AND jsonb_typeof(p_overrides) = 'array' AND jsonb_array_length(p_overrides) > 0 THEN
    WITH inserted AS (
      INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
      SELECT v_list_id, (item->>'product_id')::uuid, NULL, (item->>'multiplier')::numeric
      FROM jsonb_array_elements(p_overrides) AS item
      WHERE item->>'product_id' IS NOT NULL AND item->>'multiplier' IS NOT NULL
      RETURNING id, price_list_id, product_id, brand_id, multiplier
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(inserted.*)), '[]'::jsonb) INTO v_overrides FROM inserted;
  ELSE
    v_overrides := '[]'::jsonb;
  END IF;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_created', 'price_list', v_list_id, btrim(p_name),
    NULL,
    jsonb_build_object('list', v_list, 'overrides_count', COALESCE(jsonb_array_length(v_overrides), 0))
  );

  RETURN jsonb_build_object('success', true, 'list', v_list, 'overrides', v_overrides);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_price_list(uuid, uuid, text, text, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_price_list(uuid, uuid, text, text, numeric, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Eliminar el mecanismo de lista default.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.swap_default_price_list(uuid, uuid, uuid);

-- El DROP COLUMN elimina automáticamente el índice parcial unique_default_price_list_per_business.
ALTER TABLE public.price_lists DROP COLUMN IF EXISTS is_default;
