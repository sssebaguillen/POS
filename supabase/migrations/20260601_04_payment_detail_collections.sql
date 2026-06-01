-- =============================================================
-- Customer Account Ledger — Batch 2b (D2: collections in payment stats)
-- 2026-06-01. Design: docs/todo/customer-account-ledger.md
--
-- get_sales_by_payment_detail:
--   (a) FIX naming: the view reads `transactions`/`avg_ticket` but the RPC
--       returned `transaction_count`/`avg_amount` (blind cast hid it → those
--       two columns showed 0). Renamed to match.
--   (b) ADD `collections`: credit settlements (customer_account_movements,
--       type=payment) grouped by method, returned in a SEPARATE key so they
--       never pollute the sales payment-mix or its percentages.
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_sales_by_payment_detail(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rows        jsonb;
  v_collections jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      pay.method,
      COUNT(DISTINCT s.id)::int AS transactions,
      SUM(pay.amount)           AS total_amount,
      AVG(pay.amount)           AS avg_ticket
    FROM public.payments pay
    JOIN public.sales s ON s.id = pay.sale_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND pay.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY pay.method
    ORDER BY total_amount DESC
  ) r;

  -- Credit settlements (cobros de cuenta corriente) — separate, never merged
  -- into the sales payment-mix (a credit sale is already booked as revenue
  -- under 'credit' at sale time; merging would double-count).
  SELECT jsonb_agg(row_to_json(c))
  INTO v_collections
  FROM (
    SELECT
      m.method,
      COUNT(*)::int   AS transactions,
      SUM(m.amount)   AS total_amount,
      AVG(m.amount)   AS avg_ticket
    FROM public.customer_account_movements m
    WHERE m.business_id = p_business_id
      AND m.type = 'payment'
      AND (p_from IS NULL OR m.created_at::date >= p_from)
      AND (p_to   IS NULL OR m.created_at::date <= p_to)
    GROUP BY m.method
    ORDER BY total_amount DESC
  ) c;

  RETURN jsonb_build_object(
    'data',        COALESCE(v_rows, '[]'::jsonb),
    'collections', COALESCE(v_collections, '[]'::jsonb)
  );
END;
$function$;
