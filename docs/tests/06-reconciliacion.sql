-- =============================================================
-- Reconciliación de integridad numérica — capa DB
-- Ejecutar en Supabase SQL Editor (o vía MCP desde Claude Code).
--
-- Objetivo: confirmar que "los números dan perfectos" con cientos
-- de ventas/compras/movimientos. A diferencia de 05-db-automatizados.sql
-- (que testea comportamiento transaccional puntual), este archivo
-- valida INVARIANTES sobre TODO el dataset existente.
--
-- Cómo leerlo: cada bloque reporta PASS (invariante cumplida) o
-- FAIL (hay N filas que violan la invariante). Bajo cada bloque hay
-- una "detail query" comentada que devuelve las filas ofensoras.
--
-- Escanea TODOS los negocios → sirve igual contra el negocio real
-- (read-only, no muta nada) y contra un negocio de prueba con volumen.
-- Tolerancia monetaria: 0.01 (centavo) para evitar ruido de redondeo.
--
-- NOTA snapshots (R6): refrescá primero con refresh_all_daily_snapshots
-- antes de evaluar, o un FAIL puede ser sólo "snapshot desactualizado".
-- =============================================================

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
-- R1: total de cada línea = cantidad × precio unitario
-- =============================================================
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n
  FROM sale_items si
  WHERE ABS(si.total - (si.quantity * si.unit_price)) > 0.01;

  PERFORM test_assert('R1 sale_items.total = quantity*unit_price', n = 0,
    format('%s líneas con total inconsistente', n));
END;
$$;
-- detail:
-- SELECT id, sale_id, quantity, unit_price, total,
--        (quantity*unit_price) AS esperado
-- FROM sale_items WHERE ABS(total - quantity*unit_price) > 0.01;


-- =============================================================
-- R2: subtotal de la venta = suma de los totales de sus líneas
-- =============================================================
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n
  FROM sales s
  JOIN (SELECT sale_id, SUM(total) items_sum FROM sale_items GROUP BY sale_id) x
    ON x.sale_id = s.id
  WHERE ABS(s.subtotal - x.items_sum) > 0.01;

  PERFORM test_assert('R2 sales.subtotal = SUM(sale_items.total)', n = 0,
    format('%s ventas con subtotal != suma de líneas', n));
END;
$$;
-- detail:
-- SELECT s.id, s.subtotal, x.items_sum
-- FROM sales s
-- JOIN (SELECT sale_id, SUM(total) items_sum FROM sale_items GROUP BY sale_id) x
--   ON x.sale_id = s.id
-- WHERE ABS(s.subtotal - x.items_sum) > 0.01;


-- =============================================================
-- R3: total de la venta = subtotal - descuento
-- =============================================================
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n
  FROM sales s
  WHERE ABS(s.total - (s.subtotal - COALESCE(s.discount, 0))) > 0.01;

  PERFORM test_assert('R3 sales.total = subtotal - discount', n = 0,
    format('%s ventas con total != subtotal - descuento', n));
END;
$$;
-- detail:
-- SELECT id, subtotal, discount, total,
--        (subtotal - COALESCE(discount,0)) AS esperado
-- FROM sales WHERE ABS(total - (subtotal - COALESCE(discount,0))) > 0.01;


-- =============================================================
-- R4: cobertura de pago — toda venta 'completed' está cubierta
-- por sus pagos (cubre pago mixto y fiado: 'credit' es un pago más).
-- =============================================================
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n
  FROM sales s
  LEFT JOIN (
    SELECT sale_id, SUM(amount) paid
    FROM payments WHERE status = 'completed'
    GROUP BY sale_id
  ) p ON p.sale_id = s.id
  WHERE s.status = 'completed'
    AND ABS(s.total - COALESCE(p.paid, 0)) > 0.01;

  PERFORM test_assert('R4 pagos completados cubren el total de la venta', n = 0,
    format('%s ventas completed con pagos != total', n));
END;
$$;
-- detail:
-- SELECT s.id, s.total, COALESCE(p.paid,0) AS pagado
-- FROM sales s
-- LEFT JOIN (SELECT sale_id, SUM(amount) paid FROM payments WHERE status='completed' GROUP BY sale_id) p
--   ON p.sale_id = s.id
-- WHERE s.status='completed' AND ABS(s.total - COALESCE(p.paid,0)) > 0.01;


