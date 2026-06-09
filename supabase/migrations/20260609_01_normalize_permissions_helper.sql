-- Rediseño de permisos de operario (Fase 1a) — helper de normalización.
--
-- Contexto: se consolidan los 11 flags planos de permisos a 8 keys canónicas
-- agrupadas en 4 áreas (ver docs/todo/permisos-operario-redesign.md). El rename/merge
-- toca ~24 guardas SECURITY DEFINER que leen los flags por nombre; para evitar un
-- fail-open silencioso durante la transición, las guardas pasan a leer el permiso a
-- través de este helper (Fase 1b), que acepta CUALQUIER shape (viejo, nuevo o mixto)
-- y devuelve siempre las 8 keys canónicas.
--
-- Propiedades validadas (truth table, 2026-06-09):
--   - merge correcto (inventory_write = stock_write OR price_lists_write OR inventory_write)
--   - idempotente (un shape ya-nuevo se devuelve igual)
--   - fail-closed (key ausente => false; nunca abre por omisión)
--
-- Es una función PURA (no toca tablas, no usa auth): IMMUTABLE, sin SECURITY DEFINER.
-- No expone datos => no requiere el endurecimiento de grants de la regla 34.

CREATE OR REPLACE FUNCTION public.normalize_permissions(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'online_orders',
      COALESCE((p->>'sales')::boolean, false)
        OR COALESCE((p->>'online_orders')::boolean, false),
    'pos_pricing',
      COALESCE((p->>'price_override')::boolean, false)
        OR COALESCE((p->>'free_line')::boolean, false)
        OR COALESCE((p->>'pos_pricing')::boolean, false),
    'inventory_read',
      COALESCE((p->>'stock')::boolean, false)
        OR COALESCE((p->>'price_lists')::boolean, false)
        OR COALESCE((p->>'inventory_read')::boolean, false),
    'inventory_write',
      COALESCE((p->>'stock_write')::boolean, false)
        OR COALESCE((p->>'price_lists_write')::boolean, false)
        OR COALESCE((p->>'inventory_write')::boolean, false),
    'reports',
      COALESCE((p->>'analysis')::boolean, false)
        OR COALESCE((p->>'reports')::boolean, false),
    'expenses',
      COALESCE((p->>'expenses')::boolean, false),
    'settings',
      COALESCE((p->>'settings')::boolean, false),
    'manage_operators',
      COALESCE((p->>'operators_write')::boolean, false)
        OR COALESCE((p->>'manage_operators')::boolean, false)
  );
$$;

COMMENT ON FUNCTION public.normalize_permissions(jsonb) IS
  'Normaliza un JSONB de permisos de operario (cualquier shape: 11-flags viejo, 8-keys nuevo o mixto) a las 8 keys canónicas. Espejo SQL de la normalización de lib/operator.ts. Puro/idempotente/fail-closed.';
