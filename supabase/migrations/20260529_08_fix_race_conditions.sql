-- 20260529_08_fix_race_conditions.sql
-- Cierra tres race conditions tipo check-then-act (frente sección 5 del doc 08).
-- El descuento de stock (UPDATE stock = stock - qty toma lock de fila), el crédito de cliente
-- (FOR UPDATE sobre customers) y la numeración de ventas (UUID) ya eran seguros.
--
-- 1) update_catalog_order_status: el SELECT del pedido no tomaba lock. Dos "completar"
--    concurrentes sobre el mismo pedido creaban DOS ventas (doble descuento de stock + doble
--    ingreso). Fix: SELECT ... FOR UPDATE -> la 2da llamada espera, re-lee status='completado'
--    y cae en transición inválida (no crea otra venta).
-- 2) open_cash_session: IF EXISTS + INSERT sin unicidad a nivel DB -> dos aperturas concurrentes
--    creaban dos sesiones abiertas. Fix: índice ÚNICO parcial (business_id) WHERE status='open'
--    + capturar unique_violation con el mensaje amigable. (El EXISTS queda como fast-path.)
-- 3) close_cash_session: SELECT sin lock + UPDATE sin guard de status -> doble cierre sobrescribía.
--    Fix: SELECT ... FOR UPDATE.

-- 1) Invariante DB: una sola sesión de caja abierta por negocio.
DROP INDEX IF EXISTS public.idx_cash_sessions_business_status_open;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_one_open_per_business
  ON public.cash_sessions (business_id) WHERE status = 'open';

-- 2) update_catalog_order_status: lock de la fila del pedido (anti doble-venta).
CREATE OR REPLACE FUNCTION public.update_catalog_order_status(p_operator_id uuid, p_order_id uuid, p_new_status text, p_blacklist boolean DEFAULT false)
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
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', ci.product_id, 'variant_id', ci.variant_id,
      'quantity', ci.quantity, 'unit_price', ci.unit_price, 'total', ci.line_total
    )), '[]'::jsonb) INTO v_sale_items
     FROM catalog_order_items ci WHERE ci.order_id = p_order_id;

    v_sale_payments := jsonb_build_array(jsonb_build_object('method', 'other', 'amount', v_order.total));

    SELECT public.create_sale_transaction(
      v_business_id, v_order.subtotal, 0::numeric, v_order.total,
      'completed', NULL, v_actor_op_id, v_sale_items, v_sale_payments
    ) INTO v_sale_result;

    IF NOT COALESCE((v_sale_result->>'success')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_sale_result->>'error', 'sale_creation_failed'));
    END IF;
    v_sale_id := (v_sale_result->>'sale_id')::uuid;
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

-- 3) open_cash_session: capturar unique_violation del índice parcial.
CREATE OR REPLACE FUNCTION public.open_cash_session(p_opening_amount numeric, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id uuid;
  v_row         cash_sessions;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  -- Fast-path: una sola sesión abierta por negocio (el índice único parcial es el backstop real).
  IF EXISTS (
    SELECT 1 FROM cash_sessions
    WHERE business_id = v_business_id AND status = 'open'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ya existe una sesión de caja abierta');
  END IF;

  INSERT INTO cash_sessions (business_id, opening_amount, opened_by, opened_at, status)
  VALUES (v_business_id, p_opening_amount, p_operator_id, now(), 'open')
  RETURNING * INTO v_row;

  PERFORM log_audit_event(
    v_business_id,
    p_operator_id,
    CASE WHEN p_operator_id IS NULL THEN 'owner' ELSE 'operator' END,
    'cash_session_opened',
    'cash_session',
    v_row.id,
    NULL,
    jsonb_build_object('opening_amount', p_opening_amount, 'opened_by', p_operator_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'session', row_to_json(v_row)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ya existe una sesión de caja abierta');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- 4) close_cash_session: lock de la fila (anti doble cierre).
CREATE OR REPLACE FUNCTION public.close_cash_session(p_session_id uuid, p_closing_amount numeric, p_notes text, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id    uuid;
  v_cash_sales     numeric;
  v_expected       numeric;
  v_difference     numeric;
  v_row            cash_sessions;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  -- FOR UPDATE: serializa cierres concurrentes de la misma sesión.
  SELECT * INTO v_row
  FROM cash_sessions
  WHERE id = p_session_id AND business_id = v_business_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesión no encontrada o ya cerrada');
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_cash_sales
  FROM payments p
  JOIN sales s ON s.id = p.sale_id
  WHERE s.session_id = p_session_id
    AND s.business_id = v_business_id
    AND p.method = 'cash';

  v_expected   := v_row.opening_amount + v_cash_sales;
  v_difference := p_closing_amount - v_expected;

  UPDATE cash_sessions SET
    status          = 'closed',
    closing_amount  = p_closing_amount,
    expected_amount = v_expected,
    closed_at       = now(),
    closed_by       = p_operator_id,
    notes           = p_notes
  WHERE id = p_session_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(
    v_business_id,
    p_operator_id,
    CASE WHEN p_operator_id IS NULL THEN 'owner' ELSE 'operator' END,
    'cash_session_closed',
    'cash_session',
    p_session_id,
    NULL,
    jsonb_build_object(
      'closing_amount',  p_closing_amount,
      'expected_amount', v_expected,
      'difference',      v_difference,
      'notes',           p_notes
    )
  );

  RETURN jsonb_build_object(
    'success',          true,
    'session',          row_to_json(v_row),
    'cash_sales',       v_cash_sales,
    'expected_amount',  v_expected,
    'difference',       v_difference
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