-- =============================================================
-- R5: el stock se decrementó por cada venta completada.
-- Por cada (venta, producto, variante) el movimiento neto de tipo
-- 'sale' debe ser EXACTAMENTE -cantidad_vendida (variant-aware).
-- FULL OUTER JOIN detecta también movimientos huérfanos y faltantes.
-- Excluye líneas libres (product_id NULL, no afectan stock).
-- =============================================================
DO $$
DECLARE n int;
BEGIN
  WITH sold AS (
    SELECT si.sale_id, si.product_id, si.variant_id, SUM(si.quantity) qty
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id AND s.status = 'completed'
    WHERE si.product_id IS NOT NULL
    GROUP BY si.sale_id, si.product_id, si.variant_id
  ),
  moved AS (
    SELECT reference_id AS sale_id, product_id, variant_id, SUM(quantity) qty
    FROM inventory_movements
    WHERE type = 'sale'
    GROUP BY reference_id, product_id, variant_id
  )
  SELECT COUNT(*) INTO n
  FROM sold
  FULL OUTER JOIN moved
    ON sold.sale_id = moved.sale_id
   AND sold.product_id = moved.product_id
   AND sold.variant_id IS NOT DISTINCT FROM moved.variant_id
  WHERE COALESCE(moved.qty, 0) <> -COALESCE(sold.qty, 0);

  PERFORM test_assert('R5 stock decrementado = cantidad vendida (por venta/producto/variante)', n = 0,
    format('%s combinaciones venta/producto con movimiento de stock inconsistente', n));
END;
$$;
-- detail:
-- WITH sold AS (
--   SELECT si.sale_id, si.product_id, si.variant_id, SUM(si.quantity) qty
--   FROM sale_items si JOIN sales s ON s.id=si.sale_id AND s.status='completed'
--   WHERE si.product_id IS NOT NULL
--   GROUP BY si.sale_id, si.product_id, si.variant_id),
-- moved AS (
--   SELECT reference_id sale_id, product_id, variant_id, SUM(quantity) qty
--   FROM inventory_movements WHERE type='sale'
--   GROUP BY reference_id, product_id, variant_id)
-- SELECT COALESCE(sold.sale_id,moved.sale_id) sale_id,
--        COALESCE(sold.product_id,moved.product_id) product_id,
--        sold.qty AS vendido, moved.qty AS movido
-- FROM sold FULL OUTER JOIN moved
--   ON sold.sale_id=moved.sale_id AND sold.product_id=moved.product_id
--  AND sold.variant_id IS NOT DISTINCT FROM moved.variant_id
-- WHERE COALESCE(moved.qty,0) <> -COALESCE(sold.qty,0);


-- =============================================================
-- R6: daily_snapshots == recálculo en vivo (espejo exacto de
-- upsert_daily_snapshot). Ventas por (created_at AT TIME ZONE tz)::date;
-- gastos por expenses.date directo. Detecta drift como el bug de TZ.
-- (Refrescá snapshots antes de correr — ver nota del encabezado.)
-- =============================================================
DO $$
DECLARE n int;
BEGIN
  WITH biz AS (
    SELECT id AS business_id,
           COALESCE(NULLIF(timezone,''), 'America/Argentina/Buenos_Aires') AS tz
    FROM businesses
  ),
  sales_re AS (
    SELECT s.business_id,
           ((s.created_at AT TIME ZONE b.tz)::date) AS d,
           COUNT(*)::int AS sales_count,
           COALESCE(SUM(s.subtotal),0) AS gross,
           COALESCE(SUM(s.discount),0) AS disc,
           COALESCE(SUM(s.total),0) AS net
    FROM sales s JOIN biz b ON b.business_id = s.business_id
    WHERE s.status = 'completed'
    GROUP BY s.business_id, ((s.created_at AT TIME ZONE b.tz)::date)
  ),
  items_re AS (
    SELECT s.business_id,
           ((s.created_at AT TIME ZONE b.tz)::date) AS d,
           COALESCE(SUM(si.quantity),0)::int AS items_sold
    FROM sales s
    JOIN biz b ON b.business_id = s.business_id
    JOIN sale_items si ON si.sale_id = s.id
    WHERE s.status = 'completed'
    GROUP BY s.business_id, ((s.created_at AT TIME ZONE b.tz)::date)
  ),
  exp_re AS (
    SELECT e.business_id, e.date AS d,
           COALESCE(SUM(e.amount),0) AS exp_total,
           COALESCE(SUM(e.amount) FILTER (WHERE e.category <> 'mercaderia'),0) AS op_exp,
           COALESCE(SUM(e.amount) FILTER (WHERE e.category = 'mercaderia'),0) AS inv_exp
    FROM expenses e
    GROUP BY e.business_id, e.date
  )
  SELECT COUNT(*) INTO n
  FROM daily_snapshots ds
  LEFT JOIN sales_re sr ON sr.business_id = ds.business_id AND sr.d = ds.snapshot_date
  LEFT JOIN items_re ir ON ir.business_id = ds.business_id AND ir.d = ds.snapshot_date
  LEFT JOIN exp_re   er ON er.business_id = ds.business_id AND er.d = ds.snapshot_date
  WHERE ds.sales_count            <> COALESCE(sr.sales_count,0)
     OR ds.items_sold             <> COALESCE(ir.items_sold,0)
     OR ABS(ds.gross_revenue            - COALESCE(sr.gross,0)) > 0.01
     OR ABS(ds.discounts_total          - COALESCE(sr.disc,0))  > 0.01
     OR ABS(ds.net_revenue              - COALESCE(sr.net,0))   > 0.01
     OR ABS(ds.expenses_total           - COALESCE(er.exp_total,0)) > 0.01
     OR ABS(ds.operating_expenses_total - COALESCE(er.op_exp,0))    > 0.01
     OR ABS(ds.inventory_expenses_total - COALESCE(er.inv_exp,0))   > 0.01;

  PERFORM test_assert('R6 daily_snapshots == recálculo en vivo', n = 0,
    format('%s snapshots con drift vs datos crudos (¿refrescaste?)', n));
