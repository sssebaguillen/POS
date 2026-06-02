-- Normaliza el contrato de las RPCs bulk de inventario para que el RETURN de éxito
-- incluya 'success', true (igual que update_product / delete_product / create_*).
-- Antes devolvían solo {updated:N} / {deleted,discontinued} en el happy-path y
-- {success:false, error} en los fallos: shape asimétrico que hacía que el cliente
-- (InventoryPanel) no pudiera distinguir un 403 de permisos de un éxito con 0 filas.
-- CREATE OR REPLACE preserva owner y grants (REVOKE/GRANT ya aplicados en migraciones previas).

CREATE OR REPLACE FUNCTION "public"."bulk_delete_products"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_deleted int := 0; v_discontinued int := 0; v_pid uuid; v_has_sales boolean;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  FOREACH v_pid IN ARRAY p_product_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_pid AND business_id = p_business_id) THEN CONTINUE; END IF;
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
  RETURN jsonb_build_object('success', true, 'deleted', v_deleted, 'discontinued', v_discontinued);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."bulk_set_product_status"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_is_active" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  WITH updated AS (
    UPDATE products SET is_active = p_is_active
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
      AND is_active IS DISTINCT FROM p_is_active
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_status', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('is_active', p_is_active));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."bulk_set_product_catalog"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_show_in_catalog" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  WITH updated AS (
    UPDATE products SET show_in_catalog = p_show_in_catalog
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
      AND show_in_catalog IS DISTINCT FROM p_show_in_catalog
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_catalog', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('show_in_catalog', p_show_in_catalog));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."bulk_update_product_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_brand_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = p_business_id
  ) THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  WITH updated AS (
    UPDATE products SET brand_id = p_brand_id
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_brand', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('brand_id', p_brand_id));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."bulk_update_product_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_category_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = p_business_id
  ) THEN RAISE EXCEPTION 'category_not_found'; END IF;
  WITH updated AS (
    UPDATE products SET category_id = p_category_id
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_category', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('category_id', p_category_id));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;
