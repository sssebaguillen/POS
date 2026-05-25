-- Audit log para edición y creación de variantes de productos.
--
-- Hoy `update_product_variants` y `create_product_with_variants` violan la regla 32
-- de CLAUDE.md: no aceptan operator_id, no validan business explícitamente, y no
-- llaman log_audit_event. Toda mutación de variantes (cambios de precio/stock,
-- variantes agregadas/desactivadas, opciones renombradas) es hoy invisible en /activity.
--
-- Esta migration:
--   1. Cambia firmas para alinear con el patrón (p_operator_id, p_business_id, ...).
--   2. Agrega validación de operador + business + permiso stock_write.
--   3. Snapshots pre/post y log_audit_event con dos acciones nuevas:
--      - 'product_variants_created' (reemplaza el silencio de create_product_with_variants)
--      - 'product_variants_updated'
--   4. payload de audit: { product: {...}, options: [...], variants: [...] }
--      Variantes incluyen ALL (is_active true y false) — el diff lo categoriza en UI.

-- ─── Helper: snapshot del producto con opciones y variantes ──────────────────
CREATE OR REPLACE FUNCTION public.product_variants_snapshot(
  p_business_id uuid,
  p_product_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
DECLARE
  v_product  jsonb;
  v_options  jsonb;
  v_variants jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id',           p.id,
    'name',         p.name,
    'has_variants', p.has_variants,
    'default_variant_id', p.default_variant_id
  )
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id AND p.business_id = p_business_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                po.id,
      'attribute_type_id', po.attribute_type_id,
      'name',              po.name,
      'position',          po.position,
      'values', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object('id', pov.id, 'value', pov.value, 'position', pov.position)
          ORDER BY pov.position
        ), '[]'::jsonb)
        FROM public.product_option_values pov
        WHERE pov.option_id = po.id
      )
    ) ORDER BY po.position
  ), '[]'::jsonb)
  INTO v_options
  FROM public.product_options po
  WHERE po.product_id = p_product_id AND po.business_id = p_business_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',        pv.id,
      'sku',       pv.sku,
      'barcode',   pv.barcode,
      'price',     pv.price,
      'cost',      pv.cost,
      'stock',     pv.stock,
      'min_stock', pv.min_stock,
      'is_active', pv.is_active,
      'option_values', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'option_id',       po.id,
            'option_name',     po.name,
            'option_value_id', pov.id,
            'value',           pov.value
          ) ORDER BY po.position
        ), '[]'::jsonb)
        FROM public.product_variant_option_values pvov
        JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
        JOIN public.product_options po        ON po.id  = pov.option_id
        WHERE pvov.variant_id = pv.id
      )
    ) ORDER BY pv.created_at
  ), '[]'::jsonb)
  INTO v_variants
  FROM public.product_variants pv
  WHERE pv.product_id = p_product_id AND pv.business_id = p_business_id;

  RETURN jsonb_build_object(
    'product',  v_product,
    'options',  v_options,
    'variants', v_variants
  );
END;
$function$;


-- ─── update_product_variants — firma nueva con audit ────────────────────────
-- Drop antes de recrear, porque la firma cambia (no se puede CREATE OR REPLACE
-- con args distintos).
DROP FUNCTION IF EXISTS public.update_product_variants(uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.update_product_variants(
  p_operator_id uuid,
  p_business_id uuid,
  p_product_id  uuid,
  p_options     jsonb,
  p_variants    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_product_name       text;
  v_old_data           jsonb;
  v_new_data           jsonb;
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
  -- Validación de actor + business + permiso (mismo patrón que update_product)
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role
  INTO v_stock_write, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  -- Producto debe existir en este business
  SELECT name INTO v_product_name
  FROM products
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  IF v_product_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  -- Snapshot pre-mutación
  v_old_data := product_variants_snapshot(v_caller_business_id, p_product_id);

  -- ── Aplicar mutaciones (lógica existente, sin cambios funcionales) ───────
  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    IF (v_option->>'id') IS NOT NULL THEN
      UPDATE product_options
      SET
        attribute_type_id = COALESCE(v_option->>'attribute_type_id', attribute_type_id),
        name              = COALESCE(v_option->>'name', name),
        position          = COALESCE((v_option->>'position')::int, position)
      WHERE id = (v_option->>'id')::uuid AND business_id = v_caller_business_id;

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
        v_caller_business_id,
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
      WHERE id = (v_variant->>'id')::uuid AND business_id = v_caller_business_id;

      v_variant_id := (v_variant->>'id')::uuid;
    ELSE
      INSERT INTO product_variants (
        business_id, product_id, sku, barcode, price, cost,
        stock, min_stock, image_url, image_source, is_active
      )
      VALUES (
        v_caller_business_id,
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
    AND business_id  = v_caller_business_id
    AND is_active    = true
    AND id <> ALL(v_active_ids);

  SELECT COUNT(*)::int INTO v_active_count
  FROM product_variants
  WHERE product_id  = p_product_id
    AND business_id = v_caller_business_id
    AND is_active   = true;

  UPDATE products
  SET has_variants = (v_active_count > 0)
  WHERE id = p_product_id AND business_id = v_caller_business_id;

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
          AND business_id = v_caller_business_id
          AND is_active   = true
        ORDER BY created_at ASC LIMIT 1
      )
    END
  )
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  -- Snapshot post-mutación + audit log
  v_new_data := product_variants_snapshot(v_caller_business_id, p_product_id);

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'product_variants_updated',
    'product',
    p_product_id,
    v_product_name,
    v_old_data,
    v_new_data
  );

  RETURN jsonb_build_object('success', true, 'active_variants', v_active_count);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;


-- ─── create_product_with_variants — firma nueva con audit ───────────────────
DROP FUNCTION IF EXISTS public.create_product_with_variants(jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.create_product_with_variants(
  p_operator_id uuid,
  p_business_id uuid,
  p_product     jsonb,
  p_options     jsonb,
  p_variants    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_product_id         uuid;
  v_product_name       text;
  v_new_data           jsonb;
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
  -- Validación de actor + business + permiso
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role
  INTO v_stock_write, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  v_product_name := p_product->>'name';

  -- ── Inserción del producto, opciones y variantes (lógica existente) ───────
  INSERT INTO products (
    business_id, category_id, brand_id, name, sku, barcode,
    price, cost, stock, min_stock, image_url, image_source,
    is_active, show_in_catalog, has_variants
  )
  VALUES (
    v_caller_business_id,
    NULLIF(p_product->>'category_id', '')::uuid,
    NULLIF(p_product->>'brand_id', '')::uuid,
    v_product_name,
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
      v_caller_business_id,
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
      v_caller_business_id,
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

    IF v_default_variant_id IS NULL THEN
      v_default_variant_id := v_variant_id;
    END IF;
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
  WHERE id = v_product_id AND business_id = v_caller_business_id;

  -- Snapshot completo + audit log
  v_new_data := product_variants_snapshot(v_caller_business_id, v_product_id);

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'product_variants_created',
    'product',
    v_product_id,
    v_product_name,
    NULL,
    v_new_data
  );

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
