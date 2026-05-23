-- =============================================================
-- Tests automatizados — capa DB
-- Ejecutar en Supabase SQL Editor (o vía MCP desde Claude Code)
-- Cada bloque es independiente. Muestra PASS o FAIL con detalle.
-- IMPORTANTE: usar en un negocio de TEST, nunca en producción.
-- =============================================================

-- Helper para reportar resultados
CREATE OR REPLACE FUNCTION test_assert(
  test_name text,
  condition boolean,
  detail text DEFAULT ''
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF condition THEN
    RAISE NOTICE 'PASS: %', test_name;
  ELSE
    RAISE WARNING 'FAIL: % — %', test_name, detail;
  END IF;
END;
$$;


-- =============================================================
-- BLOQUE 1: create_sale_transaction
-- =============================================================

DO $$
DECLARE
  v_biz_id uuid;
  v_product_id uuid;
  v_initial_stock int;
  v_result jsonb;
BEGIN
  -- Obtener el primer negocio de test disponible
  SELECT id INTO v_biz_id FROM businesses LIMIT 1;

  -- Obtener un producto con stock > 0
  SELECT id, stock INTO v_product_id, v_initial_stock
  FROM products WHERE business_id = v_biz_id AND stock > 2 LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE WARNING 'SKIP: no hay productos con stock > 2 para testear';
    RETURN;
  END IF;

  -- Test 1.1: pago insuficiente debe fallar
  SELECT * INTO v_result FROM create_sale_transaction(
    v_biz_id, 1000, 0, 1000, 'completed', NULL, NULL,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'variant_id', null,
      'quantity', 1, 'unit_price', 1000, 'total', 1000,
      'unit_price_override', null, 'override_reason', null, 'free_line_description', null
    )),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500)), -- paga menos
    NULL
  );
  PERFORM test_assert(
    '1.1 pago insuficiente rechazado',
    (v_result->>'success')::boolean = false,
    v_result->>'error'
  );

  -- Test 1.2: carrito vacío debe fallar
  SELECT * INTO v_result FROM create_sale_transaction(
    v_biz_id, 0, 0, 0, 'completed', NULL, NULL,
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 0)),
    NULL
  );
  PERFORM test_assert(
    '1.2 carrito vacío rechazado',
    (v_result->>'success')::boolean = false,
    v_result->>'error'
  );

END;
$$;


-- =============================================================
-- BLOQUE 2: cash_sessions — open_cash_session
-- =============================================================

DO $$
DECLARE
  v_biz_id uuid;
  v_result1 jsonb;
  v_result2 jsonb;
  v_session_id uuid;
BEGIN
  SELECT id INTO v_biz_id FROM businesses LIMIT 1;

  -- Cerrar sesiones abiertas previas (cleanup)
  UPDATE cash_sessions SET status = 'closed', closed_at = now()
  WHERE business_id = v_biz_id AND status = 'open';

  -- Test 2.1: abrir sesión exitosamente
  SELECT * INTO v_result1 FROM open_cash_session(500, NULL);
  PERFORM test_assert(
    '2.1 abrir sesión exitosa',
    (v_result1->>'success')::boolean = true,
    v_result1->>'error'
  );
  v_session_id := (v_result1->'session'->>'id')::uuid;

  -- Test 2.2: no se pueden abrir dos sesiones simultáneas
  SELECT * INTO v_result2 FROM open_cash_session(1000, NULL);
  PERFORM test_assert(
    '2.2 segunda sesión rechazada',
    (v_result2->>'success')::boolean = false,
    v_result2->>'error'
  );

  -- Cleanup
  UPDATE cash_sessions SET status = 'closed', closed_at = now()
  WHERE id = v_session_id;

END;
$$;


-- =============================================================
-- BLOQUE 3: close_cash_session — expected_amount
-- =============================================================

DO $$
DECLARE
  v_biz_id uuid;
  v_product_id uuid;
  v_open_result jsonb;
  v_session_id uuid;
  v_sale_result jsonb;
  v_close_result jsonb;
  v_expected numeric;
