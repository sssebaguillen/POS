-- ============================================================
-- create_sale_transaction — defense-in-depth + atomicity hardening
--
-- 1. Validate `price_override` permission server-side. Until now the
--    permission was only enforced in the client (CartPanel), so a crafted
--    RPC call could persist a sale at a manipulated price.
--
-- 2. Make the customer credit-balance update atomic with the sale insert.
--    Previously the balance was bumped by a separate `apply_customer_credit`
--    RPC call from the client — a network failure between the two could
--    leave a sale with a credit payment recorded but the customer's running
--    balance not updated, so the system would not know the customer owed
--    money. The new flow validates eligibility, locks the customer row, and
--    bumps the balance in the same transaction.
--
-- The remote DB carries two overloads of create_sale_transaction (the 10-arg
-- one without p_session_id is dead — no caller sends 10 args). Both are
-- dropped first to leave a single canonical signature.
-- apply_customer_credit is no longer referenced by the codebase and is
-- dropped at the end of this migration.
-- ============================================================

DROP FUNCTION IF EXISTS public.create_sale_transaction(
  uuid, numeric, numeric, numeric, text, uuid, uuid, jsonb, jsonb, uuid
);
DROP FUNCTION IF EXISTS public.create_sale_transaction(
  uuid, numeric, numeric, numeric, text, uuid, uuid, jsonb, jsonb, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.create_sale_transaction(
  p_business_id uuid,
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric,
  p_status text,
  p_price_list_id uuid,
  p_operator_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
  v_payment            jsonb;
  v_payments_total     numeric := 0;
  v_credit_total       numeric := 0;
  v_actor_role         text;
  v_actor_permissions  jsonb;
  v_stored_op_id       uuid;
  v_new_data           jsonb;
  v_customer           customers%ROWTYPE;
  v_credit_available   numeric;
  v_has_price_override boolean := false;
BEGIN
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un item');
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un pago');
  END IF;

  -- Sum payment totals and capture the credit portion in a single pass.
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric;
    IF (v_payment->>'method') = 'credit' THEN
      v_credit_total := v_credit_total + (v_payment->>'amount')::numeric;
    END IF;
  END LOOP;
  IF v_payments_total < p_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'El monto de los pagos no cubre el total de la venta');
  END IF;

  -- Resolve actor: owner has no row in operators; sub-operators do.
  SELECT role, permissions INTO v_actor_role, v_actor_permissions
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
    v_actor_permissions := NULL;
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  -- price_override guard: any item with a non-null override requires the
  -- permission. Owner is always allowed.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'unit_price_override') IS NOT NULL THEN
      v_has_price_override := true;
      EXIT;
    END IF;
  END LOOP;
  IF v_has_price_override AND v_actor_role <> 'owner' THEN
    IF v_actor_permissions IS NULL OR (v_actor_permissions->>'price_override') <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permiso de override de precio requerido');
    END IF;
  END IF;

  -- Credit-payment guard: lock customer row, validate eligibility and
  -- available credit BEFORE inserting anything, so a rejection leaves no
  -- partial state.
  IF v_credit_total > 0 THEN
    IF p_customer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Pago con crédito requiere cliente');
    END IF;

    SELECT * INTO v_customer
    FROM customers
    WHERE id = p_customer_id AND business_id = v_caller_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio');
    END IF;

    IF NOT v_customer.is_credit_enabled THEN
      RETURN jsonb_build_object('success', false, 'error', 'El cliente no tiene crédito habilitado');
    END IF;

    v_credit_available := v_customer.credit_limit - COALESCE(v_customer.credit_balance, 0);
    IF v_credit_total > v_credit_available THEN
      RETURN jsonb_build_object('success', false, 'error', 'El monto supera el crédito disponible');
    END IF;
  ELSIF p_customer_id IS NOT NULL THEN
    -- No credit involved, but a customer was supplied: still verify ownership.
    PERFORM 1 FROM customers
    WHERE id = p_customer_id AND business_id = v_caller_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio');
    END IF;
  END IF;

  -- Validate session belongs to this business if provided
  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM cash_sessions
    WHERE id = p_session_id AND business_id = v_caller_business_id AND status = 'open';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Sesión de caja no válida');
    END IF;
  END IF;

  -- All validations passed — persist.
  INSERT INTO sales (business_id, subtotal, discount, total, status, price_list_id, operator_id, customer_id, session_id)
  VALUES (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id, p_customer_id, p_session_id)
  RETURNING id, created_at INTO v_sale_id, v_sale_created_at;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO sale_items (
      sale_id, product_id, variant_id, quantity, unit_price, total,
      unit_price_override, override_reason, free_line_description
    ) VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      (v_item->>'unit_price_override')::numeric,
      v_item->>'override_reason',
      v_item->>'free_line_description'
    );
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO payments (sale_id, method, amount, status)
    VALUES (v_sale_id, v_payment->>'method', (v_payment->>'amount')::numeric, 'completed');
  END LOOP;

  -- Atomic credit-balance bump: same transaction as the sale + payments, so
  -- either everything commits or nothing does.
  IF v_credit_total > 0 THEN
    UPDATE customers
    SET credit_balance = COALESCE(credit_balance, 0) + v_credit_total
    WHERE id = p_customer_id;
  END IF;

  SELECT jsonb_build_object(
    'total', s.total, 'subtotal', s.subtotal, 'status', s.status, 'customer_id', s.customer_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id, 'variant_id', si.variant_id,
        'quantity', si.quantity, 'unit_price', si.unit_price, 'total', si.total) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = v_sale_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = v_sale_id), '[]'::jsonb)
  ) INTO v_new_data FROM sales s WHERE s.id = v_sale_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'sale_created', 'sale', v_sale_id, NULL, NULL, v_new_data);

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'created_at', v_sale_created_at);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- apply_customer_credit was only called from PaymentModal, which now relies
-- on the atomic credit handling inside create_sale_transaction. Drop it so
-- it cannot be reintroduced by accident.
DROP FUNCTION IF EXISTS public.apply_customer_credit(uuid, uuid, numeric);
