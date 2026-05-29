-- bulk_set_product_status: contar solo las filas que realmente cambiaron de estado.
-- Antes el UPDATE tocaba todas las seleccionadas y ROW_COUNT devolvía el total,
-- así que el toast decía "N productos" aunque solo cambiara un subconjunto.
-- Filtramos por is_active IS DISTINCT FROM p_is_active para que v_count refleje el delta real.

CREATE OR REPLACE FUNCTION public.bulk_set_product_status(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_is_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid; v_count int;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT permissions->>'stock_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  UPDATE products SET is_active = p_is_active
  WHERE id = ANY(p_product_ids) AND business_id = p_business_id
    AND is_active IS DISTINCT FROM p_is_active;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_status', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(p_product_ids), 'count', v_count),
    jsonb_build_object('is_active', p_is_active));
  RETURN jsonb_build_object('updated', v_count);
END;
$function$;
