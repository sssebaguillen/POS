-- Rediseño de permisos de operario (Fase 1b) — guardas leen vía normalize_permissions.
--
-- Las 24 guardas SECURITY DEFINER que hacen cumplir permisos (regla 32/34) pasan a leer
-- el permiso a través de normalize_permissions(...) (Fase 1a, 20260609_01), que acepta
-- cualquier shape. Esto deja el backend TOLERANTE antes de migrar datos (Fase 2): nunca
-- pierde la capacidad de leer un permiso válido, así que no hay ventana de fail-open.
--
-- Mapeo de las 5 sustituciones (key vieja -> canónica). Cada guarda tiene la forma
-- `... permissions->>'<key>', role ...` (o el caso inline de price_override), anclada con
-- `, role` para NO tocar el back-fill de defaults de create_operator (eso es Fase 2):
--   stock_write       -> inventory_write   (16 RPCs)
--   price_lists_write -> inventory_write   ( 3 RPCs)
--   operators_write   -> manage_operators  ( 3 RPCs)
--   sales             -> online_orders     ( 1 RPC: update_catalog_order_status)
--   price_override    -> pos_pricing       ( 1 RPC: create_sale_transaction, expr inline)
--
-- Se aplica re-creando cada función con su cuerpo verbatim (pg_get_functiondef) + las
-- sustituciones — generación mecánica, sin transcripción a mano. Idempotente: el filtro
-- LIKE solo toma funciones que aún tienen una guarda vieja, y re-correr es no-op.
-- CREATE OR REPLACE preserva grants y ownership. El diff explícito por función vive en
-- supabase/schema.sql.
--
-- Requiere 20260609_01 (normalize_permissions) aplicado antes.

DO $$
DECLARE
  v_oids      oid[];
  v_oid       oid;
  v_remaining int;
BEGIN
  SELECT array_agg(p.oid) INTO v_oids
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (pg_get_functiondef(p.oid) LIKE '%permissions->>''stock_write'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%permissions->>''price_lists_write'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%permissions->>''operators_write'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%permissions->>''sales'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%(v_actor_permissions->>''price_override'')%');

  IF v_oids IS NULL THEN
    RAISE NOTICE 'Fase 1b: no hay guardas viejas que transformar (ya aplicado?)';
    RETURN;
  END IF;

  FOREACH v_oid IN ARRAY v_oids LOOP
    EXECUTE replace(replace(replace(replace(replace(
      pg_get_functiondef(v_oid),
      'permissions->>''stock_write'', role',        'normalize_permissions(permissions)->>''inventory_write'', role'),
      'permissions->>''price_lists_write'', role',  'normalize_permissions(permissions)->>''inventory_write'', role'),
      'permissions->>''operators_write'', role',    'normalize_permissions(permissions)->>''manage_operators'', role'),
      'permissions->>''sales'', role',              'normalize_permissions(permissions)->>''online_orders'', role'),
      '(v_actor_permissions->>''price_override'')', '(normalize_permissions(v_actor_permissions)->>''pos_pricing'')');
  END LOOP;

  -- Auto-verificación: ninguna guarda vieja debe sobrevivir.
  SELECT count(*) INTO v_remaining
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (pg_get_functiondef(p.oid) LIKE '%permissions->>''stock_write'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%permissions->>''price_lists_write'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%permissions->>''operators_write'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%permissions->>''sales'', role%'
      OR pg_get_functiondef(p.oid) LIKE '%(v_actor_permissions->>''price_override'')%');

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Fase 1b abortada: % guarda(s) no se transformaron', v_remaining;
  END IF;

  RAISE NOTICE 'Fase 1b OK: % funcion(es) re-creadas con normalize_permissions', array_length(v_oids, 1);
END $$;