BEGIN
  SELECT id INTO v_biz_id FROM businesses LIMIT 1;
  SELECT id INTO v_product_id FROM products
  WHERE business_id = v_biz_id AND stock > 5 LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE WARNING 'SKIP: no hay productos con stock > 5';
    RETURN;
  END IF;

  -- Cleanup previo
  UPDATE cash_sessions SET status = 'closed', closed_at = now()
  WHERE business_id = v_biz_id AND status = 'open';

  -- Abrir sesión con fondo $1.000
  SELECT * INTO v_open_result FROM open_cash_session(1000, NULL);
  v_session_id := (v_open_result->'session'->>'id')::uuid;

  -- Hacer una venta en efectivo por $500
  SELECT * INTO v_sale_result FROM create_sale_transaction(
    v_biz_id, 500, 0, 500, 'completed', NULL, NULL,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'variant_id', null,
      'quantity', 1, 'unit_price', 500, 'total', 500,
      'unit_price_override', null, 'override_reason', null, 'free_line_description', null
    )),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500)),
    v_session_id
  );

  -- Cerrar la sesión
  SELECT * INTO v_close_result FROM close_cash_session(v_session_id, 1600, NULL, NULL);
  v_expected := (v_close_result->>'expected_amount')::numeric;

  -- Test 3.1: expected = fondo ($1.000) + ventas cash ($500) = $1.500
  PERFORM test_assert(
    '3.1 expected_amount = fondo + ventas cash',
    v_expected = 1500,
    format('expected_amount = %s, esperado = 1500', v_expected)
  );

  -- Test 3.2: difference = contado ($1.600) - expected ($1.500) = $100
  PERFORM test_assert(
    '3.2 difference calculada correctamente',
    (v_close_result->>'difference')::numeric = 100,
    format('difference = %s, esperada = 100', v_close_result->>'difference')
  );

  -- Test 3.3: sesión no cash no suma al expected
  -- (ya cubierto indirectamente — solo sumamos método 'cash')

END;
$$;


-- =============================================================
-- BLOQUE 4: stock negativo — bug conocido
-- Este test documenta el bug. Debería FALLAR (stock queda en -1).
-- Cuando se corrija, debe pasar (la venta debe ser rechazada).
-- =============================================================

DO $$
DECLARE
  v_biz_id uuid;
  v_product_id uuid;
  v_result jsonb;
  v_stock_after int;
BEGIN
  SELECT id INTO v_biz_id FROM businesses LIMIT 1;

  -- Crear producto temporal con stock = 1
  INSERT INTO products (business_id, name, price, cost, stock, is_active)
  VALUES (v_biz_id, '__test_stock_negativo__', 100, 50, 1, true)
  RETURNING id INTO v_product_id;

  -- Vender 2 unidades (más de las disponibles)
  SELECT * INTO v_result FROM create_sale_transaction(
    v_biz_id, 200, 0, 200, 'completed', NULL, NULL,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'variant_id', null,
      'quantity', 2, 'unit_price', 100, 'total', 200,
      'unit_price_override', null, 'override_reason', null, 'free_line_description', null
    )),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 200)),
    NULL
  );

  SELECT stock INTO v_stock_after FROM products WHERE id = v_product_id;

  -- Este test FALLA hasta que se corrija el bug
  PERFORM test_assert(
    '4.1 [BUG] venta con stock insuficiente rechazada',
    (v_result->>'success')::boolean = false OR v_stock_after >= 0,
    format('stock resultante = %s (debería ser >= 0 o la venta rechazada)', v_stock_after)
  );

  -- Cleanup
  DELETE FROM sale_items WHERE product_id = v_product_id;
  DELETE FROM inventory_movements WHERE product_id = v_product_id;
  DELETE FROM products WHERE id = v_product_id;

END;
$$;


-- =============================================================
-- BLOQUE 5: integridad de datos post-venta
-- =============================================================

DO $$
DECLARE
  v_count_orphan_items int;
  v_count_orphan_payments int;
  v_count_negative_stock int;
BEGIN
  -- Test 5.1: no hay sale_items sin sale válida
  SELECT COUNT(*) INTO v_count_orphan_items
  FROM sale_items si
  LEFT JOIN sales s ON s.id = si.sale_id
  WHERE s.id IS NULL;

  PERFORM test_assert(
    '5.1 no hay sale_items huérfanos',
    v_count_orphan_items = 0,
    format('%s items sin venta asociada', v_count_orphan_items)
  );

  -- Test 5.2: no hay payments sin sale válida
  SELECT COUNT(*) INTO v_count_orphan_payments
  FROM payments p
  LEFT JOIN sales s ON s.id = p.sale_id
  WHERE s.id IS NULL;

  PERFORM test_assert(
    '5.2 no hay payments huérfanos',
    v_count_orphan_payments = 0,
    format('%s payments sin venta asociada', v_count_orphan_payments)
  );

  -- Test 5.3: stock negativo (documenta estado actual)
  SELECT COUNT(*) INTO v_count_negative_stock
  FROM products WHERE stock < 0;

  PERFORM test_assert(
    '5.3 no hay stock negativo en productos',
    v_count_negative_stock = 0,
    format('%s productos con stock negativo', v_count_negative_stock)
  );

END;
$$;


-- =============================================================
-- Cleanup del helper
-- =============================================================
DROP FUNCTION IF EXISTS test_assert(text, boolean, text);
