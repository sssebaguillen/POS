-- P7h Phase 2 pre-work: wrap price_lists + price_list_overrides write paths in
-- SECURITY DEFINER RPCs. Required before audit log instrumentation. Permission
-- gate: price_lists_write (operator) or profile fallback (owner).

-- =============================================================================
-- create_price_list
-- =============================================================================
-- p_overrides shape: optional jsonb array of { product_id: uuid, multiplier: numeric }
-- Inserts the new list and (optionally) per-product overrides atomically.
-- Returns { success, list, overrides? } where list is the inserted row and
-- overrides contains the inserted override rows (with their server ids).
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

  SELECT permissions->>'price_lists_write' INTO v_perm
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
  END IF;

  -- Setting is_default = true on a new list must clear any other default for
  -- this business to satisfy the unique partial index.
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

  RETURN jsonb_build_object('success', true, 'list', v_list, 'overrides', v_overrides);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_price_list(uuid, uuid, text, text, numeric, boolean, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_price_list(uuid, uuid, text, text, numeric, boolean, jsonb) TO authenticated;


-- =============================================================================
-- update_price_list
-- =============================================================================
-- Mirrors the two-step write the edit modal used to do directly:
--   1. UPDATE price_lists row (name, description, multiplier)
--   2. UPSERT/DELETE price_list_overrides as instructed by client
--
-- p_overrides_upsert: jsonb array of { product_id, multiplier }. Each entry is
--   upserted on (price_list_id, product_id) so manual price preservation works.
-- p_overrides_delete_ids: array of override ids to remove (used when the
--   client switches from "respect manual" back to "overwrite all").
--
-- Returns { success, upserted_overrides[], deleted_ids[] }.
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

  SELECT permissions->>'price_lists_write' INTO v_perm
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM price_lists WHERE id = p_price_list_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lista de precios no encontrada');
  END IF;

  UPDATE price_lists SET
    name        = btrim(p_name),
    description = NULLIF(btrim(p_description), ''),
    multiplier  = p_multiplier
  WHERE id = p_price_list_id AND business_id = v_caller_business_id;

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

  RETURN jsonb_build_object(
    'success', true,
    'upserted_overrides', COALESCE(v_upserted, '[]'::jsonb),
    'deleted_ids', COALESCE(to_jsonb(v_deleted), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_price_list(uuid, uuid, uuid, text, text, numeric, jsonb, uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_price_list(uuid, uuid, uuid, text, text, numeric, jsonb, uuid[]) TO authenticated;


-- =============================================================================
-- delete_price_list
-- =============================================================================
-- Rejects deletion of the default list — caller must swap default first via
-- swap_default_price_list. price_list_overrides cascade via FK.
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
  v_is_default         boolean;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'price_lists_write' INTO v_perm
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
  END IF;

  SELECT is_default INTO v_is_default
  FROM price_lists
  WHERE id = p_price_list_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lista de precios no encontrada');
  END IF;

  IF v_is_default THEN
    RETURN jsonb_build_object('success', false, 'error', 'No se puede eliminar la lista predeterminada. Definí otra lista como predeterminada primero.');
  END IF;

  DELETE FROM price_lists
  WHERE id = p_price_list_id AND business_id = v_caller_business_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_price_list(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_price_list(uuid, uuid, uuid) TO authenticated;
