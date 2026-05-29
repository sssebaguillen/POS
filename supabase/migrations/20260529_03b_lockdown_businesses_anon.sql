-- 20260529_03b_lockdown_businesses_anon.sql
--
-- Auditoría de seguridad (docs/tests/08-auditoria-seguridad.md), fix parte c (2/2).
--
-- ⚠️ APLICAR SOLO DESPUÉS de desplegar el código que usa get_catalog_business (migración
-- 20260529_03a). Antes del deploy, el catálogo público lee `businesses` directamente como
-- anon; si se cierra el acceso antes, el catálogo en producción se rompe (notFound).
--
-- Cierra el acceso directo de anon a la tabla `businesses`:
--   * La policy `public_read_businesses` permitía a anon leer TODAS las filas y columnas de
--     cualquier negocio. Se elimina. Las lecturas del owner autenticado siguen cubiertas por
--     la policy `tenant_isolation` (ALL, id = get_business_id()), que incluye SELECT.
--   * Se revoca el SELECT directo de anon sobre la tabla (defensa en profundidad; con RLS y
--     sin policy que matchee anon ya devolvería 0 filas, pero quitamos también el grant).
--
-- El catálogo público pasa a leer vía get_catalog_business (SECURITY DEFINER, solo columnas
-- públicas), consistente con la regla 29 de CLAUDE.md.

DROP POLICY IF EXISTS public_read_businesses ON public.businesses;

REVOKE SELECT ON public.businesses FROM anon;
