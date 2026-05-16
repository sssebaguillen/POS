-- P7h Phase 2 pre-work: delete_operator RPC (replaces direct
-- .from('operators').delete() in OperatorList). Hard delete preserves the
-- existing client behaviour (optimistic UI with 6s undo window).
--
-- Permission gate: operators_write (or profile fallback for owner).
-- Self-delete is rejected to prevent an operator from locking themselves out.
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

  SELECT permissions->>'operators_write' INTO v_perm
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
  END IF;

  DELETE FROM operators
  WHERE id = p_target_operator_id AND business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_operator(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_operator(uuid, uuid, uuid) TO authenticated;
