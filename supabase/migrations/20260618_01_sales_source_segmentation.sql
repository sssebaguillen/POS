-- ============================================================
-- Segmentación POS vs Pedido online (sales.source) en reporting
-- ============================================================
-- Reporting de SOLO LECTURA (no muta ventas/pagos/stock):
--   1) get_sales_history: nuevo filtro opcional p_source (NULL = todos los
--      canales) + la columna source en cada fila para el chip/export.
--   2) get_sales_by_source: split agregado pos vs catalog para /stats.
-- sales.source ∈ {'pos','catalog'} (default 'pos'). Las ventas históricas
-- pre-columna quedan como 'pos'; las convertidas desde pedidos del catálogo
-- se marcan 'catalog' (regla 33).

-- ------------------------------------------------------------
-- get_sales_history — agrega p_source + expone s.source en las filas
-- ------------------------------------------------------------
-- Se reemplaza la firma (se agrega p_source al final). DROP de la firma
-- anterior para no dejar un overload ambiguo en PostgREST.
DROP FUNCTION IF EXISTS public.get_sales_history(
  uuid, timestamptz, timestamptz, text, uuid, text, timestamptz, uuid, integer
);

CREATE OR REPLACE FUNCTION public.get_sales_history(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_method text DEFAULT NULL,
  p_operator_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_source text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_owner   uuid    := '00000000-0000-0000-0000-000000000000';
  v_search  text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_source  text    := NULLIF(btrim(COALESCE(p_source, '')), '');
  v_first   boolean := (p_before_id IS NULL);
  v_data    jsonb;
  v_total   integer;
  v_summary jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC, d.id DESC), '[]'::jsonb)
  INTO v_data
  FROM (
    SELECT
      s.id, s.created_at, s.subtotal, s.discount, s.total, s.status, s.source,
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
      AND (v_source IS NULL OR s.source = v_source)
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
        AND (v_source IS NULL OR s.source = v_source)
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
$$;

ALTER FUNCTION public.get_sales_history(
  uuid, timestamptz, timestamptz, text, uuid, text, timestamptz, uuid, integer, text
) OWNER TO postgres;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_sales_history(
  uuid, timestamptz, timestamptz, text, uuid, text, timestamptz, uuid, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_history(
  uuid, timestamptz, timestamptz, text, uuid, text, timestamptz, uuid, integer, text
) TO authenticated, service_role;

-- ------------------------------------------------------------
-- get_sales_by_source — split POS vs Pedido online para /stats
-- ------------------------------------------------------------
-- Mismas convenciones que get_stats_kpis / get_promo_impact: ventas
-- 'completed', fechas en la TZ local del negocio, params date.
CREATE OR REPLACE FUNCTION public.get_sales_by_source(
  p_business_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_result   jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  SELECT jsonb_build_object(
    'pos', jsonb_build_object(
      'count',   COALESCE(count(*)      FILTER (WHERE s.source = 'pos'), 0),
      'revenue', COALESCE(sum(s.total)  FILTER (WHERE s.source = 'pos'), 0)
    ),
    'catalog', jsonb_build_object(
      'count',   COALESCE(count(*)      FILTER (WHERE s.source = 'catalog'), 0),
      'revenue', COALESCE(sum(s.total)  FILTER (WHERE s.source = 'catalog'), 0)
    ),
    'total', jsonb_build_object(
      'count',   COALESCE(count(*), 0),
      'revenue', COALESCE(sum(s.total), 0)
    )
  ) INTO v_result
  FROM sales s
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
    AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to);

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_sales_by_source(uuid, date, date) OWNER TO postgres;

-- Regla 34
REVOKE ALL ON FUNCTION public.get_sales_by_source(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_source(uuid, date, date) TO authenticated, service_role;
