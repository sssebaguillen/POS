-- =============================================================
-- Customer Account Ledger — Batch 2a (cutover: D1 till + D3 model)
-- 2026-06-01. Design: docs/todo/customer-account-ledger.md
--
-- D3: settlements leave `payments` (sale_id becomes NOT NULL); they live only
--     in customer_account_movements.
-- D1: cash settlements count toward the cash session's expected amount.
--
-- NOTE: the single existing settlement row in `payments` (sale_id NULL) is
-- removed BEFORE this migration via a dev-scoped data step (it belongs to
-- 'tienda de seba'; its net is already in the ledger opening backfill + audit_log).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Ledger: add session_id (only 'payment' movements set it) + FK index
-- -------------------------------------------------------------
ALTER TABLE public.customer_account_movements
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cam_session_id
  ON public.customer_account_movements (session_id);

-- -------------------------------------------------------------
-- 2. settle_customer_credit — no longer writes to payments; attributes the
--    movement to the open cash session (for the till)
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
  v_session_id   uuid;
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

  -- Attribute the collection to the open cash session (if any) for the till.
  -- At most one open session per business (enforced by unique partial index).
  SELECT id INTO v_session_id
  FROM cash_sessions
  WHERE business_id = v_business_id AND status = 'open';

  INSERT INTO customer_account_movements
    (business_id, customer_id, type, amount, method, operator_id, balance_after, session_id)
  VALUES
    (v_business_id, p_customer_id, 'payment', p_amount, p_method,
     CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END, v_next_balance, v_session_id);

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

-- -------------------------------------------------------------
-- 3. payments.sale_id -> NOT NULL (settlements no longer live here)
--    Requires 0 NULL-sale payments — the dev settlement row is removed first
--    by the dev-scoped data step (see migration notes / session log).
-- -------------------------------------------------------------
ALTER TABLE public.payments ALTER COLUMN sale_id SET NOT NULL;

-- -------------------------------------------------------------
-- 4. close_cash_session — expected = opening + cash sales + cash settlements
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_cash_session(p_session_id uuid, p_closing_amount numeric, p_notes text, p_operator_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id      uuid;
  v_cash_sales       numeric;
  v_cash_settlements numeric;
  v_expected         numeric;
  v_difference       numeric;
  v_row              cash_sessions;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

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

  SELECT COALESCE(SUM(m.amount), 0) INTO v_cash_settlements
  FROM customer_account_movements m
  WHERE m.session_id = p_session_id
    AND m.business_id = v_business_id
    AND m.type = 'payment'
    AND m.method = 'cash';

  v_expected   := v_row.opening_amount + v_cash_sales + v_cash_settlements;
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
    'success',           true,
    'session',           row_to_json(v_row),
    'cash_sales',        v_cash_sales,
    'cash_settlements',  v_cash_settlements,
    'expected_amount',   v_expected,
    'difference',        v_difference
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

-- -------------------------------------------------------------
-- 5. get_session_summary — expose cash_settlements so the close PREVIEW
--    computes the same expected as close_cash_session
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_session_summary(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_business_id uuid;
  v_result      jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id',              cs.id,
    'status',          cs.status,
    'opening_amount',  cs.opening_amount,
    'closing_amount',  cs.closing_amount,
    'expected_amount', cs.expected_amount,
    'difference',      CASE WHEN cs.status = 'closed' THEN cs.closing_amount - cs.expected_amount ELSE NULL END,
    'opened_at',       cs.opened_at,
    'closed_at',       cs.closed_at,
    'notes',           cs.notes,
    'opened_by',       cs.opened_by,
    'opened_by_name',  CASE WHEN cs.opened_by IS NULL THEN 'Dueño' ELSE op.name END,
    'closed_by',       cs.closed_by,
    'closed_by_name',  CASE WHEN cs.closed_by IS NULL THEN 'Dueño' ELSE cl.name END,
    'sales_count',     COALESCE(agg.sales_count, 0),
    'sales_total',     COALESCE(agg.sales_total, 0),
    'cash_settlements', COALESCE(settle_agg.cash_settlements, 0),
    'payments_by_method', COALESCE(pay_agg.breakdown, '[]'::jsonb),
    'digital_balances', COALESCE(dig_agg.balances, '[]'::jsonb)
  ) INTO v_result
  FROM cash_sessions cs
  LEFT JOIN operators op ON op.id = cs.opened_by AND op.business_id = v_business_id
  LEFT JOIN operators cl ON cl.id = cs.closed_by AND cl.business_id = v_business_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS sales_count, COALESCE(SUM(s.total), 0) AS sales_total
    FROM sales s
    WHERE s.session_id = cs.id AND s.business_id = v_business_id
  ) agg ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(m.amount), 0) AS cash_settlements
    FROM customer_account_movements m
    WHERE m.session_id = cs.id AND m.business_id = v_business_id
      AND m.type = 'payment' AND m.method = 'cash'
  ) settle_agg ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('method', p.method, 'total', p.method_total) ORDER BY p.method_total DESC) AS breakdown
    FROM (
      SELECT p2.method, SUM(p2.amount) AS method_total
      FROM payments p2
      JOIN sales s2 ON s2.id = p2.sale_id
      WHERE s2.session_id = cs.id AND s2.business_id = v_business_id
      GROUP BY p2.method
    ) p
  ) pay_agg ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'method',          sdb.method,
        'opening_balance', sdb.opening_balance,
        'closing_balance', sdb.closing_balance,
        'sales_total',     COALESCE(pm.total, 0),
        'expected',        CASE WHEN sdb.opening_balance IS NOT NULL
                           THEN sdb.opening_balance + COALESCE(pm.total, 0)
                           ELSE NULL END,
        'difference',      CASE
                             WHEN sdb.opening_balance IS NOT NULL AND sdb.closing_balance IS NOT NULL
                             THEN sdb.closing_balance - (sdb.opening_balance + COALESCE(pm.total, 0))
                             ELSE NULL
                           END
      )
      ORDER BY sdb.method
    ) AS balances
    FROM session_digital_balances sdb
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount) AS total
      FROM payments p
      JOIN sales s ON s.id = p.sale_id
      WHERE s.session_id = cs.id AND s.business_id = v_business_id AND p.method = sdb.method
    ) pm ON true
    WHERE sdb.session_id = cs.id
  ) dig_agg ON true
  WHERE cs.id = p_session_id AND cs.business_id = v_business_id;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;
