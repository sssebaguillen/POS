-- 20260529_09_catalog_order_payment_method_and_sale_source.sql
-- Dos cambios al convertir un pedido del catálogo en venta:
--   1) Método de pago real: la conversión usaba el método 'other', que NO está en
--      payments_method_check (cash/card/transfer/mercadopago/credit) -> completar un pedido
--      fallaba siempre (0 completados en la historia). Ahora update_catalog_order_status recibe
--      p_payment_method y registra la venta con el método real que elige el operador
--      (cash/card/transfer/mercadopago). Se excluye 'credit' (cuenta corriente requiere cliente
--      registrado; el pedido online es anónimo).
--   2) Distintivo de origen: sales.source ('pos' | 'catalog', default 'pos') -> la venta convertida
--      desde un pedido online queda marcada 'catalog'. Atributo de primera clase para reportes
--      (hoy la distinción solo existía indirecta vía catalog_orders.sale_id).
-- Se mantiene el FOR UPDATE sobre la fila del pedido (fix de race de doble-completar, mig 08).

-- 1) Distintivo de origen de venta.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pos'
  CHECK (source IN ('pos', 'catalog'));

-- 2) Recrear update_catalog_order_status con p_payment_method (cambia la firma -> DROP + CREATE).
DROP FUNCTION IF EXISTS public.update_catalog_order_status(uuid, uuid, text, boolean);

CREATE FUNCTION public.update_catalog_order_status(p_operator_id uuid, p_order_id uuid, p_new_status text, p_blacklist boolean DEFAULT false, p_payment_method text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id uuid; v_sales_perm text; v_actor_role text; v_actor_op_id uuid;
  v_order record; v_valid boolean := false;
  v_sale_items jsonb := '[]'::jsonb; v_sale_payments jsonb; v_sale_result jsonb;
  v_sale_id uuid; v_old_data jsonb; v_new_data jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthorized'); END IF;

  SELECT permissions->>'sales', role INTO v_sales_perm, v_actor_role
   FROM operators WHERE id = p_operator_id AND business_id = v_business_id AND is_active = true;
  IF FOUND THEN
    IF v_sales_perm <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de ventas insuficientes'); END IF;
    v_actor_op_id := p_operator_id;
  ELSE
    IF p_operator_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner'; v_actor_op_id := NULL;
  END IF;

  -- FOR UPDATE: serializa transiciones concurrentes del mismo pedido (evita doble conversión a venta).
  SELECT * INTO v_order FROM catalog_orders WHERE id = p_order_id AND business_id = v_business_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  IF v_order.status = 'recibido' AND p_new_status IN ('aceptado','rechazado','cancelado') THEN v_valid := true;
  ELSIF v_order.status = 'aceptado' AND (
      (p_new_status = 'en_camino' AND v_order.delivery_type = 'delivery') OR
      (p_new_status = 'listo_retiro' AND v_order.delivery_type = 'takeaway') OR
      p_new_status = 'cancelado'
  ) THEN v_valid := true;
  ELSIF v_order.status IN ('en_camino','listo_retiro') AND p_new_status IN ('completado','cancelado') THEN v_valid := true;
  END IF;
  IF NOT v_valid THEN
    RETURN jsonb_build_object('success', false, 'error', format('invalid_transition: %s -> %s', v_order.status, p_new_status));
  END IF;

  v_old_data := to_jsonb(v_order);

  IF p_new_status = 'completado' THEN
    -- Método de pago real (lo elige el operador al completar). 'credit' no aplica a pedidos anónimos.
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card','transfer','mercadopago') THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_payment_method');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', ci.product_id, 'variant_id', ci.variant_id,
      'quantity', ci.quantity, 'unit_price', ci.unit_price, 'total', ci.line_total
    )), '[]'::jsonb) INTO v_sale_items
     FROM catalog_order_items ci WHERE ci.order_id = p_order_id;

    v_sale_payments := jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', v_order.total));

    SELECT public.create_sale_transaction(
      v_business_id, v_order.subtotal, 0::numeric, v_order.total,
      'completed', NULL, v_actor_op_id, v_sale_items, v_sale_payments
    ) INTO v_sale_result;

    IF NOT COALESCE((v_sale_result->>'success')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_sale_result->>'error', 'sale_creation_failed'));
    END IF;
    v_sale_id := (v_sale_result->>'sale_id')::uuid;

    -- Marcar la venta como originada en el catálogo (distintivo POS vs online).
    UPDATE sales SET source = 'catalog' WHERE id = v_sale_id;
  END IF;

  UPDATE catalog_orders SET
    status = p_new_status, updated_at = now(),
    accepted_at  = CASE WHEN p_new_status = 'aceptado'   AND accepted_at  IS NULL THEN now() ELSE accepted_at  END,
    completed_at = CASE WHEN p_new_status = 'completado' AND completed_at IS NULL THEN now() ELSE completed_at END,
    rejected_at  = CASE WHEN p_new_status = 'rechazado'  AND rejected_at  IS NULL THEN now() ELSE rejected_at  END,
    cancelled_at = CASE WHEN p_new_status = 'cancelado'  AND cancelled_at IS NULL THEN now() ELSE cancelled_at END,
    sale_id      = COALESCE(v_sale_id, sale_id)
  WHERE id = p_order_id;

  IF p_new_status = 'rechazado' AND p_blacklist = true THEN
    INSERT INTO catalog_phone_blacklist (business_id, phone, reason)
    VALUES (v_business_id, v_order.customer_phone, 'rechazado desde pedido #' || v_order.order_number)
    ON CONFLICT (business_id, phone) DO NOTHING;
  END IF;

  SELECT to_jsonb(o.*) INTO v_new_data FROM catalog_orders o WHERE o.id = p_order_id;

  PERFORM log_audit_event(
    v_business_id, v_actor_op_id, v_actor_role,
    'catalog_order_' || p_new_status, 'catalog_order', p_order_id,
    'Pedido #' || v_order.order_number, v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'status', p_new_status);
END; $function$;

-- Restablecer grants (DROP los elimina; debe quedar authenticated-only como antes).
REVOKE EXECUTE ON FUNCTION public.update_catalog_order_status(uuid, uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_catalog_order_status(uuid, uuid, text, boolean, text) TO authenticated;
