-- P7h Phase 2 pre-work: wrap suppliers CRUD in SECURITY DEFINER RPCs so that
-- operator context is captured at the DB layer. Required before audit log
-- instrumentation can be added (matches the Phase 1 inventory pattern).
--
-- All functions follow the same permission gate as the inventory RPCs:
--   operator row (is_active) -> check permissions->>'expenses' = 'true'
--   profile fallback         -> treat as owner
--   neither                  -> reject

-- =============================================================================
-- create_supplier
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_supplier(
  p_operator_id   uuid,
  p_business_id   uuid,
  p_name          text,
  p_contact_name  text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_email         text DEFAULT NULL,
  p_address       text DEFAULT NULL,
  p_notes         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_expenses_perm      text;
  v_supplier           jsonb;
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

  SELECT permissions->>'expenses' INTO v_expenses_perm
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_expenses_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gastos insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
  END IF;

  INSERT INTO suppliers (
    business_id, name, contact_name, phone, email, address, notes, is_active
  ) VALUES (
    v_caller_business_id,
    btrim(p_name),
    NULLIF(btrim(p_contact_name), ''),
    NULLIF(btrim(p_phone), ''),
    NULLIF(btrim(p_email), ''),
    NULLIF(btrim(p_address), ''),
    NULLIF(btrim(p_notes), ''),
    true
  )
  RETURNING to_jsonb(suppliers.*) INTO v_supplier;

  RETURN jsonb_build_object('success', true, 'supplier', v_supplier);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_supplier(uuid, uuid, text, text, text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_supplier(uuid, uuid, text, text, text, text, text, text) TO authenticated;


-- =============================================================================
-- update_supplier
-- =============================================================================
CREATE OR REPLACE FUNCTION public.update_supplier(
  p_operator_id  uuid,
  p_business_id  uuid,
  p_supplier_id  uuid,
  p_name         text,
  p_contact_name text DEFAULT NULL,
  p_phone        text DEFAULT NULL,
  p_email        text DEFAULT NULL,
  p_address      text DEFAULT NULL,
  p_notes        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_expenses_perm      text;
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

  SELECT permissions->>'expenses' INTO v_expenses_perm
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_expenses_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gastos insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
  END IF;

  UPDATE suppliers SET
    name         = btrim(p_name),
    contact_name = NULLIF(btrim(p_contact_name), ''),
    phone        = NULLIF(btrim(p_phone), ''),
    email        = NULLIF(btrim(p_email), ''),
    address      = NULLIF(btrim(p_address), ''),
    notes        = NULLIF(btrim(p_notes), '')
  WHERE id = p_supplier_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proveedor no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_supplier(uuid, uuid, uuid, text, text, text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_supplier(uuid, uuid, uuid, text, text, text, text, text, text) TO authenticated;


-- =============================================================================
-- deactivate_supplier (soft delete)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.deactivate_supplier(
  p_operator_id uuid,
  p_business_id uuid,
  p_supplier_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_expenses_perm      text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'expenses' INTO v_expenses_perm
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_expenses_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gastos insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
  END IF;

  UPDATE suppliers
  SET is_active = false
  WHERE id = p_supplier_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proveedor no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deactivate_supplier(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.deactivate_supplier(uuid, uuid, uuid) TO authenticated;
