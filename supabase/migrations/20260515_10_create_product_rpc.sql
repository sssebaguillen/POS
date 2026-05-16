-- P7h Phase 1 follow-up: wrap product creation in a SECURITY DEFINER RPC so
-- the INSERT + optional price_list_overrides + audit log run atomically and
-- the stock_write permission is enforced at the DB level (matches the
-- update_product / delete_product pattern).
--
-- p_data shape (jsonb):
--   {
--     "name":            text   (required, non-empty after btrim),
--     "sku":             text|null,
--     "brand_id":        uuid|null,
--     "barcode":         text|null,
--     "category_id":     uuid|null,
--     "price":           numeric,
--     "cost":            numeric,
--     "stock":           int,
--     "min_stock":       int,
--     "is_active":       boolean,
--     "image_url":       text|null,
--     "image_source":    'upload'|'url'|null,
--     "price_list_overrides": [
--       { "price_list_id": uuid, "multiplier": numeric }
--     ]    (optional)
--   }
--
-- Returns: { success, id?, error? }

CREATE OR REPLACE FUNCTION public.create_product(
  p_operator_id uuid,
  p_business_id uuid,
  p_data        jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
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

  -- Strip nothing internal; p_data is already client-shaped. Just record it
  -- as-is for the audit trail.
  v_audit_data := p_data;

  PERFORM log_audit_event(
    p_business_id, p_operator_id, v_actor_role,
    'product_created', 'product', v_new_id, v_name,
    NULL, v_audit_data
  );

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_product(uuid, uuid, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_product(uuid, uuid, jsonb) TO authenticated;
