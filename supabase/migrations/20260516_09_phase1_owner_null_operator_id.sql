-- Fix: Phase 1 audit-logged RPCs (inventory + sales) were passing
-- p_operator_id straight to log_audit_event for the owner path. Owners are
-- not in operators(id) — the convention (established by the Phase 2 fix in
-- 20260516_08_expense_owner_null_operator_id.sql) is to translate the actor
-- to NULL when actor_role = 'owner' before storing it in audit_log.
--
-- This migration re-creates each Phase 1 mutation RPC with that translation,
-- without changing any other behavior. Only the operator id passed to
-- log_audit_event is affected; sales.operator_id and other inserts are left
-- untouched.

-- ============================================================================
-- create_product
-- ============================================================================
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

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  INSERT INTO products (
    business_id, name, sku, brand_id, barcode, category_id,
    price, cost, stock, min_stock, is_active, image_url, image_source
  ) VALUES (
    v_caller_business_id,
    v_name,
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
    SELECT
      (item->>'price_list_id')::uuid,
      v_new_id,
      NULL,
      (item->>'multiplier')::numeric
    FROM jsonb_array_elements(v_overrides) AS item
    WHERE item->>'price_list_id' IS NOT NULL
      AND item->>'multiplier'    IS NOT NULL;
  END IF;

  v_audit_data := p_data;

  PERFORM log_audit_event(
    p_business_id, v_stored_op_id, v_actor_role,
    'product_created', 'product', v_new_id, v_name,
    NULL, v_audit_data
  );

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$function$;

-- ============================================================================
-- update_product
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_old_data    jsonb;
  v_old_name    text;
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

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  SELECT to_jsonb(p), p.name INTO v_old_data, v_old_name
  FROM products p WHERE p.id = p_product_id AND p.business_id = v_caller_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

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

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_updated', 'product', p_product_id, v_old_name, v_old_data, p_changes);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- delete_product
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_has_sales   boolean;
  v_old_data    jsonb;
  v_old_name    text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  SELECT to_jsonb(p), p.name INTO v_old_data, v_old_name
  FROM products p WHERE p.id = p_product_id AND p.business_id = v_caller_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.product_id = p_product_id AND s.business_id = v_caller_business_id AND s.status = 'completed'
  ) INTO v_has_sales;

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

-- ============================================================================
-- bulk_delete_products
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_delete_products(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_deleted     int := 0;
  v_discontinued int := 0;
  v_pid uuid;
  v_has_sales boolean;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  FOREACH v_pid IN ARRAY p_product_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_pid AND business_id = p_business_id) THEN
      CONTINUE;
    END IF;
    SELECT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = v_pid AND s.business_id = p_business_id AND s.status = 'completed') INTO v_has_sales;
    IF v_has_sales THEN
      UPDATE products SET is_active = false WHERE id = v_pid AND business_id = p_business_id;
      v_discontinued := v_discontinued + 1;
    ELSE
      DELETE FROM price_list_overrides WHERE product_id = v_pid;
      DELETE FROM inventory_movements  WHERE product_id = v_pid;
      DELETE FROM products WHERE id = v_pid AND business_id = p_business_id;
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_deleted', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(p_product_ids), 'count', v_deleted + v_discontinued), NULL);

  RETURN jsonb_build_object('deleted', v_deleted, 'discontinued', v_discontinued);
END;
$function$;

-- ============================================================================
-- bulk_set_product_status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_set_product_status(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_is_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_count       int;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  UPDATE products SET is_active = p_is_active
  WHERE id = ANY(p_product_ids) AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_status', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(p_product_ids), 'count', v_count),
    jsonb_build_object('is_active', p_is_active));

  RETURN jsonb_build_object('updated', v_count);
END;
$function$;

-- ============================================================================
-- bulk_update_product_category
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_update_product_category(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_count       int;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = p_business_id
  ) THEN RAISE EXCEPTION 'category_not_found'; END IF;

  UPDATE products SET category_id = p_category_id
  WHERE id = ANY(p_product_ids) AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_category', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(p_product_ids), 'count', v_count),
    jsonb_build_object('category_id', p_category_id));

  RETURN jsonb_build_object('updated', v_count);
