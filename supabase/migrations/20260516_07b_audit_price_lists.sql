-- P7h Phase 2: instrument price list RPCs with log_audit_event.

CREATE OR REPLACE FUNCTION public.create_price_list(
  p_operator_id uuid,
  p_business_id uuid,
  p_name        text,
  p_description text,
  p_multiplier  numeric,
  p_is_default  boolean,
  p_overrides   jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_list_id            uuid;
  v_list               jsonb;
  v_overrides          jsonb;
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

  IF p_multiplier IS NULL OR p_multiplier <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El margen debe ser mayor a 0');
  END IF;

  SELECT permissions->>'price_lists_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de listas de precios insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  IF p_is_default THEN
    UPDATE price_lists SET is_default = false
    WHERE business_id = v_caller_business_id AND is_default = true;
  END IF;

  INSERT INTO price_lists (business_id, name, description, multiplier, is_default)
  VALUES (
    v_caller_business_id,
    btrim(p_name),
    NULLIF(btrim(p_description), ''),
    p_multiplier,
    COALESCE(p_is_default, false)
  )
  RETURNING id, to_jsonb(price_lists.*) INTO v_list_id, v_list;

  IF p_overrides IS NOT NULL AND jsonb_typeof(p_overrides) = 'array' AND jsonb_array_length(p_overrides) > 0 THEN
    WITH inserted AS (
      INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
      SELECT
        v_list_id,
        (item->>'product_id')::uuid,
        NULL,
        (item->>'multiplier')::numeric
      FROM jsonb_array_elements(p_overrides) AS item
      WHERE item->>'product_id' IS NOT NULL
        AND item->>'multiplier' IS NOT NULL
      RETURNING id, price_list_id, product_id, brand_id, multiplier
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(inserted.*)), '[]'::jsonb) INTO v_overrides
    FROM inserted;
  ELSE
    v_overrides := '[]'::jsonb;
  END IF;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_created', 'price_list', v_list_id, btrim(p_name),
    NULL,
    jsonb_build_object(
      'list', v_list,
      'overrides_count', COALESCE(jsonb_array_length(v_overrides), 0)
    )
  );

  RETURN jsonb_build_object('success', true, 'list', v_list, 'overrides', v_overrides);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_price_list(
  p_operator_id           uuid,
  p_business_id           uuid,
  p_price_list_id         uuid,
  p_name                  text,
  p_description           text,
  p_multiplier            numeric,
  p_overrides_upsert      jsonb DEFAULT NULL,
  p_overrides_delete_ids  uuid[] DEFAULT NULL
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
  v_new_data           jsonb;
  v_old_name           text;
  v_upserted           jsonb;
  v_deleted            uuid[];
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

  IF p_multiplier IS NULL OR p_multiplier <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El margen debe ser mayor a 0');
  END IF;

  SELECT permissions->>'price_lists_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de listas de precios insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(pl.*), pl.name INTO v_old_data, v_old_name
  FROM price_lists pl
  WHERE pl.id = p_price_list_id AND pl.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lista de precios no encontrada');
  END IF;

  UPDATE price_lists SET
    name        = btrim(p_name),
    description = NULLIF(btrim(p_description), ''),
    multiplier  = p_multiplier
  WHERE id = p_price_list_id AND business_id = v_caller_business_id
  RETURNING to_jsonb(price_lists.*) INTO v_new_data;

  IF p_overrides_delete_ids IS NOT NULL AND array_length(p_overrides_delete_ids, 1) > 0 THEN
    WITH del AS (
      DELETE FROM price_list_overrides
      WHERE id = ANY(p_overrides_delete_ids)
        AND price_list_id = p_price_list_id
      RETURNING id
    )
    SELECT array_agg(id) INTO v_deleted FROM del;
  END IF;

  IF p_overrides_upsert IS NOT NULL
     AND jsonb_typeof(p_overrides_upsert) = 'array'
     AND jsonb_array_length(p_overrides_upsert) > 0
  THEN
    WITH ups AS (
      INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
      SELECT
        p_price_list_id,
        (item->>'product_id')::uuid,
        NULL,
        (item->>'multiplier')::numeric
      FROM jsonb_array_elements(p_overrides_upsert) AS item
      WHERE item->>'product_id' IS NOT NULL
        AND item->>'multiplier' IS NOT NULL
      ON CONFLICT (price_list_id, product_id) DO UPDATE
        SET multiplier = EXCLUDED.multiplier
      RETURNING id, price_list_id, product_id, brand_id, multiplier
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(ups.*)), '[]'::jsonb) INTO v_upserted FROM ups;
  ELSE
    v_upserted := '[]'::jsonb;
  END IF;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_updated', 'price_list', p_price_list_id, btrim(p_name),
    v_old_data,
    jsonb_build_object(
      'list', v_new_data,
      'overrides_upserted', COALESCE(v_upserted, '[]'::jsonb),
      'overrides_deleted',  COALESCE(to_jsonb(v_deleted), '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'upserted_overrides', COALESCE(v_upserted, '[]'::jsonb),
    'deleted_ids', COALESCE(to_jsonb(v_deleted), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_price_list(
  p_operator_id   uuid,
  p_business_id   uuid,
  p_price_list_id uuid
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
  v_is_default         boolean;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'price_lists_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de listas de precios insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(pl.*), pl.name, pl.is_default
    INTO v_old_data, v_old_name, v_is_default
  FROM price_lists pl
  WHERE pl.id = p_price_list_id AND pl.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lista de precios no encontrada');
  END IF;

  IF v_is_default THEN
    RETURN jsonb_build_object('success', false, 'error', 'No se puede eliminar la lista predeterminada. Definí otra lista como predeterminada primero.');
  END IF;

  DELETE FROM price_lists
  WHERE id = p_price_list_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_deleted', 'price_list', p_price_list_id, v_old_name,
    v_old_data, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

DROP FUNCTION IF EXISTS public.swap_default_price_list(uuid, uuid);

CREATE OR REPLACE FUNCTION public.swap_default_price_list(
  p_operator_id   uuid,
  p_business_id   uuid,
  p_price_list_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_default_id     uuid;
  v_new_name           text;
BEGIN
  IF p_operator_id IS NULL THEN
    RAISE EXCEPTION '403: Sesión de operador no encontrada';
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  SELECT permissions->>'price_lists_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RAISE EXCEPTION '403: Permisos de listas de precios insuficientes';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RAISE EXCEPTION '403: Sesión inválida';
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT id INTO v_old_default_id
  FROM price_lists
  WHERE business_id = p_business_id AND is_default = true
  LIMIT 1;

  SELECT name INTO v_new_name
  FROM price_lists
  WHERE id = p_price_list_id AND business_id = p_business_id;

  UPDATE price_lists SET is_default = false
  WHERE business_id = p_business_id AND is_default = true;

  UPDATE price_lists SET is_default = true
  WHERE id = p_price_list_id AND business_id = p_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_default_changed', 'price_list', p_price_list_id, v_new_name,
    jsonb_build_object('previous_default_id', v_old_default_id),
    jsonb_build_object('new_default_id', p_price_list_id)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.swap_default_price_list(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.swap_default_price_list(uuid, uuid, uuid) TO authenticated;
