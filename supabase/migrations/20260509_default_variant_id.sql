-- 1. Add column
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_variant_id uuid
    REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- 2. Backfill existing products
UPDATE public.products
SET default_variant_id = (
  SELECT id FROM public.product_variants
  WHERE product_id = products.id AND is_active = true
  ORDER BY created_at ASC LIMIT 1
)
WHERE has_variants = true AND default_variant_id IS NULL;

-- 3. Updated create_product_with_variants (full replacement)
-- Accepts is_default: boolean on each variant in p_variants.
-- Sets default_variant_id to the first variant with is_default=true,
-- or the first inserted variant if none marked.

CREATE OR REPLACE FUNCTION public.create_product_with_variants(
  p_product  jsonb,
  p_options  jsonb,
  p_variants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id        uuid;
  v_product_id         uuid;
  v_option             jsonb;
  v_option_idx         int := 0;
  v_option_id          uuid;
  v_value              jsonb;
  v_value_idx          int;
  v_value_id           uuid;
  v_variant            jsonb;
  v_variant_id         uuid;
  v_ov_ref             jsonb;
  v_value_map          jsonb := '{}'::jsonb;
  v_key                text;
  v_default_variant_id uuid;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  END IF;

  INSERT INTO products (
    business_id, category_id, brand_id, name, sku, barcode,
    price, cost, stock, min_stock, image_url, image_source,
    is_active, show_in_catalog, has_variants
  )
  VALUES (
    v_business_id,
    NULLIF(p_product->>'category_id', '')::uuid,
    NULLIF(p_product->>'brand_id', '')::uuid,
    p_product->>'name',
    NULLIF(p_product->>'sku', ''),
    NULLIF(p_product->>'barcode', ''),
    COALESCE((p_product->>'price')::numeric, 0),
    COALESCE((p_product->>'cost')::numeric, 0),
    0,
    COALESCE((p_product->>'min_stock')::int, 0),
    NULLIF(p_product->>'image_url', ''),
    NULLIF(p_product->>'image_source', ''),
    COALESCE((p_product->>'is_active')::boolean, true),
    COALESCE((p_product->>'show_in_catalog')::boolean, true),
    true
  )
  RETURNING id INTO v_product_id;

  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    INSERT INTO product_options (
      business_id, product_id, attribute_type_id, name, position
    )
    VALUES (
      v_business_id,
      v_product_id,
      v_option->>'attribute_type_id',
      v_option->>'name',
      COALESCE((v_option->>'position')::int, v_option_idx)
    )
    RETURNING id INTO v_option_id;

    v_value_idx := 0;
    FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
    LOOP
      INSERT INTO product_option_values (option_id, value, position)
      VALUES (
        v_option_id,
        v_value->>'value',
        COALESCE((v_value->>'position')::int, v_value_idx)
      )
      RETURNING id INTO v_value_id;

      v_key := v_option_idx::text || ':' || v_value_idx::text;
      v_value_map := v_value_map || jsonb_build_object(v_key, v_value_id::text);
      v_value_idx := v_value_idx + 1;
    END LOOP;

    v_option_idx := v_option_idx + 1;
  END LOOP;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    INSERT INTO product_variants (
      business_id, product_id, sku, barcode, price, cost,
      stock, min_stock, image_url, image_source, is_active
    )
    VALUES (
      v_business_id,
      v_product_id,
      NULLIF(v_variant->>'sku', ''),
      NULLIF(v_variant->>'barcode', ''),
      COALESCE((v_variant->>'price')::numeric, 0),
      COALESCE((v_variant->>'cost')::numeric, 0),
      COALESCE((v_variant->>'stock')::int, 0),
      COALESCE((v_variant->>'min_stock')::int, 0),
      NULLIF(v_variant->>'image_url', ''),
      NULLIF(v_variant->>'image_source', ''),
      COALESCE((v_variant->>'is_active')::boolean, true)
    )
    RETURNING id INTO v_variant_id;

    -- first inserted is the fallback default
    IF v_default_variant_id IS NULL THEN
      v_default_variant_id := v_variant_id;
    END IF;
    -- explicit is_default=true overrides the fallback
    IF COALESCE((v_variant->>'is_default')::boolean, false) THEN
      v_default_variant_id := v_variant_id;
    END IF;

    FOR v_ov_ref IN SELECT * FROM jsonb_array_elements(v_variant->'option_value_indices')
    LOOP
      v_key := (v_ov_ref->0)::text || ':' || (v_ov_ref->1)::text;
      v_value_id := (v_value_map->>v_key)::uuid;
      IF v_value_id IS NOT NULL THEN
        INSERT INTO product_variant_option_values (variant_id, option_value_id)
        VALUES (v_variant_id, v_value_id);
      END IF;
    END LOOP;
  END LOOP;

  UPDATE products
  SET default_variant_id = v_default_variant_id
  WHERE id = v_product_id AND business_id = v_business_id;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_variants(jsonb, jsonb, jsonb) TO authenticated;

-- 4. Updated update_product_variants
-- Accepts is_default: boolean on variants. Sets default_variant_id accordingly.
-- If no is_default provided, preserves existing default if still active,
-- else picks first active variant.

CREATE OR REPLACE FUNCTION public.update_product_variants(
  p_product_id uuid,
  p_options    jsonb,
  p_variants   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id        uuid;
  v_option             jsonb;
  v_option_id          uuid;
  v_value              jsonb;
  v_variant            jsonb;
  v_variant_id         uuid;
  v_ov_id              jsonb;
  v_active_ids         uuid[] := '{}';
  v_active_count       int;
  v_default_variant_id uuid;
BEGIN
  v_business_id := get_business_id();

  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND business_id = v_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;

  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    IF (v_option->>'id') IS NOT NULL THEN
      UPDATE product_options
      SET
        attribute_type_id = COALESCE(v_option->>'attribute_type_id', attribute_type_id),
        name              = COALESCE(v_option->>'name', name),
        position          = COALESCE((v_option->>'position')::int, position)
      WHERE id = (v_option->>'id')::uuid AND business_id = v_business_id;

      FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
      LOOP
        IF (v_value->>'id') IS NOT NULL THEN
          UPDATE product_option_values
          SET
            value    = COALESCE(v_value->>'value', value),
            position = COALESCE((v_value->>'position')::int, position)
          WHERE id = (v_value->>'id')::uuid
            AND option_id = (v_option->>'id')::uuid;
        ELSE
          INSERT INTO product_option_values (option_id, value, position)
          VALUES (
            (v_option->>'id')::uuid,
            v_value->>'value',
            COALESCE((v_value->>'position')::int, 0)
          );
        END IF;
      END LOOP;
    ELSE
      INSERT INTO product_options (
        business_id, product_id, attribute_type_id, name, position
      )
      VALUES (
        v_business_id,
        p_product_id,
        v_option->>'attribute_type_id',
        v_option->>'name',
        COALESCE((v_option->>'position')::int, 0)
      )
      RETURNING id INTO v_option_id;

      FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
      LOOP
        INSERT INTO product_option_values (option_id, value, position)
        VALUES (
          v_option_id,
          v_value->>'value',
          COALESCE((v_value->>'position')::int, 0)
        );
      END LOOP;
    END IF;
  END LOOP;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    IF (v_variant->>'id') IS NOT NULL THEN
      UPDATE product_variants
      SET
        sku          = NULLIF(v_variant->>'sku', ''),
        barcode      = NULLIF(v_variant->>'barcode', ''),
        price        = COALESCE((v_variant->>'price')::numeric, price),
        cost         = COALESCE((v_variant->>'cost')::numeric, cost),
        stock        = COALESCE((v_variant->>'stock')::int, stock),
        min_stock    = COALESCE((v_variant->>'min_stock')::int, min_stock),
        image_url    = NULLIF(v_variant->>'image_url', ''),
        image_source = NULLIF(v_variant->>'image_source', ''),
        is_active    = COALESCE((v_variant->>'is_active')::boolean, true)
      WHERE id = (v_variant->>'id')::uuid AND business_id = v_business_id;

      v_variant_id := (v_variant->>'id')::uuid;
    ELSE
      INSERT INTO product_variants (
        business_id, product_id, sku, barcode, price, cost,
        stock, min_stock, image_url, image_source, is_active
      )
      VALUES (
        v_business_id,
        p_product_id,
        NULLIF(v_variant->>'sku', ''),
        NULLIF(v_variant->>'barcode', ''),
        COALESCE((v_variant->>'price')::numeric, 0),
        COALESCE((v_variant->>'cost')::numeric, 0),
        COALESCE((v_variant->>'stock')::int, 0),
        COALESCE((v_variant->>'min_stock')::int, 0),
        NULLIF(v_variant->>'image_url', ''),
        NULLIF(v_variant->>'image_source', ''),
        COALESCE((v_variant->>'is_active')::boolean, true)
      )
      RETURNING id INTO v_variant_id;

      FOR v_ov_id IN SELECT * FROM jsonb_array_elements(v_variant->'option_value_ids')
      LOOP
        INSERT INTO product_variant_option_values (variant_id, option_value_id)
        VALUES (v_variant_id, (v_ov_id#>>'{}')::uuid)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    v_active_ids := array_append(v_active_ids, v_variant_id);

    IF COALESCE((v_variant->>'is_default')::boolean, false) THEN
      v_default_variant_id := v_variant_id;
    END IF;
  END LOOP;

  UPDATE product_variants
  SET is_active = false
  WHERE product_id   = p_product_id
    AND business_id  = v_business_id
    AND is_active    = true
    AND id <> ALL(v_active_ids);

  SELECT COUNT(*)::int INTO v_active_count
  FROM product_variants
  WHERE product_id  = p_product_id
    AND business_id = v_business_id
    AND is_active   = true;

  UPDATE products
  SET has_variants = (v_active_count > 0)
  WHERE id = p_product_id AND business_id = v_business_id;

  -- Set default_variant_id: use explicitly provided, or keep existing (if still active), or pick first active
  UPDATE products
  SET default_variant_id = COALESCE(
    v_default_variant_id,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM product_variants
        WHERE id = products.default_variant_id
          AND is_active = true
      ) THEN products.default_variant_id
      ELSE (
        SELECT id FROM product_variants
        WHERE product_id  = p_product_id
          AND business_id = v_business_id
          AND is_active   = true
        ORDER BY created_at ASC LIMIT 1
      )
    END
  )
  WHERE id = p_product_id AND business_id = v_business_id;

  RETURN jsonb_build_object('success', true, 'active_variants', v_active_count);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_product_variants(uuid, jsonb, jsonb) TO authenticated;
