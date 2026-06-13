-- ============================================================
-- Higiene: revocar el EXECUTE redundante de PUBLIC en las 3 RPC de lectura del
-- catálogo que aún lo tenían.
-- ============================================================
-- anon ya está concedido EXPLÍCITAMENTE en las tres → el catálogo público NO
-- cambia (verificado con SET ROLE anon: las tres se ejecutan sin permiso denegado).
-- Completa la uniformidad de grants que 20260613_03 (plan 004) dejó en
-- get_catalog_products / get_catalog_product_with_variants: todas las RPC del
-- catálogo quedan "anon explícito, sin PUBLIC".
--
-- El resto de funciones DEFINER con PUBLIC EXECUTE se mantiene A PROPÓSITO
-- (decisión documentada en 20260529_06):
--   - get_business_id(): las policies RLS la evalúan como rol anon en tablas de
--     lectura pública — revocarle PUBLIC/anon rompería esa lectura.
--   - bootstrap_new_user: el alta la invoca el cliente anon ANTES de iniciar sesión.
--   - set_updated_at / update_stock_on_sale / rls_auto_enable: trigger/event-trigger
--     fns, las dispara el motor; PostgREST no las expone como RPC.

REVOKE ALL ON FUNCTION public.get_catalog_categories(p_slug text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_catalog_default_variant_prices(p_slug text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_catalog_variant_filters(p_slug text) FROM PUBLIC;
