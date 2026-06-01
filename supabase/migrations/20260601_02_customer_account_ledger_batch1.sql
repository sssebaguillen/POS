-- =============================================================
-- Customer Account Ledger — Batch 1 (additive, no behavior change)
-- 2026-06-01. Design: docs/todo/customer-account-ledger.md
--
-- Adds an append-only ledger for cuenta corriente and dual-writes to it from
-- the two functions that move credit_balance (create_sale_transaction = fiar,
-- settle_customer_credit = cobro). Existing behavior is untouched: the
-- payments(sale_id=NULL) settlement insert is kept for now (Batch 2 removes it).
-- Nothing reads the ledger yet, so nothing can break.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Table + RLS + indexes
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_account_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id)  ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('charge','payment','opening')),
  amount        numeric NOT NULL CHECK (amount > 0),
  method        text CHECK (method IN ('cash','card','transfer')),
  sale_id       uuid REFERENCES public.sales(id)     ON DELETE SET NULL,
  operator_id   uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  balance_after numeric NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_account_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON public.customer_account_movements
  FOR ALL USING (business_id = (select get_business_id()));

CREATE INDEX IF NOT EXISTS idx_cam_business_customer_created
  ON public.customer_account_movements (business_id, customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cam_sale_id
  ON public.customer_account_movements (sale_id);
CREATE INDEX IF NOT EXISTS idx_cam_operator_id
  ON public.customer_account_movements (operator_id);

-- -------------------------------------------------------------
-- 2. create_sale_transaction — dual-write a 'charge' on credit sales
--    (only the credit branch changes; rest is verbatim)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_sale_transaction(p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric, p_status text, p_price_list_id uuid, p_operator_id uuid, p_items jsonb, p_payments jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
  v_balance_after      numeric;
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

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric;
    IF (v_payment->>'method') = 'credit' THEN
      v_credit_total := v_credit_total + (v_payment->>'amount')::numeric;
    END IF;
  END LOOP;
  IF v_payments_total < p_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'El monto de los pagos no cubre el total de la venta');
  END IF;

  SELECT role, permissions INTO v_actor_role, v_actor_permissions
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
    v_actor_permissions := NULL;
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

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
    PERFORM 1 FROM customers
    WHERE id = p_customer_id AND business_id = v_caller_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio');
    END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM cash_sessions
    WHERE id = p_session_id AND business_id = v_caller_business_id AND status = 'open';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Sesión de caja no válida');
    END IF;
  END IF;

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

  IF v_credit_total > 0 THEN
    UPDATE customers
    SET credit_balance = COALESCE(credit_balance, 0) + v_credit_total
    WHERE id = p_customer_id
    RETURNING credit_balance INTO v_balance_after;

    INSERT INTO customer_account_movements
      (business_id, customer_id, type, amount, sale_id, operator_id, balance_after)
    VALUES
      (p_business_id, p_customer_id, 'charge', v_credit_total, v_sale_id, v_stored_op_id, v_balance_after);
  END IF;

  SELECT jsonb_build_object(
    'total', s.total, 'subtotal', s.subtotal, 'discount', s.discount, 'status', s.status, 'customer_id', s.customer_id,
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

-- -------------------------------------------------------------
-- 3. settle_customer_credit — dual-write a 'payment' movement
--    (keeps the existing payments(sale_id=NULL) insert; Batch 2 removes it)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_customer_credit(p_customer_id uuid, p_amount numeric, p_method text, p_operator_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id  uuid;
  v_customer     record;
  v_actor_role   text;
  v_prev_balance numeric;
  v_next_balance numeric;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de negocio invalido';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monto invalido';
  END IF;

  IF p_method NOT IN ('cash', 'card', 'transfer') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id AND business_id = v_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_prev_balance := COALESCE(v_customer.credit_balance, 0);
  IF p_amount > v_prev_balance THEN
    RAISE EXCEPTION 'El monto supera la deuda actual del cliente';
  END IF;

  INSERT INTO payments (sale_id, method, amount, status)
  VALUES (NULL, p_method, p_amount, 'completed');

  UPDATE customers
  SET credit_balance = v_prev_balance - p_amount
  WHERE id = p_customer_id;

  v_next_balance := v_prev_balance - p_amount;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  INSERT INTO customer_account_movements
    (business_id, customer_id, type, amount, method, operator_id, balance_after)
  VALUES
    (v_business_id, p_customer_id, 'payment', p_amount, p_method,
     CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END, v_next_balance);

  PERFORM log_audit_event(
    v_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_credit_settled', 'customer', p_customer_id, v_customer.name,
    jsonb_build_object('credit_balance', v_prev_balance),
    jsonb_build_object(
      'credit_balance', v_next_balance,
      'amount',         p_amount,
      'method',         p_method
    )
  );

  RETURN v_next_balance;
END;
$function$;
