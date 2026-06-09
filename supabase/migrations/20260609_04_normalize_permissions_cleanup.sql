-- Rediseño de permisos de operario (Fase 4 — limpieza) — normalize_permissions a 8 keys puros.
--
-- F3 dejó todas las filas operators.permissions en shape canónico de 8 keys, y create/update_operator
-- normalizan al escribir. Por lo tanto la rama de compatibilidad bi-shape (que también leía los 11
-- flags viejos) ya no recibe nunca un shape viejo desde la DB. Se simplifica a leer solo las 8 keys
-- canónicas (clave faltante → false). El helper y las 24 guardas que lo invocan NO cambian.
--
-- Dirección de fallo segura: si por algún motivo apareciera una fila no-canónica, el helper devuelve
-- todo false → la guarda DENIEGA (fail-closed), nunca abre de más.
--
-- El espejo TS (lib/operator.ts normalizePermissions/parsePermissions) se simplificó igual; parsePermissions
-- rechaza cookies de shape viejo (→ re-selección de operador), así que tampoco hay shape viejo por el lado cliente.

CREATE OR REPLACE FUNCTION public.normalize_permissions(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'online_orders',    COALESCE((p->>'online_orders')::boolean, false),
    'pos_pricing',      COALESCE((p->>'pos_pricing')::boolean, false),
    'inventory_read',   COALESCE((p->>'inventory_read')::boolean, false),
    'inventory_write',  COALESCE((p->>'inventory_write')::boolean, false),
    'reports',          COALESCE((p->>'reports')::boolean, false),
    'expenses',         COALESCE((p->>'expenses')::boolean, false),
    'settings',         COALESCE((p->>'settings')::boolean, false),
    'manage_operators', COALESCE((p->>'manage_operators')::boolean, false)
  );
$$;

COMMENT ON FUNCTION public.normalize_permissions(jsonb) IS
  'Normaliza un JSONB de permisos de operario al shape canónico de 8 capacidades (clave faltante => false). Espejo SQL de normalizePermissions en lib/operator.ts. Fail-closed.';
