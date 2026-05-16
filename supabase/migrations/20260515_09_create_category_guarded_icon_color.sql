-- P7h Phase 1 follow-up: add p_icon_color to create_category_guarded so the
-- color is persisted atomically with the row (closes the scope cut where the
-- client did a follow-up .update({ icon_color }) after the RPC). Signature
-- change -> DROP + CREATE.

DROP FUNCTION IF EXISTS public.create_category_guarded(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_category_guarded(
  p_operator_id uuid,
  p_business_id uuid,
  p_name        text,
  p_icon        text,
  p_icon_color  text DEFAULT NULL
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
  v_icon_color         text;
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

  INSERT INTO categories (business_id, name, icon, icon_color, is_active)
  VALUES (v_caller_business_id, btrim(p_name), btrim(p_icon), p_icon_color, true)
  RETURNING id, icon_color INTO v_new_id, v_icon_color;

  PERFORM log_audit_event(
    p_business_id, p_operator_id, v_actor_role,
    'category_created', 'category', v_new_id, btrim(p_name),
    NULL,
    jsonb_build_object('name', btrim(p_name), 'icon', btrim(p_icon), 'icon_color', v_icon_color)
  );

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_category_guarded(uuid, uuid, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_category_guarded(uuid, uuid, text, text, text) TO authenticated;
