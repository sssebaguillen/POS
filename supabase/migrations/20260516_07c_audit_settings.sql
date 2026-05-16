-- P7h Phase 2: instrument settings RPCs with log_audit_event.

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

  SELECT permissions->>'settings', role INTO v_perm, v_actor_role
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
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'name',        b.name,
    'description', b.description,
    'whatsapp',    b.whatsapp,
    'logo_url',    b.logo_url,
    'settings',    b.settings
  ) INTO v_old_data
  FROM businesses b
  WHERE b.id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Negocio no encontrado');
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
  WHERE id = v_caller_business_id
  RETURNING jsonb_build_object(
    'name',        name,
    'description', description,
    'whatsapp',    whatsapp,
    'logo_url',    logo_url,
    'settings',    settings
  ) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'settings_updated', 'setting', p_business_id, btrim(p_name),
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

DROP FUNCTION IF EXISTS public.update_business_slug(text);

CREATE OR REPLACE FUNCTION public.update_business_slug(
  p_operator_id uuid,
  p_business_id uuid,
  p_slug        text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_slug           text;
BEGIN
  IF p_operator_id IS NULL THEN
    RAISE EXCEPTION '403: Sesión de operador no encontrada';
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Formato inválido. Solo letras minúsculas, números y guiones. Mínimo 3 caracteres.';
  END IF;

  SELECT permissions->>'settings', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RAISE EXCEPTION '403: Permisos de configuración insuficientes';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RAISE EXCEPTION '403: Sesión inválida';
    END IF;
    v_actor_role := 'owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM businesses
    WHERE slug = p_slug AND id <> v_caller_business_id
  ) THEN
    RAISE EXCEPTION 'Ese nombre ya está en uso por otro negocio.';
  END IF;

  SELECT slug INTO v_old_slug
  FROM businesses
  WHERE id = v_caller_business_id;

  UPDATE businesses
  SET slug = p_slug
  WHERE id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'settings_slug_updated', 'setting', p_business_id, p_slug,
    jsonb_build_object('slug', v_old_slug),
    jsonb_build_object('slug', p_slug)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_business_slug(uuid, uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_business_slug(uuid, uuid, text) TO authenticated;
