-- Rediseño de permisos de operario (Fase 3) — datos + defaults al shape canónico de 8 keys.
--
-- F1 dejó las guardas leyendo vía normalize_permissions (shape-agnósticas) y F2 hizo lo mismo
-- en el frontend (parsePermissions bi-shape). Ahora es seguro canonicalizar el shape ALMACENADO:
--   1. create_operator / update_operator: role-defaults a 8 keys + normalize_permissions al
--      escribir (cualquier shape que llegue de p_permissions queda canónico). Se elimina el
--      back-fill viejo (expenses/operators_write) que F1 dejó intacto a propósito.
--   2. default de la columna operators.permissions → 8 keys.
--   3. migración one-shot de las filas existentes.
--
-- Requiere 20260609_01 (normalize_permissions). Idempotente: normalize es idempotente, así que
-- re-correr la migración de datos no cambia nada.

-- 1a) create_operator
CREATE OR REPLACE FUNCTION public.create_operator(p_actor_operator_id uuid, p_business_id uuid, p_name text, p_role text, p_pin text, p_permissions jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    SELECT normalize_permissions(permissions)->>'manage_operators', role INTO v_perm, v_actor_role
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
      '{"online_orders": true, "pos_pricing": true, "inventory_read": true, "inventory_write": true, "reports": true, "expenses": true, "settings": false, "manage_operators": false}'::jsonb
    WHEN 'cashier' THEN
      '{"online_orders": true, "pos_pricing": false, "inventory_read": true, "inventory_write": false, "reports": false, "expenses": false, "settings": false, "manage_operators": false}'::jsonb
    ELSE
      '{"online_orders": true, "pos_pricing": false, "inventory_read": false, "inventory_write": false, "reports": false, "expenses": false, "settings": false, "manage_operators": false}'::jsonb
  END;

  v_final_permissions := normalize_permissions(COALESCE(p_permissions, v_default_permissions));

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
$function$;

-- 1b) update_operator — normaliza el merge de permisos al guardar.
CREATE OR REPLACE FUNCTION public.update_operator(p_actor_operator_id uuid, p_business_id uuid, p_target_operator_id uuid, p_name text DEFAULT NULL::text, p_new_pin text DEFAULT NULL::text, p_permissions jsonb DEFAULT NULL::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
    SELECT normalize_permissions(permissions)->>'manage_operators', role INTO v_perm, v_actor_role
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
                    THEN normalize_permissions(permissions || p_permissions)
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
$function$;

-- 2) default de columna al shape canónico (preserva la semántica vieja: online_orders=true, resto false).
ALTER TABLE operators ALTER COLUMN permissions SET DEFAULT
  '{"online_orders": true, "pos_pricing": false, "inventory_read": false, "inventory_write": false, "reports": false, "expenses": false, "settings": false, "manage_operators": false}'::jsonb;

-- 3) migración one-shot de las filas existentes al shape canónico.
UPDATE operators SET permissions = normalize_permissions(permissions);