END;
$$;

-- R6b: días con ventas completadas pero SIN fila de snapshot (gaps).
DO $$
DECLARE n int;
BEGIN
  WITH biz AS (
    SELECT id AS business_id,
           COALESCE(NULLIF(timezone,''), 'America/Argentina/Buenos_Aires') AS tz
    FROM businesses
  ),
  sales_days AS (
    SELECT DISTINCT s.business_id, ((s.created_at AT TIME ZONE b.tz)::date) AS d
    FROM sales s JOIN biz b ON b.business_id = s.business_id
    WHERE s.status = 'completed'
  )
  SELECT COUNT(*) INTO n
  FROM sales_days sd
  LEFT JOIN daily_snapshots ds
    ON ds.business_id = sd.business_id AND ds.snapshot_date = sd.d
  WHERE ds.id IS NULL;

  PERFORM test_assert('R6b todo día con ventas tiene snapshot', n = 0,
    format('%s días con ventas sin snapshot', n));
END;
$$;


-- =============================================================
-- R7: arqueo de caja — efectivo esperado al cierre =
-- fondo de apertura + ventas en efectivo de la sesión.
-- ⚠️ VERIFICAR que la fórmula coincida con close_cash_session:
-- si el modelo contempla retiros/ingresos manuales de caja, ajustar.
-- =============================================================
DO $$
DECLARE n int;
BEGIN
  WITH cash_in AS (
    SELECT s.session_id, SUM(p.amount) cash_amt
    FROM sales s
    JOIN payments p ON p.sale_id = s.id
    WHERE p.method = 'cash' AND p.status = 'completed'
      AND s.status = 'completed' AND s.session_id IS NOT NULL
    GROUP BY s.session_id
  )
  SELECT COUNT(*) INTO n
  FROM cash_sessions cs
  LEFT JOIN cash_in c ON c.session_id = cs.id
  WHERE cs.status = 'closed'
    AND cs.expected_amount IS NOT NULL
    AND ABS(cs.expected_amount - (COALESCE(cs.opening_amount,0) + COALESCE(c.cash_amt,0))) > 0.01;

  PERFORM test_assert('R7 expected_amount = apertura + ventas cash', n = 0,
    format('%s sesiones cerradas con expected != apertura+cash (¿retiros manuales?)', n));
END;
$$;


-- =============================================================
-- R8: integridad referencial — sin huérfanos
-- =============================================================
DO $$
DECLARE n_si int; n_pay int; n_mov int; n_prod int;
BEGIN
  SELECT COUNT(*) INTO n_si
  FROM sale_items si LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL;

  SELECT COUNT(*) INTO n_pay
  FROM payments p LEFT JOIN sales s ON s.id = p.sale_id WHERE s.id IS NULL;

  SELECT COUNT(*) INTO n_mov
  FROM inventory_movements m
  WHERE m.type = 'sale'
    AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = m.reference_id);

  SELECT COUNT(*) INTO n_prod
  FROM sale_items si
  WHERE si.product_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = si.product_id);

  PERFORM test_assert('R8a sin sale_items huérfanos', n_si = 0, format('%s huérfanos', n_si));
  PERFORM test_assert('R8b sin payments huérfanos', n_pay = 0, format('%s huérfanos', n_pay));
  PERFORM test_assert('R8c sin movimientos sale sin venta', n_mov = 0, format('%s huérfanos', n_mov));
  PERFORM test_assert('R8d sale_items apuntan a producto existente', n_prod = 0, format('%s líneas a producto inexistente', n_prod));
END;
$$;


