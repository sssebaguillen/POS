-- ============================================================
-- get_customer_sales — historial COMPLETO de compras de un cliente (solo lectura)
-- ============================================================
-- La ficha de cliente (CustomerDetailPanel) mostraba solo los movimientos de
-- cuenta corriente (ventas a crédito + pagos). Faltaba el historial completo:
-- las compras que el cliente pagó al contado (efectivo/tarjeta/etc.) no generan
-- customer_account_movements, así que no aparecían en ningún lado.
--
-- Esta RPC lista TODAS las ventas completadas de un cliente (contado + crédito),
-- más nuevas primero, para la pestaña "Compras" de la ficha. Se apoya en el índice
-- parcial idx_sales_customer_id. Read-only. Regla 34: assert_tenant + REVOKE
-- PUBLIC/anon + GRANT authenticated.

CREATE OR REPLACE FUNCTION public.get_customer_sales(
  p_business_id uuid,
  p_customer_id uuid,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows   jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC, d.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      s.id,
      s.created_at,
      s.total,
      s.status,
      s.source,
      (SELECT p.method FROM public.payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) AS method,
      (SELECT COALESCE(SUM(si.quantity), 0)::int FROM public.sale_items si WHERE si.sale_id = s.id) AS item_count
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.customer_id = p_customer_id
      AND s.status = 'completed'
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT v_limit OFFSET v_offset
  ) d;

  RETURN jsonb_build_object('data', v_rows);
END;
$$;

ALTER FUNCTION public.get_customer_sales(uuid, uuid, integer, integer) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_customer_sales(uuid, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_sales(uuid, uuid, integer, integer) TO authenticated, service_role;
