-- ============================================================
-- Free Line (Producto Libre) feature
-- ============================================================

-- 1. Add free_line_description column to sale_items
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS free_line_description text;

-- product_id is already nullable — no change needed.

-- 2. Update create_sale_transaction to persist free_line_description
--    and handle NULL product_id gracefully in the stock trigger path.
CREATE OR REPLACE FUNCTION public.create_sale_transaction(
  p_business_id    uuid,
  p_subtotal       numeric,
  p_discount       numeric,
  p_total          numeric,
  p_status         text,
  p_price_list_id  uuid,
  p_operator_id    uuid,
  p_items          jsonb,
  p_payments       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
  v_payment            jsonb;
  v_payments_total     numeric := 0;
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

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric;
  END LOOP;

  IF v_payments_total < p_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'El monto de los pagos no cubre el total de la venta');
  END IF;

  INSERT INTO sales (business_id, subtotal, discount, total, status, price_list_id, operator_id)
  VALUES (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id)
  RETURNING id, created_at INTO v_sale_id, v_sale_created_at;

  -- NULL product_id naturally skips the update_stock_on_sale trigger condition
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO sale_items (
      sale_id, product_id, quantity, unit_price, total,
      unit_price_override, override_reason, free_line_description
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      (v_item->>'unit_price_override')::numeric,
      v_item->>'override_reason',
      v_item->>'free_line_description'
    );
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    INSERT INTO payments (sale_id, method, amount, status)
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::numeric,
      'completed'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',    true,
    'sale_id',    v_sale_id,
    'created_at', v_sale_created_at
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 3. Update get_sale_detail to use free_line_description as product name fallback
CREATE OR REPLACE FUNCTION public.get_sale_detail(p_sale_id uuid, p_business_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales
    WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Sale not found');
  END IF;

  SELECT json_build_object(
    'success',        true,
    'operator_name',  COALESCE(direct_op.name, session_op.name),
    'payment_method', pay.method,
    'items', (
      SELECT json_agg(json_build_object(
        'id',                    si.id,
        'product_id',            si.product_id,
        'product_name',          COALESCE(p.name, si.free_line_description, 'Producto eliminado'),
        'product_icon',          cat.icon,
        'quantity',              si.quantity,
        'unit_price',            si.unit_price,
        'free_line_description', si.free_line_description
      ) ORDER BY si.id)
      FROM sale_items si
      LEFT JOIN products p     ON p.id = si.product_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE si.sale_id = p_sale_id
    )
  )
  INTO v_result
  FROM sales s
  LEFT JOIN operators direct_op  ON direct_op.id = s.operator_id
  LEFT JOIN cash_sessions cs     ON cs.id = s.session_id
  LEFT JOIN operators session_op ON session_op.id = cs.opened_by
  LEFT JOIN LATERAL (
    SELECT method FROM payments
    WHERE sale_id = p_sale_id
    ORDER BY created_at DESC
    LIMIT 1
  ) pay ON true
  WHERE s.id = p_sale_id;

  RETURN v_result;
END;
$$;
