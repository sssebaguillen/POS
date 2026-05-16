-- P7h Phase 2: instrument operator RPCs with log_audit_event.
-- Signature changes for create_operator and update_operator (adds explicit actor).

DROP FUNCTION IF EXISTS public.create_operator(uuid, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_operator(
  p_actor_operator_id uuid,
  p_business_id       uuid,
  p_name              text,
  p_role              text,
  p_pin               text,
  p_permissions       jsonb DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id  uuid;
  v_perm                text;
  v_actor_role          text;
  v_default_permissions jsonb;
  v_final_permissions   jsonb;
  v_operator_id         uuid;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_actor_operator_id IS NOT NULL THEN
    SELECT permissions->>'operators_write', role INTO v_perm, v_actor_role
    FROM operators
    WHERE id = p_actor_operator_id AND business_id = v_caller_business_id AND is_active = true;

    IF FOUND THEN
      IF v_perm <> 'true' THEN
        RETURN json_build_object('success', false, 'error', '403: Permisos de gestión de operadores insuficientes');
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_actor_operator_id AND business_id = v_caller_business_id) THEN
        RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
      END IF;
      v_actor_role := 'owner';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND business_id = v_caller_business_id) THEN
      RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_default_permissions := CASE p_role
    WHEN 'manager' THEN
      '{"sales": true, "stock": true, "stock_write": true, "analysis": true, "price_lists": true, "price_lists_write": true, "settings": false, "operators_write": false, "expenses": false}'::jsonb
    WHEN 'cashier' THEN
      '{"sales": true, "stock": true, "stock_write": false, "analysis": false, "price_lists": false, "price_lists_write": false, "settings": false, "operators_write": false, "expenses": false}'::jsonb
    ELSE
      '{"sales": true, "stock": false, "stock_write": false, "analysis": false, "price_lists": false, "price_lists_write": false, "settings": false, "operators_write": false, "expenses": false}'::jsonb
  END;

  v_final_permissions := COALESCE(p_permissions, v_default_permissions);

  IF (v_final_permissions->>'expenses') IS NULL THEN
    v_final_permissions := v_final_permissions || '{"expenses": false}'::jsonb;
  END IF;
  IF (v_final_permissions->>'operators_write') IS NULL THEN
    v_final_permissions := v_final_permissions || '{"operators_write": false}'::jsonb;
  END IF;

  INSERT INTO operators (business_id, name, role, pin, permissions)
  VALUES (
    p_business_id,
    p_name,
    p_role,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    v_final_permissions
  )
  RETURNING id INTO v_operator_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_actor_operator_id END,
    v_actor_role,
    'operator_created', 'operator', v_operator_id, p_name,
    NULL,
    jsonb_build_object(
      'name',        p_name,
      'role',        p_role,
      'permissions', v_final_permissions
    )
  );

  RETURN json_build_object('success', true, 'operator_id', v_operator_id);
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_operator(uuid, uuid, text, text, text, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_operator(uuid, uuid, text, text, text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.update_operator(uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.update_operator(
  p_actor_operator_id  uuid,
  p_business_id        uuid,
  p_target_operator_id uuid,
  p_name               text DEFAULT NULL,
  p_new_pin            text DEFAULT NULL,
  p_permissions        jsonb DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
  v_old_name           text;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_actor_operator_id IS NOT NULL THEN
    SELECT permissions->>'operators_write', role INTO v_perm, v_actor_role
    FROM operators
    WHERE id = p_actor_operator_id AND business_id = v_caller_business_id AND is_active = true;

    IF FOUND THEN
      IF v_perm <> 'true' THEN
        RETURN json_build_object('success', false, 'error', '403: Permisos de gestión de operadores insuficientes');
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_actor_operator_id AND business_id = v_caller_business_id) THEN
        RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
      END IF;
      v_actor_role := 'owner';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND business_id = v_caller_business_id) THEN
      RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'name',        o.name,
    'role',        o.role,
    'permissions', o.permissions,
    'is_active',   o.is_active
  ), o.name INTO v_old_data, v_old_name
  FROM operators o
  WHERE o.id = p_target_operator_id AND o.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'operator_not_found');
  END IF;

  UPDATE operators
  SET
    name        = COALESCE(p_name, name),
    pin         = CASE
                    WHEN p_new_pin IS NOT NULL
                    THEN extensions.crypt(p_new_pin, extensions.gen_salt('bf'))
                    ELSE pin
                  END,
    permissions = CASE
                    WHEN p_permissions IS NOT NULL
                    THEN permissions || p_permissions
                    ELSE permissions
                  END
  WHERE id = p_target_operator_id AND business_id = v_caller_business_id
  RETURNING jsonb_build_object(
    'name',        name,
    'role',        role,
    'permissions', permissions,
    'is_active',   is_active,
    'pin_changed', (p_new_pin IS NOT NULL)
  ) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_actor_operator_id END,
    v_actor_role,
    'operator_updated', 'operator', p_target_operator_id, v_old_name,
    v_old_data, v_new_data
  );

  RETURN json_build_object('success', true);
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_operator(uuid, uuid, uuid, text, text, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_operator(uuid, uuid, uuid, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_operator(
  p_operator_id        uuid,
  p_business_id        uuid,
  p_target_operator_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
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

  IF p_target_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador no especificado');
  END IF;

  IF p_target_operator_id = p_operator_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No podés eliminar tu propio operador');
  END IF;

  SELECT permissions->>'operators_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gestión de operadores insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'name',        o.name,
    'role',        o.role,
    'permissions', o.permissions,
    'is_active',   o.is_active
  ), o.name INTO v_old_data, v_old_name
  FROM operators o
  WHERE o.id = p_target_operator_id AND o.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador no encontrado');
  END IF;

  DELETE FROM operators
  WHERE id = p_target_operator_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'operator_deleted', 'operator', p_target_operator_id, v_old_name,
    v_old_data, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
