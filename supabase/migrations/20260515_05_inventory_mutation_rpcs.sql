-- Inventory mutation RPCs: replace direct client-side .insert/.update/.delete
-- calls on products/categories/brands so that operator context is always
-- available at the DB level. Required pre-work for the audit log feature.
--
-- This migration adds:
--   - delete_category   (replaces direct .delete() in CategoryModal)
--   - delete_brand      (replaces direct .delete() in BrandModal)
--   - update_product    (replaces direct .update() in InventoryPanel.updateProduct)
--   - delete_product    (replaces direct .delete() in InventoryPanel.handleDeleteProductImpl)
--
-- All functions follow the same permission pattern as create_category_guarded /
-- update_brand: operator row -> check stock_write permission; profile row ->
-- treat as owner; neither -> reject.

-- =============================================================================
-- delete_category
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_category(
  p_operator_id uuid,
  p_business_id uuid,
  p_category_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write' INTO v_stock_write
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
  END IF;

  -- products.category_id is ON DELETE SET NULL; no manual cascade needed.
  DELETE FROM categories
  WHERE id = p_category_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_category(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_category(uuid, uuid, uuid) TO authenticated;


-- =============================================================================
-- delete_brand
-- =============================================================================
CREATE OR REPLACE FUNCTION public.delete_brand(
  p_operator_id uuid,
  p_business_id uuid,
  p_brand_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write' INTO v_stock_write
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
  END IF;

  -- products.brand_id is ON DELETE SET NULL; price_list_overrides.brand_id
  -- is ON DELETE CASCADE. No manual cascade needed.
  DELETE FROM brands
  WHERE id = p_brand_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_brand(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_brand(uuid, uuid, uuid) TO authenticated;


-- =============================================================================
-- update_product
-- =============================================================================
-- Partial update: only columns whose key is present in p_changes are written.
-- This matches the client's existing `Partial<InventoryProduct>` pattern and
-- preserves the distinction between "don't touch" (key absent) and "set null"
-- (key present, value null) for nullable FKs.
--
-- Whitelist of allowed keys:
--   name, sku, barcode, price, cost, stock, min_stock,
--   category_id, brand_id, image_url, image_source,
--   is_active, show_in_catalog, has_variants
-- Any other key in p_changes is silently ignored.
CREATE OR REPLACE FUNCTION public.update_product(
  p_operator_id uuid,
  p_business_id uuid,
  p_product_id uuid,
  p_changes jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
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

  SELECT permissions->>'stock_write' INTO v_stock_write
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
  END IF;

  UPDATE products SET
    name            = CASE WHEN p_changes ? 'name'            THEN btrim(p_changes->>'name')                  ELSE name END,
    sku             = CASE WHEN p_changes ? 'sku'             THEN NULLIF(p_changes->>'sku', '')              ELSE sku END,
    barcode         = CASE WHEN p_changes ? 'barcode'         THEN NULLIF(p_changes->>'barcode', '')          ELSE barcode END,
    price           = CASE WHEN p_changes ? 'price'           THEN (p_changes->>'price')::numeric             ELSE price END,
    cost            = CASE WHEN p_changes ? 'cost'            THEN (p_changes->>'cost')::numeric              ELSE cost END,
    stock           = CASE WHEN p_changes ? 'stock'           THEN (p_changes->>'stock')::int                 ELSE stock END,
    min_stock       = CASE WHEN p_changes ? 'min_stock'       THEN (p_changes->>'min_stock')::int             ELSE min_stock END,
    category_id     = CASE WHEN p_changes ? 'category_id'     THEN NULLIF(p_changes->>'category_id', '')::uuid ELSE category_id END,
    brand_id        = CASE WHEN p_changes ? 'brand_id'        THEN NULLIF(p_changes->>'brand_id', '')::uuid    ELSE brand_id END,
    image_url       = CASE WHEN p_changes ? 'image_url'       THEN NULLIF(p_changes->>'image_url', '')         ELSE image_url END,
    image_source    = CASE WHEN p_changes ? 'image_source'    THEN NULLIF(p_changes->>'image_source', '')      ELSE image_source END,
    is_active       = CASE WHEN p_changes ? 'is_active'       THEN (p_changes->>'is_active')::boolean          ELSE is_active END,
    show_in_catalog = CASE WHEN p_changes ? 'show_in_catalog' THEN (p_changes->>'show_in_catalog')::boolean    ELSE show_in_catalog END,
    has_variants    = CASE WHEN p_changes ? 'has_variants'    THEN (p_changes->>'has_variants')::boolean       ELSE has_variants END
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_product(uuid, uuid, uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_product(uuid, uuid, uuid, jsonb) TO authenticated;


-- =============================================================================
-- delete_product (single)
-- =============================================================================
-- Mirrors bulk_delete_products soft-delete logic for a single product:
--   - if product has any completed sale_items: set is_active = false (soft)
--   - else: hard delete + clean up price_list_overrides and inventory_movements
-- Returns { success, soft_deleted } so the client can react accordingly.
CREATE OR REPLACE FUNCTION public.delete_product(
  p_operator_id uuid,
  p_business_id uuid,
  p_product_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write text;
  v_has_sales boolean;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'stock_write' INTO v_stock_write
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE si.product_id = p_product_id
      AND s.business_id = v_caller_business_id
      AND s.status = 'completed'
  ) INTO v_has_sales;

  IF v_has_sales THEN
    UPDATE products SET is_active = false
    WHERE id = p_product_id AND business_id = v_caller_business_id;
    RETURN jsonb_build_object('success', true, 'soft_deleted', true);
  END IF;

  DELETE FROM price_list_overrides WHERE product_id = p_product_id;
  DELETE FROM inventory_movements  WHERE product_id = p_product_id;
  DELETE FROM products WHERE id = p_product_id AND business_id = v_caller_business_id;

  RETURN jsonb_build_object('success', true, 'soft_deleted', false);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_product(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_product(uuid, uuid, uuid) TO authenticated;
