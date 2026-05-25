-- Defense-in-depth: skipear log_audit_event cuando una mutación efectivamente no
-- cambia nada. Antes update_product loggeaba un evento aunque p_changes coincidiera
-- 1:1 con el estado actual (causa: EditProductModal con variantes mandaba un payload
-- hardcoded con price/cost/stock = 0 que en muchos casos ya era el valor del padre).
-- El front ya filtra los campos no-cambiados, pero esto cubre cualquier futuro caller.
--
-- Cambios:
--   - update_product: omitir log_audit_event si ningún field de p_changes difiere del estado pre-cambio.
--   - update_product_variants: omitir log si v_old_data IS NOT DISTINCT FROM v_new_data.

CREATE OR REPLACE FUNCTION public.update_product(
  p_operator_id uuid,
  p_business_id uuid,
  p_product_id  uuid,
  p_changes     jsonb
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
  v_old_data           jsonb;
  v_old_name           text;
  v_has_changes        boolean := false;
  v_key                text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin cambios');
  END IF;

  IF p_changes ? 'name' AND (p_changes->>'name' IS NULL OR btrim(p_changes->>'name') = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
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

  SELECT to_jsonb(p), p.name INTO v_old_data, v_old_name
  FROM products p WHERE p.id = p_product_id AND p.business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  -- Detectar si algún field en p_changes efectivamente difiere del estado actual.
  FOR v_key IN SELECT jsonb_object_keys(p_changes)
  LOOP
    IF v_old_data->v_key IS DISTINCT FROM p_changes->v_key THEN
      v_has_changes := true;
      EXIT;
    END IF;
  END LOOP;

  UPDATE products SET
    name            = CASE WHEN p_changes ? 'name'            THEN btrim(p_changes->>'name')                   ELSE name END,
    sku             = CASE WHEN p_changes ? 'sku'             THEN NULLIF(p_changes->>'sku', '')               ELSE sku END,
    barcode         = CASE WHEN p_changes ? 'barcode'         THEN NULLIF(p_changes->>'barcode', '')           ELSE barcode END,
    price           = CASE WHEN p_changes ? 'price'           THEN (p_changes->>'price')::numeric              ELSE price END,
    cost            = CASE WHEN p_changes ? 'cost'            THEN (p_changes->>'cost')::numeric               ELSE cost END,
    stock           = CASE WHEN p_changes ? 'stock'           THEN (p_changes->>'stock')::int                  ELSE stock END,
    min_stock       = CASE WHEN p_changes ? 'min_stock'       THEN (p_changes->>'min_stock')::int              ELSE min_stock END,
    category_id     = CASE WHEN p_changes ? 'category_id'     THEN NULLIF(p_changes->>'category_id', '')::uuid ELSE category_id END,
    brand_id        = CASE WHEN p_changes ? 'brand_id'        THEN NULLIF(p_changes->>'brand_id', '')::uuid    ELSE brand_id END,
    image_url       = CASE WHEN p_changes ? 'image_url'       THEN NULLIF(p_changes->>'image_url', '')         ELSE image_url END,
    image_source    = CASE WHEN p_changes ? 'image_source'    THEN NULLIF(p_changes->>'image_source', '')      ELSE image_source END,
    is_active       = CASE WHEN p_changes ? 'is_active'       THEN (p_changes->>'is_active')::boolean          ELSE is_active END,
    show_in_catalog = CASE WHEN p_changes ? 'show_in_catalog' THEN (p_changes->>'show_in_catalog')::boolean    ELSE show_in_catalog END,
    has_variants    = CASE WHEN p_changes ? 'has_variants'    THEN (p_changes->>'has_variants')::boolean       ELSE has_variants END
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  IF v_has_changes THEN
    PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
      'product_updated', 'product', p_product_id, v_old_name, v_old_data, p_changes);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;


-- update_product_variants: misma idea, pero el diff es por snapshot completo.
-- Reusamos toda la lógica existente; solo agregamos la guarda al final.
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

  SELECT name INTO v_product_name
  FROM products
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  IF v_product_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  v_old_data := product_variants_snapshot(v_caller_business_id, p_product_id);

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

  v_new_data := product_variants_snapshot(v_caller_business_id, p_product_id);

  IF v_old_data IS DISTINCT FROM v_new_data THEN
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
  END IF;

  RETURN jsonb_build_object('success', true, 'active_variants', v_active_count);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
