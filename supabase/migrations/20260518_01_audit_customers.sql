-- P8 follow-up: audit_log support for customers.
--   - audit_log.entity_type CHECK adds 'customer'.
--   - create_customer / update_customer RPCs wrap the existing direct INSERT/UPDATE
--     used by NewCustomerModal / EditCustomerModal, following the supplier RPC
--     pattern: verify business context, resolve actor role, mutate, log.
--   - settle_customer_credit grows a p_operator_id (DEFAULT NULL) and emits an
--     audit event so customer-balance settlements are traceable.

-- ---------------------------------------------------------------------------
-- 1. entity_type CHECK — add 'customer'
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type IN (
    'sale', 'product', 'category', 'brand',
    'expense', 'supplier', 'price_list', 'setting', 'operator',
    'customer'
  ));

-- ---------------------------------------------------------------------------
-- 2. create_customer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer(
  p_operator_id       uuid,
  p_business_id       uuid,
  p_name              text,
  p_phone             text    DEFAULT NULL,
  p_email             text    DEFAULT NULL,
  p_dni               text    DEFAULT NULL,
  p_credit_limit      numeric DEFAULT 0,
  p_is_credit_enabled boolean DEFAULT false,
  p_notes             text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_actor_role         text;
  v_customer_id        uuid;
  v_customer           jsonb;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  INSERT INTO customers (
    business_id, name, phone, email, dni,
    credit_limit, is_credit_enabled, notes
  ) VALUES (
    v_caller_business_id,
    btrim(p_name),
    NULLIF(btrim(p_phone), ''),
    NULLIF(btrim(p_email), ''),
    NULLIF(btrim(p_dni), ''),
    COALESCE(p_credit_limit, 0),
    COALESCE(p_is_credit_enabled, false),
    NULLIF(btrim(p_notes), '')
  )
  RETURNING id, to_jsonb(customers.*) INTO v_customer_id, v_customer;

  PERFORM log_audit_event(
    v_caller_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_created', 'customer', v_customer_id, btrim(p_name),
    NULL, v_customer
  );

  RETURN jsonb_build_object('success', true, 'customer', v_customer);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_customer(uuid, uuid, text, text, text, text, numeric, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. update_customer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_customer(
  p_operator_id       uuid,
  p_business_id       uuid,
  p_customer_id       uuid,
  p_name              text,
  p_phone             text    DEFAULT NULL,
  p_email             text    DEFAULT NULL,
  p_dni               text    DEFAULT NULL,
  p_credit_limit      numeric DEFAULT 0,
  p_is_credit_enabled boolean DEFAULT false,
  p_notes             text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(c.*) INTO v_old_data
  FROM customers c
  WHERE c.id = p_customer_id AND c.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;

  UPDATE customers SET
    name              = btrim(p_name),
    phone             = NULLIF(btrim(p_phone), ''),
    email             = NULLIF(btrim(p_email), ''),
    dni               = NULLIF(btrim(p_dni), ''),
    credit_limit      = COALESCE(p_credit_limit, 0),
    is_credit_enabled = COALESCE(p_is_credit_enabled, false),
    notes             = NULLIF(btrim(p_notes), '')
  WHERE id = p_customer_id AND business_id = v_caller_business_id
  RETURNING to_jsonb(customers.*) INTO v_new_data;

  PERFORM log_audit_event(
    v_caller_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_updated', 'customer', p_customer_id, btrim(p_name),
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'customer', v_new_data);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_customer(uuid, uuid, uuid, text, text, text, text, numeric, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. settle_customer_credit — replace signature: add p_operator_id, audit
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.settle_customer_credit(uuid, numeric, text);

CREATE OR REPLACE FUNCTION public.settle_customer_credit(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      text,
  p_operator_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.settle_customer_credit(uuid, numeric, text, uuid) TO authenticated;
