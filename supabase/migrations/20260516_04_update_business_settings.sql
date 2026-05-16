-- P7h Phase 2 pre-work: wrap business settings write path in a SECURITY DEFINER
-- RPC. Slug edits still go through update_business_slug (unchanged).
--
-- p_settings_patch is **spread-merged** into businesses.settings rather than
-- replacing it, so callers only need to send the keys they want to change.
-- Permission gate: operators.permissions->>'settings' = 'true' or profile
-- fallback (owner).
CREATE OR REPLACE FUNCTION public.update_business_settings(
  p_operator_id    uuid,
  p_business_id    uuid,
  p_name           text,
  p_description    text  DEFAULT NULL,
  p_whatsapp       text  DEFAULT NULL,
  p_logo_url       text  DEFAULT NULL,
  p_settings_patch jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
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

  SELECT permissions->>'settings' INTO v_perm
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de configuración insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
  END IF;

  UPDATE businesses SET
    name        = btrim(p_name),
    description = NULLIF(btrim(p_description), ''),
    whatsapp    = NULLIF(btrim(p_whatsapp), ''),
    logo_url    = NULLIF(btrim(p_logo_url), ''),
    settings    = CASE
      WHEN p_settings_patch IS NULL OR jsonb_typeof(p_settings_patch) <> 'object' THEN settings
      ELSE COALESCE(settings, '{}'::jsonb) || p_settings_patch
    END
  WHERE id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Negocio no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_business_settings(uuid, uuid, text, text, text, text, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_business_settings(uuid, uuid, text, text, text, text, jsonb) TO authenticated;
