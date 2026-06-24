-- ============================================================
-- get_customers_list — lista de clientes paginada server-side (solo lectura)
-- ============================================================
-- (app)/customers/page.tsx cargaba TODOS los clientes sin .limit()/.range() y
-- CustomerView filtraba/buscaba/ordenaba/paginaba in-memory → pasado el max-rows
-- de PostgREST la lista traía un subconjunto EN SILENCIO (un deudor podría no
-- aparecer: incorrecto, no sólo lento).
--
-- Esta RPC mueve al server la búsqueda, el filtro de crédito y el orden, y
-- pagina por limit/offset (offset alcanza y es más simple que cursor para una
-- lista de clientes). Devuelve la página + el total filtrado para el "Cargar más".
--
-- Filtro de crédito: la UI tiene UN grupo de chips de 4 estados
-- (Todos/Habilitado/Deshabilitado/Con deuda). Se modela como un solo
-- p_credit_filter text en vez de un bool, porque una vez que la paginación es
-- server-side TODOS los estados deben resolverse en el server (filtrar una sola
-- página en memoria rompería Habilitado/Deshabilitado entre páginas).
--
-- Regla 34: assert_tenant + REVOKE PUBLIC/anon + GRANT authenticated.

CREATE OR REPLACE FUNCTION public.get_customers_list(
  p_business_id uuid,
  p_search text DEFAULT NULL,
  p_credit_filter text DEFAULT 'all',  -- 'all' | 'enabled' | 'disabled' | 'with_debt'
  p_sort text DEFAULT 'name',          -- 'name' | 'debt_desc'
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_filter text    := COALESCE(NULLIF(btrim(p_credit_filter), ''), 'all');
  v_sort   text    := COALESCE(NULLIF(btrim(p_sort), ''), 'name');
  v_data   jsonb;
  v_total  integer;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  WITH filtered AS (
    SELECT
      c.id, c.business_id, c.name, c.phone, c.email, c.dni,
      c.credit_balance, c.credit_limit, c.is_credit_enabled, c.notes, c.created_at
    FROM customers c
    WHERE c.business_id = p_business_id
      AND c.deleted_at IS NULL
      AND (v_filter <> 'enabled'   OR c.is_credit_enabled = true)
      AND (v_filter <> 'disabled'  OR c.is_credit_enabled = false)
      AND (v_filter <> 'with_debt' OR c.credit_balance > 0)
      AND (
        v_search IS NULL
        OR c.name ILIKE '%' || v_search || '%'
        OR c.phone ILIKE '%' || v_search || '%'
        OR c.dni ILIKE '%' || v_search || '%'
      )
  )
  SELECT
    (SELECT COUNT(*)::integer FROM filtered),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(d))
      FROM (
        SELECT *
        FROM filtered
        ORDER BY
          (CASE WHEN v_sort = 'debt_desc' THEN credit_balance ELSE NULL END) DESC NULLS LAST,
          lower(name) ASC,
          id ASC
        LIMIT v_limit OFFSET v_offset
      ) d
    ), '[]'::jsonb)
  INTO v_total, v_data;

  RETURN jsonb_build_object('data', v_data, 'total', v_total);
END;
$$;

ALTER FUNCTION public.get_customers_list(uuid, text, text, text, integer, integer) OWNER TO postgres;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_customers_list(uuid, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customers_list(uuid, text, text, text, integer, integer) TO authenticated, service_role;
