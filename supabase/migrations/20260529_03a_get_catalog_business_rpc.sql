-- 20260529_03a_get_catalog_business_rpc.sql
--
-- Auditoría de seguridad (docs/tests/08-auditoria-seguridad.md), fix parte c (1/2).
--
-- Hoy el catálogo público (anon) lee la tabla `businesses` directamente por slug. La policy
-- `public_read_businesses` permite a anon leer TODAS las filas y TODAS las columnas de
-- cualquier negocio (settings, tax_id, plan, timezone), no solo las públicas del catálogo.
--
-- Esta RPC expone únicamente las columnas públicas necesarias para renderizar el catálogo,
-- consistente con la regla 29 de CLAUDE.md (catálogo anon vía RPC, no query directa).
--
-- Parte aditiva y segura: crear la RPC. El cierre del acceso directo (drop policy + revoke
-- anon) va en 20260529_03b, que se aplica DESPUÉS de desplegar el código que usa esta RPC,
-- para no romper el catálogo en producción durante la ventana de deploy.

CREATE OR REPLACE FUNCTION public.get_catalog_business(p_slug text)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  logo_url text,
  whatsapp text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT b.id, b.name, b.description, b.logo_url, b.whatsapp
  FROM public.businesses b
  WHERE b.slug = p_slug
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_catalog_business(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_business(text) TO anon, authenticated;
