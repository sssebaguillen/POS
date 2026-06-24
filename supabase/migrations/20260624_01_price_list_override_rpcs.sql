-- ============================================================
-- RPCs guardadas para price_list_overrides (audit + guard + tenant scope)
-- ============================================================
-- Hasta ahora los overrides de listas de precios se mutaban con
-- .insert/upsert/delete DIRECTO desde el cliente (RLS-only) en 3 call sites
-- (ProductOverrideModal, BrandOverrideModal, EditProductModal): sin audit log,
-- sin guard de permiso en la operación, y los delete de EditProductModal sin
-- scope de negocio. Rompe reglas 31/32/34 (toda mutación de negocio se audita
-- y pasa por un guard SECURITY DEFINER).
--
-- price_list_overrides NO tiene business_id: el aislamiento de tenant se logra
-- validando que la lista (o el override) pertenezca a p_business_id vía la FK a
-- price_lists.business_id.
--
-- Permiso: inventory_write — el mismo que ya usan create_price_list /
-- update_price_list para mutar listas de precios (/price-lists se gatea por
-- inventory_read en proxy.ts, pero la escritura exige inventory_write; leído vía
-- normalize_permissions(permissions)->>'inventory_write', regla 16).
--
-- Regla 34: validación de tenant + REVOKE PUBLIC/anon + GRANT authenticated.

-- audit_log.entity_type sólo aceptaba un set cerrado de tipos → sumar
-- 'price_list_override' para poder auditar estas mutaciones (regla 31).
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_type_check CHECK (
  entity_type = ANY (ARRAY[
    'sale'::text, 'product'::text, 'category'::text, 'brand'::text,
    'expense'::text, 'supplier'::text, 'price_list'::text, 'setting'::text,
    'operator'::text, 'customer'::text, 'catalog_order'::text, 'promotion'::text,
    'price_list_override'::text
  ])
);

-- upsert_price_list_override: crea o actualiza un override de producto O de marca.
-- Keyed por (price_list_id, product_id) o (price_list_id, brand_id) según cuál
-- venga no-nulo (la CHECK override_target exige exactamente uno).
CREATE OR REPLACE FUNCTION public.upsert_price_list_override(
  p_operator_id uuid,
  p_business_id uuid,
  p_price_list_id uuid,
  p_product_id uuid,
  p_brand_id uuid,
  p_multiplier numeric
)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_list_business_id   uuid;
  v_perm               text;
  v_actor_role         text;
  v_old                jsonb;
  v_row                jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  -- exactamente uno de producto/marca (espejo de la CHECK override_target)
  IF (p_product_id IS NULL) = (p_brand_id IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Indica un producto o una marca (no ambos)');
  END IF;

  IF p_multiplier IS NULL OR p_multiplier <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El margen debe ser mayor a 0');
  END IF;

  -- la lista debe pertenecer al negocio del llamador
  SELECT business_id INTO v_list_business_id
  FROM price_lists WHERE id = p_price_list_id;
  IF v_list_business_id IS NULL OR v_list_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lista de precios no encontrada');
  END IF;

  -- guard de permiso (inventory_write); owner identificado por profiles
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
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

  IF p_product_id IS NOT NULL THEN
    SELECT to_jsonb(plo.*) INTO v_old
    FROM price_list_overrides plo
    WHERE plo.price_list_id = p_price_list_id AND plo.product_id = p_product_id;

    INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
    VALUES (p_price_list_id, p_product_id, NULL, p_multiplier)
    ON CONFLICT (price_list_id, product_id) DO UPDATE SET multiplier = EXCLUDED.multiplier
    RETURNING jsonb_build_object(
      'id', id, 'price_list_id', price_list_id, 'product_id', product_id,
      'brand_id', brand_id, 'multiplier', multiplier
    ) INTO v_row;
  ELSE
    SELECT to_jsonb(plo.*) INTO v_old
    FROM price_list_overrides plo
    WHERE plo.price_list_id = p_price_list_id AND plo.brand_id = p_brand_id;

    INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
    VALUES (p_price_list_id, NULL, p_brand_id, p_multiplier)
    ON CONFLICT (price_list_id, brand_id) DO UPDATE SET multiplier = EXCLUDED.multiplier
    RETURNING jsonb_build_object(
      'id', id, 'price_list_id', price_list_id, 'product_id', product_id,
      'brand_id', brand_id, 'multiplier', multiplier
    ) INTO v_row;
  END IF;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    CASE WHEN v_old IS NULL THEN 'price_list_override_created' ELSE 'price_list_override_updated' END,
    'price_list_override',
    (v_row->>'id')::uuid,
    NULL,
    v_old,
    v_row
  );

  RETURN jsonb_build_object('success', true, 'override', v_row);
END;
$$;

ALTER FUNCTION public.upsert_price_list_override(uuid, uuid, uuid, uuid, uuid, numeric) OWNER TO postgres;

-- delete_price_list_override: borra un override por id, scopeado al negocio vía
-- la lista. Idempotente: si no existe (o es de otro negocio) devuelve success.
CREATE OR REPLACE FUNCTION public.delete_price_list_override(
  p_operator_id uuid,
  p_business_id uuid,
  p_override_id uuid
)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old                jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
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

  -- borra sólo si el override pertenece a una lista de este negocio
  DELETE FROM price_list_overrides plo
  USING price_lists pl
  WHERE plo.id = p_override_id
    AND plo.price_list_id = pl.id
    AND pl.business_id = v_caller_business_id
  RETURNING jsonb_build_object(
    'id', plo.id, 'price_list_id', plo.price_list_id, 'product_id', plo.product_id,
    'brand_id', plo.brand_id, 'multiplier', plo.multiplier
  ) INTO v_old;

  IF v_old IS NULL THEN
    -- idempotente: ya no existe (o es de otro negocio) → nada que auditar
    RETURN jsonb_build_object('success', true, 'override', NULL);
  END IF;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_override_deleted',
    'price_list_override',
    (v_old->>'id')::uuid,
    NULL,
    v_old,
    NULL
  );

  RETURN jsonb_build_object('success', true, 'override', v_old);
END;
$$;

ALTER FUNCTION public.delete_price_list_override(uuid, uuid, uuid) OWNER TO postgres;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.upsert_price_list_override(uuid, uuid, uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_price_list_override(uuid, uuid, uuid, uuid, uuid, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_price_list_override(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_price_list_override(uuid, uuid, uuid) TO authenticated, service_role;
