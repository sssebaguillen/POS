-- ============================================================
-- Kardex — FASE 1: opening snapshot (línea de base del libro)
-- ============================================================
-- Diseño: docs/todo/kardex.md §5.4
--
-- Siembra un asiento 'opening' por cada producto/variante con stock <> 0:
--   quantity = stock_actual, balance_after = stock_actual, created_at = now().
-- Como opening queda como el movimiento MÁS RECIENTE (now() > histórico),
-- a partir de acá se cumple el invariante objetivo:
--   balance_after del movimiento más reciente por (product_id, variant_id)
--   == stock actual.
-- Los asientos sale/purchase previos quedan con balance_after NULL
-- (informativos). NO cambia el stock — solo registra el saldo de partida.
--
-- IDEMPOTENTE: solo inserta donde no existe ya un 'opening' (NOT EXISTS),
-- así es re-ejecutable y se puede aplicar por tandas de negocios.
--
-- ⚠️ ESTADO DE APLICACIÓN (2026-06-20): aplicada SOLO a los negocios de
-- prueba ('tienda de seba', 'Q tal lokis') vía execute_sql scopeado
-- (63 asientos). Los negocios REALES/otros (Cecilia, gmail, nuevo seba)
-- NO se tocaron por decisión del dueño. El rollout global queda PENDIENTE
-- de su aprobación: re-correr este mismo archivo (idempotente) sin el
-- filtro de negocio cuando se autorice — saltará los ya sembrados.
--
-- Decisión §8.3 resuelta: solo stock <> 0 (menos ruido; el invariante por
-- balance_after no necesita asientos opening en 0).

-- ------------------------------------------------------------
-- Productos sin variantes
-- ------------------------------------------------------------
INSERT INTO public.inventory_movements
  (business_id, product_id, variant_id, type, quantity, reason, reference_id, created_by_operator, balance_after)
SELECT p.business_id, p.id, NULL, 'opening', p.stock,
       'Saldo inicial (migración kardex F1)', NULL, NULL, p.stock
FROM public.products p
WHERE p.has_variants = false
  AND p.stock <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.product_id = p.id AND m.variant_id IS NULL AND m.type = 'opening'
  );

-- ------------------------------------------------------------
-- Variantes (el stock vive en la variante, no en el producto padre)
-- ------------------------------------------------------------
INSERT INTO public.inventory_movements
  (business_id, product_id, variant_id, type, quantity, reason, reference_id, created_by_operator, balance_after)
SELECT pv.business_id, pv.product_id, pv.id, 'opening', pv.stock,
       'Saldo inicial (migración kardex F1)', NULL, NULL, pv.stock
FROM public.product_variants pv
WHERE pv.stock <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.variant_id = pv.id AND m.type = 'opening'
  );
