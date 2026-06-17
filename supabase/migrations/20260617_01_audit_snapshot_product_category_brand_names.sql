-- Snapshot inmutable de los NOMBRES de categoría/marca en el audit log de
-- producto INDIVIDUAL (create/delete). Antes el payload guardaba solo
-- category_id/brand_id y el detalle resolvía el nombre en read-time contra
-- categoryMap/brandMap, así que un rename/borrado posterior hacía derivar el
-- nombre mostrado (debería reflejar el estado al momento del evento).
--
-- Mismo patrón ya probado en las acciones masivas (20260529_13). Acá lo
-- aplicamos al path de producto individual que alimenta <ProductSummary>:
--   - create_product → new_data: suma category_name/brand_name del alta.
--   - delete_product → old_data: suma category_name/brand_name al snapshot.
--
-- Retrocompat: el frontend PREFIERE el nombre snapshotado y cae a
-- categoryMap/brandMap si no existe (entradas viejas sin el campo).
--
-- update_product (path de <ProductDiff>, before/after) queda PENDIENTE a
-- propósito (refactor aparte, un PR por path) — ver backlog P7h.
--
-- Solo cambia el payload de auditoría; ninguna otra lógica (stock, precios,
-- overrides, permisos, tenant guard) se toca.

CREATE OR REPLACE FUNCTION public.create_product(p_operator_id uuid, p_business_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_new_id             uuid;
  v_name               text;
  v_overrides          jsonb;
  v_audit_data         jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Datos inválidos');
  END IF;
  v_name := btrim(p_data->>'name');
  IF v_name IS NULL OR v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
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
  INSERT INTO products (
    business_id, name, sku, brand_id, barcode, category_id,
    price, cost, stock, min_stock, is_active, image_url, image_source
  ) VALUES (
    v_caller_business_id, v_name,
    NULLIF(p_data->>'sku', ''),
    NULLIF(p_data->>'brand_id', '')::uuid,
    NULLIF(p_data->>'barcode', ''),
    NULLIF(p_data->>'category_id', '')::uuid,
    COALESCE((p_data->>'price')::numeric, 0),
    COALESCE((p_data->>'cost')::numeric, 0),
    COALESCE((p_data->>'stock')::int, 0),
    COALESCE((p_data->>'min_stock')::int, 0),
    COALESCE((p_data->>'is_active')::boolean, true),
    NULLIF(p_data->>'image_url', ''),
    NULLIF(p_data->>'image_source', '')
  ) RETURNING id INTO v_new_id;
  v_overrides := p_data->'price_list_overrides';
  IF v_overrides IS NOT NULL AND jsonb_typeof(v_overrides) = 'array' AND jsonb_array_length(v_overrides) > 0 THEN
    INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
    SELECT (item->>'price_list_id')::uuid, v_new_id, NULL, (item->>'multiplier')::numeric
    FROM jsonb_array_elements(v_overrides) AS item
    WHERE item->>'price_list_id' IS NOT NULL AND item->>'multiplier' IS NOT NULL;
  END IF;
  -- Snapshot inmutable de los nombres de categoría/marca al momento del alta.
  v_audit_data := p_data || jsonb_build_object(
    'category_name', (SELECT c.name FROM categories c
                      WHERE c.id = NULLIF(p_data->>'category_id', '')::uuid
                        AND c.business_id = v_caller_business_id),
    'brand_name',    (SELECT b.name FROM brands b
                      WHERE b.id = NULLIF(p_data->>'brand_id', '')::uuid
                        AND b.business_id = v_caller_business_id)
  );
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_created', 'product', v_new_id, v_name, NULL, v_audit_data);
  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_product(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product(uuid, uuid, jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.delete_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_has_sales boolean; v_old_data jsonb; v_old_name text;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  -- Snapshot inmutable: suma category_name/brand_name al estado pre-borrado.
  SELECT to_jsonb(p) || jsonb_build_object(
           'category_name', (SELECT c.name FROM categories c WHERE c.id = p.category_id),
           'brand_name',    (SELECT b.name FROM brands b WHERE b.id = p.brand_id)
         ), p.name
  INTO v_old_data, v_old_name
  FROM products p WHERE p.id = p_product_id AND p.business_id = v_caller_business_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado'); END IF;
  SELECT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.product_id = p_product_id AND s.business_id = v_caller_business_id AND s.status = 'completed') INTO v_has_sales;
  IF v_has_sales THEN
    UPDATE products SET is_active = false WHERE id = p_product_id AND business_id = v_caller_business_id;
    PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
      'product_deleted', 'product', p_product_id, v_old_name, v_old_data, NULL);
    RETURN jsonb_build_object('success', true, 'soft_deleted', true);
  END IF;
  DELETE FROM price_list_overrides WHERE product_id = p_product_id;
  DELETE FROM inventory_movements  WHERE product_id = p_product_id;
  DELETE FROM products WHERE id = p_product_id AND business_id = v_caller_business_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_deleted', 'product', p_product_id, v_old_name, v_old_data, NULL);
  RETURN jsonb_build_object('success', true, 'soft_deleted', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_product(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_product(uuid, uuid, uuid) TO authenticated, service_role;
