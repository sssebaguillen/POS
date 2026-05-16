-- P7h Phase 2: instrument supplier RPCs with log_audit_event.

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
  v_actor_role         text;
  v_supplier           jsonb;
  v_supplier_id        uuid;
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

  SELECT permissions->>'expenses', role INTO v_expenses_perm, v_actor_role
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
    v_actor_role := 'owner';
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
  RETURNING id, to_jsonb(suppliers.*) INTO v_supplier_id, v_supplier;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'supplier_created', 'supplier', v_supplier_id, btrim(p_name),
    NULL, v_supplier
  );

  RETURN jsonb_build_object('success', true, 'supplier', v_supplier);
END;
$$;

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
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
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

  SELECT permissions->>'expenses', role INTO v_expenses_perm, v_actor_role
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
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(s.*) INTO v_old_data
  FROM suppliers s
  WHERE s.id = p_supplier_id AND s.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proveedor no encontrado');
  END IF;

  UPDATE suppliers SET
    name         = btrim(p_name),
    contact_name = NULLIF(btrim(p_contact_name), ''),
    phone        = NULLIF(btrim(p_phone), ''),
    email        = NULLIF(btrim(p_email), ''),
    address      = NULLIF(btrim(p_address), ''),
    notes        = NULLIF(btrim(p_notes), '')
  WHERE id = p_supplier_id AND business_id = v_caller_business_id
  RETURNING to_jsonb(suppliers.*) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'supplier_updated', 'supplier', p_supplier_id, btrim(p_name),
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

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
  v_actor_role         text;
  v_old_data           jsonb;
  v_old_name           text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'expenses', role INTO v_expenses_perm, v_actor_role
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
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(s.*), s.name INTO v_old_data, v_old_name
  FROM suppliers s
  WHERE s.id = p_supplier_id AND s.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proveedor no encontrado');
  END IF;

  UPDATE suppliers
  SET is_active = false
  WHERE id = p_supplier_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'supplier_deactivated', 'supplier', p_supplier_id, v_old_name,
    v_old_data, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