END;
$function$;

-- ============================================================================
-- bulk_update_product_brand
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_update_product_brand(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_count       int;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = p_business_id
  ) THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  UPDATE products SET brand_id = p_brand_id
  WHERE id = ANY(p_product_ids) AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_brand', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(p_product_ids), 'count', v_count),
    jsonb_build_object('brand_id', p_brand_id));

  RETURN jsonb_build_object('updated', v_count);
END;
$function$;

-- ============================================================================
-- create_category_guarded
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_category_guarded(p_operator_id uuid, p_business_id uuid, p_name text, p_icon text, p_icon_color text DEFAULT NULL::text)
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
  v_icon_color         text;
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

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  INSERT INTO categories (business_id, name, icon, icon_color, is_active)
  VALUES (v_caller_business_id, btrim(p_name), btrim(p_icon), p_icon_color, true)
  RETURNING id, icon_color INTO v_new_id, v_icon_color;

  PERFORM log_audit_event(
    p_business_id, v_stored_op_id, v_actor_role,
    'category_created', 'category', v_new_id, btrim(p_name),
    NULL,
    jsonb_build_object('name', btrim(p_name), 'icon', btrim(p_icon), 'icon_color', v_icon_color)
  );

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$function$;

-- ============================================================================
-- update_category
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid, p_name text, p_icon text, p_icon_color text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_old_data    jsonb;
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

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  SELECT jsonb_build_object('name', name, 'icon', icon, 'icon_color', icon_color) INTO v_old_data
  FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;

  UPDATE categories SET name = btrim(p_name), icon = btrim(p_icon), icon_color = p_icon_color
  WHERE id = p_category_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'category_updated', 'category', p_category_id, btrim(p_name), v_old_data,
    jsonb_build_object('name', btrim(p_name), 'icon', btrim(p_icon), 'icon_color', p_icon_color));

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- delete_category
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_old_data    jsonb;
  v_old_name    text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  SELECT jsonb_build_object('name', name, 'icon', icon, 'icon_color', icon_color), name
    INTO v_old_data, v_old_name
  FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;

  DELETE FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'category_deleted', 'category', p_category_id, v_old_name, v_old_data, NULL);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- create_brand_guarded
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_brand_guarded(p_operator_id uuid, p_business_id uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_new_id      uuid;
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

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  INSERT INTO brands (business_id, name)
  VALUES (v_caller_business_id, btrim(p_name)) RETURNING id INTO v_new_id;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'brand_created', 'brand', v_new_id, btrim(p_name), NULL,
    jsonb_build_object('name', btrim(p_name)));

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$function$;

