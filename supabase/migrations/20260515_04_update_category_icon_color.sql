-- Patch update_category to accept icon_color.
-- The argument list changes (adds p_icon_color), so we DROP + CREATE
-- rather than CREATE OR REPLACE (which would create an overload).
-- This removes the need for the client-side direct .update({icon_color})
-- call in CategoryModal.handleUpdate.

DROP FUNCTION IF EXISTS public.update_category(uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.update_category(
  p_operator_id uuid,
  p_business_id uuid,
  p_category_id uuid,
  p_name text,
  p_icon text,
  p_icon_color text
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

  IF p_name IS NULL OR btrim(p_name) = '' THEN
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

  UPDATE categories
  SET name = btrim(p_name),
      icon = btrim(p_icon),
      icon_color = p_icon_color
  WHERE id = p_category_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_category(uuid, uuid, uuid, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_category(uuid, uuid, uuid, text, text, text) TO authenticated;
