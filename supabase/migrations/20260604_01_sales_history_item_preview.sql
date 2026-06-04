-- Historial de ventas: agrega preview de items a cada fila de la página.
--
-- Bug: en el dashboard, la fila colapsada de una venta sólo mostraba "N items +
-- íconos de categoría" DESPUÉS de expandirla una vez (la data venía recién de
-- get_sale_detail). Antes de expandir, no se mostraba nada.
--
-- Fix: get_sales_history ahora devuelve, por fila:
--   item_count  = suma de cantidades de la venta (paridad con el totalQty del detalle)
--   item_icons  = ícono de CATEGORÍA (categories.icon/.icon_color vía products.category_id)
--                 de los primeros 4 items, ordenados por sale_items.id. icon puede ser
--                 null (item sin categoría) y el cliente lo omite, igual que el detalle.
--
-- El summary, los filtros, el keyset y los grants no cambian.

CREATE OR REPLACE FUNCTION public.get_sales_history(
  p_business_id       uuid,
  p_from              timestamptz,
  p_to                timestamptz,
  p_method            text        DEFAULT NULL,
  p_operator_id       uuid        DEFAULT NULL,
  p_search            text        DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id         uuid        DEFAULT NULL,
  p_limit             integer     DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_owner   uuid    := '00000000-0000-0000-0000-000000000000';
  v_search  text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_first   boolean := (p_before_id IS NULL);
  v_data    jsonb;
  v_total   integer;
  v_summary jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  -- Página (keyset). El método se resuelve solo para las filas devueltas.
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC, d.id DESC), '[]'::jsonb)
  INTO v_data
  FROM (
    SELECT
      s.id, s.created_at, s.subtotal, s.discount, s.total, s.status,
      (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) AS method,
      o.name AS operator_name,
      (SELECT COALESCE(SUM(si.quantity), 0)::int
         FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
      (SELECT COALESCE(jsonb_agg(ic.obj ORDER BY ic.ord), '[]'::jsonb)
         FROM (
           SELECT jsonb_build_object('icon', cat.icon, 'color', cat.icon_color) AS obj, si.id AS ord
           FROM sale_items si
           LEFT JOIN products pr   ON pr.id  = si.product_id
           LEFT JOIN categories cat ON cat.id = pr.category_id
           WHERE si.sale_id = s.id
           ORDER BY si.id
           LIMIT 4
         ) ic) AS item_icons
    FROM sales s
    LEFT JOIN operators o ON o.id = s.operator_id
    WHERE s.business_id = p_business_id
      AND s.created_at >= p_from
      AND s.created_at <= p_to
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = v_owner AND s.operator_id IS NULL)
        OR s.operator_id = p_operator_id
      )
      AND (
        v_search IS NULL
        OR s.id::text ILIKE '%' || v_search || '%'
        OR s.total::text ILIKE '%' || v_search || '%'
        OR o.name ILIKE '%' || v_search || '%'
        OR EXISTS (
          SELECT 1 FROM sale_items si
          JOIN products pr ON pr.id = si.product_id
          WHERE si.sale_id = s.id AND pr.name ILIKE '%' || v_search || '%'
        )
      )
      AND (
        p_method IS NULL
        OR (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) = p_method
      )
      AND (
        p_before_id IS NULL
        OR (s.created_at, s.id) < (p_before_created_at, p_before_id)
      )
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT v_limit
  ) d;

  IF v_first THEN
    WITH base AS (
      SELECT
        s.total,
        (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) AS method
      FROM sales s
      LEFT JOIN operators o ON o.id = s.operator_id
      WHERE s.business_id = p_business_id
        AND s.created_at >= p_from
        AND s.created_at <= p_to
        AND (
          p_operator_id IS NULL
          OR (p_operator_id = v_owner AND s.operator_id IS NULL)
          OR s.operator_id = p_operator_id
        )
        AND (
          v_search IS NULL
          OR s.id::text ILIKE '%' || v_search || '%'
          OR s.total::text ILIKE '%' || v_search || '%'
          OR o.name ILIKE '%' || v_search || '%'
          OR EXISTS (
            SELECT 1 FROM sale_items si
            JOIN products pr ON pr.id = si.product_id
            WHERE si.sale_id = s.id AND pr.name ILIKE '%' || v_search || '%'
          )
        )
        AND (
          p_method IS NULL
          OR (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) = p_method
        )
    )
    SELECT
      COUNT(*)::integer,
      jsonb_build_object(
        'count', COUNT(*),
        'total_revenue', COALESCE(SUM(total), 0),
        'top_method', (
          SELECT method FROM base
          WHERE method IS NOT NULL
          GROUP BY method ORDER BY COUNT(*) DESC LIMIT 1
        )
      )
    INTO v_total, v_summary
    FROM base;
  END IF;

  RETURN jsonb_build_object(
    'data', v_data,
    'total', v_total,
    'summary', v_summary
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_sales_history(uuid, timestamptz, timestamptz, text, uuid, text, timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_history(uuid, timestamptz, timestamptz, text, uuid, text, timestamptz, uuid, integer) TO authenticated;
