-- P8 — Cuenta corriente (credit) infrastructure
-- - customers: credit_limit + is_credit_enabled
-- - payments: allow method='credit' (sale_id already nullable)
-- - create_sale_transaction: accept p_customer_id (optional, DEFAULT NULL)
-- - apply_customer_credit: register a credit payment against an existing sale
-- - settle_customer_credit: pay down a customer's outstanding balance

-- ---------------------------------------------------------------------------
-- 2.1 customers: credit configuration columns
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_limit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_credit_enabled bool NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2.2 payments: sale_id already nullable; expand method CHECK to allow 'credit'
-- ---------------------------------------------------------------------------
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check
  CHECK (method = ANY (ARRAY['cash'::text, 'card'::text, 'transfer'::text, 'mercadopago'::text, 'credit'::text]));

-- ---------------------------------------------------------------------------
-- 2.3 create_sale_transaction — add p_customer_id DEFAULT NULL
-- Adding a new parameter changes the function signature, so we DROP + CREATE.
-- All existing named-argument callers continue to work because the new
-- parameter is optional.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_sale_transaction(uuid, numeric, numeric, numeric, text, uuid, uuid, jsonb, jsonb);

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
  p_customer_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_caller_business_id uuid; v_sale_id uuid; v_sale_created_at timestamptz;
  v_item jsonb; v_payment jsonb; v_payments_total numeric := 0;
  v_actor_role text; v_stored_op_id uuid; v_new_data jsonb;
BEGIN
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido'); END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un item'); END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un pago'); END IF;
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric;
  END LOOP;
  IF v_payments_total < p_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'El monto de los pagos no cubre el total de la venta'); END IF;

  -- Defense-in-depth: if a customer is supplied, it must belong to this business.
  IF p_customer_id IS NOT NULL THEN
    PERFORM 1 FROM customers WHERE id = p_customer_id AND business_id = v_caller_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio'); END IF;
  END IF;

  INSERT INTO sales (business_id, subtotal, discount, total, status, price_list_id, operator_id, customer_id)
  VALUES (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id, p_customer_id)
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

  SELECT role INTO v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN v_actor_role := 'owner'; END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

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

-- ---------------------------------------------------------------------------
-- 2.4 apply_customer_credit — register a credit payment against an existing sale
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_customer_credit(
  p_sale_id uuid,
  p_customer_id uuid,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_business_id uuid;
  v_customer record;
  v_credit_available numeric;
  v_sale_business_id uuid;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de negocio invalido';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monto invalido';
  END IF;

  -- Sale must exist and belong to this business
  SELECT business_id INTO v_sale_business_id FROM sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale_business_id IS DISTINCT FROM v_business_id THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;

  -- Customer must exist and belong to this business
  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id AND business_id = v_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  IF NOT v_customer.is_credit_enabled THEN
    RAISE EXCEPTION 'El cliente no tiene crédito habilitado';
  END IF;

  v_credit_available := v_customer.credit_limit - COALESCE(v_customer.credit_balance, 0);
  IF p_amount > v_credit_available THEN
    RAISE EXCEPTION 'El monto supera el crédito disponible';
  END IF;

  -- NOTE: the payments row with method='credit' is inserted by
  -- create_sale_transaction (via p_payments). This function only updates the
  -- customer's running credit_balance — inserting a payment here would dupe.
  UPDATE customers
  SET credit_balance = COALESCE(credit_balance, 0) + p_amount
  WHERE id = p_customer_id;

  RETURN (SELECT credit_balance FROM customers WHERE id = p_customer_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_customer_credit(uuid, uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2.5 settle_customer_credit — pay down an outstanding customer balance
-- sale_id IS NULL on these payments (standalone settlement, not tied to a sale)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_customer_credit(
  p_customer_id uuid,
  p_amount numeric,
  p_method text
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_business_id uuid;
  v_customer record;
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

  IF p_amount > COALESCE(v_customer.credit_balance, 0) THEN
    RAISE EXCEPTION 'El monto supera la deuda actual del cliente';
  END IF;

  INSERT INTO payments (sale_id, method, amount, status)
  VALUES (NULL, p_method, p_amount, 'completed');

  UPDATE customers
  SET credit_balance = COALESCE(credit_balance, 0) - p_amount
  WHERE id = p_customer_id;

  RETURN (SELECT credit_balance FROM customers WHERE id = p_customer_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_customer_credit(uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2.6 RLS customers — existing `tenant_isolation` policy (cmd = ALL) already
-- covers SELECT/INSERT/UPDATE/DELETE via business_id = get_business_id().
-- No additional policy required.
-- ---------------------------------------------------------------------------