-- =============================================================
-- R9: sanidad de signos/valores
-- =============================================================
DO $$
DECLARE n_amt int; n_tot int; n_qty int;
BEGIN
  SELECT COUNT(*) INTO n_amt FROM payments WHERE amount <= 0;
  SELECT COUNT(*) INTO n_tot FROM sales WHERE total < 0;
  SELECT COUNT(*) INTO n_qty FROM sale_items WHERE quantity <= 0;

  PERFORM test_assert('R9a payments.amount > 0', n_amt = 0, format('%s pagos <= 0', n_amt));
  PERFORM test_assert('R9b sales.total >= 0', n_tot = 0, format('%s ventas con total negativo', n_tot));
  PERFORM test_assert('R9c sale_items.quantity > 0', n_qty = 0, format('%s líneas con cantidad <= 0', n_qty));
END;
$$;


-- =============================================================
-- R10: DIAGNÓSTICOS INFORMATIVOS (no son PASS/FAIL)
-- =============================================================
DO $$
DECLARE v_drift int; v_no_ledger int;
BEGIN
  -- Drift stock vs movimientos: NO es invariante dura. Imports y ediciones
  -- manuales de stock setean products.stock directo sin generar movimiento.
  -- Útil sólo para detectar productos donde el delta es inexplicable.
  SELECT COUNT(*) INTO v_drift
  FROM products p
  LEFT JOIN (SELECT product_id, SUM(quantity) net FROM inventory_movements
             WHERE variant_id IS NULL GROUP BY product_id) m ON m.product_id = p.id
  WHERE p.has_variants = false
    AND p.stock <> COALESCE(m.net, 0);
  RAISE NOTICE 'INFO R10a: % productos (sin variantes) con stock != suma de movimientos. Esperable si hubo import/edición manual; revisar sólo si no debería haberla.', v_drift;

  -- Cuenta corriente: NO existe tabla-libro append-only. credit_balance se
  -- ajusta directo (sube al fiar, baja al cobrar) sin rastro reconciliable.
  -- HALLAZGO: considerar un ledger de cuenta corriente para auditar saldos.
  SELECT COUNT(*) INTO v_no_ledger FROM customers WHERE is_credit_enabled AND COALESCE(credit_balance,0) <> 0;
  RAISE NOTICE 'INFO R10b: % clientes con saldo de cuenta corriente != 0 y sin ledger para reconciliar. Hallazgo: no hay auditoría de movimientos de fiado.', v_no_ledger;
END;
$$;


-- =============================================================
-- R11: GASTOS DE MERCADERÍA + MOVIMIENTOS DE COMPRA
-- Invariantes duras sobre el flujo create_mercaderia_expense.
-- (Detalle del stress en docs/tests/10-stress-gastos.md.)
-- =============================================================

-- R11a: el monto de todo gasto de mercadería = Σ(unit_cost × quantity) de
-- sus ítems. Cierto siempre — create_mercaderia_expense calcula el total
-- desde los ítems, independientemente de si actualizó stock o no.
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n
  FROM expenses e
  WHERE e.category = 'mercaderia'
    AND ABS(e.amount - COALESCE((
      SELECT SUM(ei.unit_cost * ei.quantity)
      FROM expense_items ei WHERE ei.expense_id = e.id), 0)) > 0.01;

  PERFORM test_assert('R11a amount mercadería = SUM(expense_items.unit_cost*quantity)', n = 0,
    format('%s gastos de mercadería con amount != suma de ítems', n));
END;
$$;
-- detail:
-- SELECT e.id, e.amount,
--        (SELECT SUM(ei.unit_cost*ei.quantity) FROM expense_items ei WHERE ei.expense_id=e.id) esperado
-- FROM expenses e WHERE e.category='mercaderia'
--   AND ABS(e.amount - COALESCE((SELECT SUM(ei.unit_cost*ei.quantity) FROM expense_items ei WHERE ei.expense_id=e.id),0)) > 0.01;

-- R11b: todo movimiento 'purchase' tiene quantity > 0 (las compras suman stock).
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM inventory_movements WHERE type = 'purchase' AND quantity <= 0;
  PERFORM test_assert('R11b inventory_movements.purchase quantity > 0', n = 0,
    format('%s movimientos de compra con quantity <= 0', n));
END;
$$;

-- R11c: todo movimiento 'purchase' referencia un gasto existente.
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n
  FROM inventory_movements m
  WHERE m.type = 'purchase'
    AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = m.reference_id);
  PERFORM test_assert('R11c movimientos purchase apuntan a gasto existente', n = 0,
    format('%s movimientos de compra sin gasto', n));
END;
$$;
-- NOTA: NO existe invariante dura "Σ purchase = Σ ítems de mercadería" porque
-- create_mercaderia_expense permite p_update_stock = false (carga el gasto sin
-- mover stock). En ese caso hay ítems pero no movimientos, y es correcto.
-- Esa igualdad sólo se valida acotada a una corrida controlada (E2 en 10-stress-gastos.md).


-- =============================================================
DROP FUNCTION IF EXISTS test_assert(text, boolean, text);
