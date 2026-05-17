-- P8 follow-up: customer deletion.
--   - customers.deleted_at timestamptz (nullable) for soft delete.
--   - delete_customer RPC:
--       * SECURITY DEFINER, verifies business context.
--       * If the customer has any sales OR credit_balance > 0 → soft delete
--         (UPDATE deleted_at = now()).
--       * Otherwise → hard delete (DELETE FROM customers).
--       * Logs to audit_log as 'customer_deleted', recording the mode
--         ('soft' | 'hard') in new_data.

-- ---------------------------------------------------------------------------
-- 1. customers.deleted_at
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS customers_active_idx
  ON public.customers (business_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. delete_customer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_customer(
  p_customer_id uuid,
  p_operator_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_actor_role         text;
  v_customer           record;
  v_has_sales          boolean;
  v_mode               text;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id
    AND business_id = v_caller_business_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM sales WHERE customer_id = p_customer_id
  ) INTO v_has_sales;

  IF v_has_sales OR COALESCE(v_customer.credit_balance, 0) > 0 THEN
    UPDATE customers
    SET deleted_at = now()
    WHERE id = p_customer_id;
    v_mode := 'soft';
  ELSE
    DELETE FROM customers WHERE id = p_customer_id;
    v_mode := 'hard';
  END IF;

  PERFORM log_audit_event(
    v_caller_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_deleted', 'customer', p_customer_id, v_customer.name,
    to_jsonb(v_customer),
    jsonb_build_object('mode', v_mode, 'name', v_customer.name)
  );

  RETURN jsonb_build_object('success', true, 'mode', v_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_customer(uuid, uuid) TO authenticated;
