-- bulk_set_product_catalog: alta/baja masiva de productos en el catálogo online.
-- Espeja a bulk_set_product_status (mismo guard de tenant, permiso stock_write,
-- snapshot de nombres en el audit y conteo de delta real vía IS DISTINCT FROM).
-- show_in_catalog es nullable (default true): IS DISTINCT FROM trata NULL como cambio.

CREATE OR REPLACE FUNCTION public.bulk_set_product_catalog(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_show_in_catalog boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
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
  WITH updated AS (
    UPDATE products SET show_in_catalog = p_show_in_catalog
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
      AND show_in_catalog IS DISTINCT FROM p_show_in_catalog
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_catalog', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('show_in_catalog', p_show_in_catalog));
  RETURN jsonb_build_object('updated', v_count);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bulk_set_product_catalog(uuid, uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_set_product_catalog(uuid, uuid, uuid[], boolean) TO authenticated;
