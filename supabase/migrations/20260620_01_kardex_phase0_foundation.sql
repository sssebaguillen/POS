-- ============================================================
-- Kardex (libro mayor de inventario) — FASE 0: fundación no-breaking
-- ============================================================
-- Diseño completo: docs/todo/kardex.md
--
-- Esta migración NO cambia ningún comportamiento existente. Solo prepara
-- la base para las fases siguientes:
--   1) balance_after  — saldo corrido por (product_id, variant_id) tras el
--      movimiento. NULL en el histórico previo (informativo); las fases
--      futuras lo pueblan hacia adelante. Invariante objetivo:
--        balance_after del movimiento más reciente == stock actual.
--   2) tipo 'opening'  — asiento de saldo inicial (fase 1 lo siembra;
--      create_product lo usará en fase 3).
--   3) record_stock_movement(...) — ÚNICO choke point para mutar stock +
--      asentar el movimiento atómicamente. SE CREA PERO NO SE USA todavía:
--      las fases 2–4 rutean los escritores por acá. Inerte hoy.
--   4) REVOKE de anon sobre la tabla (regla 34): la tabla nunca se toca
--      desde el cliente anon; el catálogo no la usa. La RLS ya lo bloqueaba
--      (get_business_id() NULL para anon), esto cierra el grant sucio.
--
-- Reversible: DROP COLUMN balance_after; DROP FUNCTION record_stock_movement;
-- restaurar el CHECK anterior; re-GRANT anon (no recomendado).

-- ------------------------------------------------------------
-- 1) Columna balance_after (nullable, no toca filas existentes)
-- ------------------------------------------------------------
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS balance_after integer;

COMMENT ON COLUMN public.inventory_movements.balance_after IS
  'Saldo de stock del producto/variante DESPUÉS de aplicar este movimiento. '
  'NULL en filas previas a la fase 0 del kardex (informativas). '
  'Invariante: el balance_after más reciente por (product_id, variant_id) == stock actual.';

-- ------------------------------------------------------------
-- 2) Extender el CHECK de type para incluir 'opening'
--    (sale | purchase | adjustment | return | opening)
-- ------------------------------------------------------------
ALTER TABLE public.inventory_movements
  DROP CONSTRAINT IF EXISTS inventory_movements_type_check;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_type_check
  CHECK (type = ANY (ARRAY['sale'::text, 'purchase'::text, 'adjustment'::text, 'return'::text, 'opening'::text]));

-- ------------------------------------------------------------
-- 3) Helper único de mutación de stock + asiento (INERTE en fase 0)
-- ------------------------------------------------------------
-- Aplica un delta FIRMADO al stock (venta −, compra/devolución/opening +,
-- ajuste ±), lee el saldo resultante en la MISMA sentencia (RETURNING, seguro
-- ante concurrencia) y asienta el movimiento con ese balance_after.
--
-- NO toca sales_count (eso sigue en el trigger/llamadores).
-- NO valida tenant: es helper interno, llamado solo por RPC SECURITY DEFINER
-- que ya hacen assert_tenant (mismo criterio que log_audit_event, regla 34);
-- igual scopea su UPDATE/INSERT por p_business_id como defensa.
-- Si el producto/variante no existe en el negocio, no asienta nada.
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_business_id  uuid,
  p_product_id   uuid,
  p_variant_id   uuid,
  p_type         text,
  p_quantity     integer,
  p_reason       text,
  p_reference_id uuid,
  p_operator_id  uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN;  -- ítem sin producto del catálogo: nada que registrar
  END IF;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = stock + p_quantity
    WHERE id = p_variant_id AND business_id = p_business_id
    RETURNING stock INTO v_balance;
  ELSE
    UPDATE public.products
    SET stock = stock + p_quantity
    WHERE id = p_product_id AND business_id = p_business_id
    RETURNING stock INTO v_balance;
  END IF;

  -- Producto/variante inexistente en este negocio → no asentar (defensa)
  IF v_balance IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.inventory_movements (
    business_id, product_id, variant_id, type, quantity,
    reason, reference_id, created_by_operator, balance_after
  ) VALUES (
    p_business_id, p_product_id, p_variant_id, p_type, p_quantity,
    p_reason, p_reference_id, p_operator_id, v_balance
  );
END;
$$;

ALTER FUNCTION public.record_stock_movement(uuid, uuid, uuid, text, integer, text, uuid, uuid)
  OWNER TO postgres;

-- Helper interno: solo lo invocan RPC SECURITY DEFINER (corren como owner).
-- Revocar de todos los roles cliente (anon + authenticated vía PUBLIC),
-- dejar service_role para cron/admin (patrón log_audit_event, regla 34).
REVOKE ALL ON FUNCTION public.record_stock_movement(uuid, uuid, uuid, text, integer, text, uuid, uuid) FROM PUBLIC;
GRANT  ALL ON FUNCTION public.record_stock_movement(uuid, uuid, uuid, text, integer, text, uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 4) Cerrar el grant sucio: anon nunca toca la tabla (regla 34)
-- ------------------------------------------------------------
REVOKE ALL ON TABLE public.inventory_movements FROM anon;