-- ============================================================================
-- update_brand
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_old_name    text;
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

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  SELECT name INTO v_old_name FROM brands
  WHERE id = p_brand_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada');
  END IF;

  UPDATE brands SET name = btrim(p_name)
  WHERE id = p_brand_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'brand_updated', 'brand', p_brand_id, btrim(p_name),
    jsonb_build_object('name', v_old_name),
    jsonb_build_object('name', btrim(p_name)));

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- delete_brand
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_actor_role  text;
  v_stored_op_id uuid;
  v_old_name    text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
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

  SELECT name INTO v_old_name FROM brands
  WHERE id = p_brand_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada');
  END IF;

  DELETE FROM brands WHERE id = p_brand_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'brand_deleted', 'brand', p_brand_id, v_old_name,
    jsonb_build_object('name', v_old_name), NULL);

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- create_sale_transaction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_sale_transaction(p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric, p_status text, p_price_list_id uuid, p_operator_id uuid, p_items jsonb, p_payments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
  v_payment            jsonb;
  v_payments_total     numeric := 0;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_new_data           jsonb;
BEGIN
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un item');
  END IF;

  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un pago');
  END IF;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric;
  END LOOP;

  IF v_payments_total < p_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'El monto de los pagos no cubre el total de la venta');
  END IF;

  INSERT INTO sales (business_id, subtotal, discount, total, status, price_list_id, operator_id)
  VALUES (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id)
  RETURNING id, created_at INTO v_sale_id, v_sale_created_at;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO sale_items (
      sale_id, product_id, variant_id, quantity, unit_price, total,
      unit_price_override, override_reason, free_line_description
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      (v_item->>'unit_price_override')::numeric,
      v_item->>'override_reason',
      v_item->>'free_line_description'
    );
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    INSERT INTO payments (sale_id, method, amount, status)
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::numeric,
      'completed'
    );
  END LOOP;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = v_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = v_sale_id
    ), '[]'::jsonb)
  ) INTO v_new_data
  FROM sales s WHERE s.id = v_sale_id;

  PERFORM log_audit_event(
    p_business_id, v_stored_op_id, v_actor_role,
    'sale_created', 'sale', v_sale_id, NULL,
    NULL,
    v_new_data
  );

  RETURN jsonb_build_object(
    'success',    true,
    'sale_id',    v_sale_id,
    'created_at', v_sale_created_at
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- ============================================================================
-- update_sale
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_sale(p_sale_id uuid, p_business_id uuid, p_items jsonb, p_payment_method text, p_operator_id uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_total      numeric(12,2);
  v_actor_role text;
  v_stored_op_id uuid;
  v_old_data   jsonb;
  v_new_data   jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id
    ), '[]'::jsonb)
  ) INTO v_old_data
  FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;

  UPDATE products p
  SET
    stock       = p.stock + si.quantity,
    sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND p.id          = si.product_id
    AND si.variant_id IS NULL;

  UPDATE product_variants pv
  SET stock = pv.stock + si.quantity
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND pv.id         = si.variant_id
    AND si.variant_id IS NOT NULL;

  UPDATE products p
  SET sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND p.id          = si.product_id
    AND si.variant_id IS NOT NULL;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, unit_price, total)
  SELECT
    p_sale_id,
    (item->>'product_id')::uuid,
    NULLIF(item->>'variant_id', '')::uuid,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric(12,2),
    (item->>'quantity')::int * (item->>'unit_price')::numeric(12,2)
  FROM jsonb_array_elements(p_items) AS item;

  SELECT COALESCE(SUM(total), 0) INTO v_total
  FROM sale_items WHERE sale_id = p_sale_id;

  UPDATE sales
  SET
    total    = v_total,
    subtotal = v_total,
    status   = COALESCE(p_status, status)
  WHERE id = p_sale_id AND business_id = p_business_id;

  UPDATE payments
  SET method = p_payment_method
  WHERE sale_id = p_sale_id;

  PERFORM reconcile_sales_count(p_business_id);

  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id
    ), '[]'::jsonb)
  ) INTO v_new_data
  FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;

  PERFORM log_audit_event(
    p_business_id, v_stored_op_id, v_actor_role,
    'sale_updated', 'sale', p_sale_id, NULL,
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'total', v_total);
END;
$function$;

-- ============================================================================
-- delete_sale
-- ============================================================================
CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id uuid, p_business_id uuid, p_operator_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item       record;
  v_actor_role text;
  v_stored_op_id uuid;
  v_old_data   jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Sale not found');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id
    ), '[]'::jsonb)
  ) INTO v_old_data
  FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;

  FOR v_item IN
    SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    UPDATE products
    SET
      stock       = stock + v_item.quantity,
      sales_count = GREATEST(0, sales_count - v_item.quantity)
    WHERE id = v_item.product_id AND business_id = p_business_id;
  END LOOP;

  DELETE FROM inventory_movements WHERE reference_id = p_sale_id;
  DELETE FROM payments     WHERE sale_id = p_sale_id;
  DELETE FROM sale_items   WHERE sale_id = p_sale_id;
  DELETE FROM sales        WHERE id = p_sale_id AND business_id = p_business_id;

  PERFORM reconcile_sales_count(p_business_id);

  PERFORM log_audit_event(
    p_business_id, v_stored_op_id, v_actor_role,
    'sale_deleted', 'sale', p_sale_id, NULL,
    v_old_data, NULL
  );

  RETURN json_build_object('success', true);
END;
$function$;
