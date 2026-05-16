-- P7h Phase 1: enrich sale_created / sale_updated / sale_deleted audit
-- payloads so the /activity detail panel has enough context to render
-- a human-readable view without re-querying the (possibly deleted) sale.
--
-- New shape for sale_created.new_data, sale_deleted.old_data, and both
-- old_data and new_data on sale_updated:
--   { total, subtotal, status, customer_id,
--     payments: [{ method, amount }],
--     items:    [{ product_id, variant_id, quantity, unit_price, total }] }


-- =============================================================================
-- create_sale_transaction
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_sale_transaction(
  p_business_id   uuid,
  p_subtotal      numeric,
  p_discount      numeric,
  p_total         numeric,
  p_status        text,
  p_price_list_id uuid,
  p_operator_id   uuid,
  p_items         jsonb,
  p_payments      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
  v_payment            jsonb;
  v_payments_total     numeric := 0;
  v_actor_role         text;
  v_new_data           jsonb;
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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO sale_items (
      sale_id, product_id, variant_id, quantity, unit_price, total,
      unit_price_override, override_reason, free_line_description
    )
    VALUES (
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

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  -- Snapshot the persisted sale exactly as it now lives in the DB, so the
  -- audit payload matches sale_updated/sale_deleted shape.
  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = v_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = v_sale_id
    ), '[]'::jsonb)
  ) INTO v_new_data
  FROM sales s WHERE s.id = v_sale_id;

  PERFORM log_audit_event(
    p_business_id, p_operator_id, v_actor_role,
    'sale_created', 'sale', v_sale_id, NULL,
    NULL,
    v_new_data
  );

  RETURN jsonb_build_object(
    'success',    true,
    'sale_id',    v_sale_id,
    'created_at', v_sale_created_at
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- =============================================================================
-- update_sale (add customer_id to old_data and new_data)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_sale(
  p_sale_id        uuid,
  p_business_id    uuid,
  p_items          jsonb,
  p_payment_method text,
  p_operator_id    uuid,
  p_status         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_total      numeric(12,2);
  v_actor_role text;
  v_old_data   jsonb;
  v_new_data   jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id
    ), '[]'::jsonb)
  ) INTO v_old_data
  FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;

  UPDATE products p
  SET
    stock       = p.stock + si.quantity,
    sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND p.id          = si.product_id
    AND si.variant_id IS NULL;

  UPDATE product_variants pv
  SET stock = pv.stock + si.quantity
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND pv.id         = si.variant_id
    AND si.variant_id IS NOT NULL;

  UPDATE products p
  SET sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND p.id          = si.product_id
    AND si.variant_id IS NOT NULL;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, unit_price, total)
  SELECT
    p_sale_id,
    (item->>'product_id')::uuid,
    NULLIF(item->>'variant_id', '')::uuid,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric(12,2),
    (item->>'quantity')::int * (item->>'unit_price')::numeric(12,2)
  FROM jsonb_array_elements(p_items) AS item;

  SELECT COALESCE(SUM(total), 0) INTO v_total
  FROM sale_items WHERE sale_id = p_sale_id;

  UPDATE sales
  SET
    total    = v_total,
    subtotal = v_total,
    status   = COALESCE(p_status, status)
  WHERE id = p_sale_id AND business_id = p_business_id;

  UPDATE payments
  SET method = p_payment_method
  WHERE sale_id = p_sale_id;

  PERFORM reconcile_sales_count(p_business_id);

  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id
    ), '[]'::jsonb)
  ) INTO v_new_data
  FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;

  PERFORM log_audit_event(
    p_business_id, p_operator_id, v_actor_role,
    'sale_updated', 'sale', p_sale_id, NULL,
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'total', v_total);
END;
$$;


-- =============================================================================
-- delete_sale (add customer_id to old_data)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.delete_sale(
  p_sale_id     uuid,
  p_business_id uuid,
  p_operator_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_item       record;
  v_actor_role text;
  v_old_data   jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Sale not found');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'total',       s.total,
    'subtotal',    s.subtotal,
    'status',      s.status,
    'customer_id', s.customer_id,
    'items',    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id,
        'variant_id', si.variant_id,
        'quantity',   si.quantity,
        'unit_price', si.unit_price,
        'total',      si.total
      ) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id
    ), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id
    ), '[]'::jsonb)
  ) INTO v_old_data
  FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;

  FOR v_item IN
    SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    UPDATE products
    SET
      stock       = stock + v_item.quantity,
      sales_count = GREATEST(0, sales_count - v_item.quantity)
    WHERE id = v_item.product_id AND business_id = p_business_id;
  END LOOP;

  DELETE FROM inventory_movements WHERE reference_id = p_sale_id;
  DELETE FROM payments     WHERE sale_id = p_sale_id;
  DELETE FROM sale_items   WHERE sale_id = p_sale_id;
  DELETE FROM sales        WHERE id = p_sale_id AND business_id = p_business_id;

  PERFORM reconcile_sales_count(p_business_id);

  PERFORM log_audit_event(
    p_business_id, p_operator_id, v_actor_role,
    'sale_deleted', 'sale', p_sale_id, NULL,
    v_old_data, NULL
  );

  RETURN json_build_object('success', true);
END;
$$;
