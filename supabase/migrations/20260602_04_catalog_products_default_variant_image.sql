-- get_catalog_products: la imagen del listado ahora sigue el mismo patrón que precio y stock
-- (referencian la variante default para productos con variantes). Antes devolvía siempre
-- p.image_url (el padre), lo que obligaba a cada ProductCard a hacer un fetch eager por card
-- (N+1 → riesgo de statement_timeout en la carga inicial). Además se agrega variant_count para
-- que el badge "N variantes" se renderice desde el payload inicial sin fetch.
-- Cambia la firma (columna nueva) → DROP + CREATE + re-grant. Catálogo público: anon autorizado (regla 29).

DROP FUNCTION IF EXISTS "public"."get_catalog_products"("p_slug" "text");

CREATE FUNCTION "public"."get_catalog_products"("p_slug" "text")
RETURNS TABLE("id" "uuid", "category_id" "uuid", "name" "text", "sale_price" numeric, "stock" integer, "image_url" "text", "has_variants" boolean, "brand_id" "uuid", "brand_name" "text", "variant_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT b.id INTO v_business_id
  FROM businesses b
  WHERE b.slug = p_slug;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.category_id,
    p.name,
    CASE
      WHEN p.has_variants AND pv_def.id IS NOT NULL THEN
        public.compute_effective_price(
          pv_def.cost::numeric,
          pv_def.price::numeric,
          pv_def.price::numeric,
          NULL,
          NULL,
          p.id,
          p.brand_id
        )
      ELSE
        public.compute_effective_price(
          p.cost::numeric,
          p.price::numeric,
          NULL,
          NULL,
          NULL,
          p.id,
          p.brand_id
        )
    END AS sale_price,
    CASE
      WHEN p.has_variants AND pv_def.id IS NOT NULL THEN pv_def.stock
      ELSE p.stock::integer
    END AS stock,
    CASE
      WHEN p.has_variants AND pv_def.id IS NOT NULL THEN COALESCE(pv_def.image_url, p.image_url)
      ELSE p.image_url
    END AS image_url,
    p.has_variants,
    p.brand_id,
    b_brand.name AS brand_name,
    CASE
      WHEN p.has_variants THEN (
        SELECT count(*)::int FROM product_variants pv
        WHERE pv.product_id = p.id AND pv.is_active = true
      )
      ELSE 0
    END AS variant_count
  FROM products p
  LEFT JOIN product_variants pv_def ON pv_def.id = p.default_variant_id
  LEFT JOIN brands b_brand ON b_brand.id = p.brand_id
  WHERE p.business_id    = v_business_id
    AND p.is_active      = true
    AND p.show_in_catalog = true
  ORDER BY p.name ASC;
END;
$$;

ALTER FUNCTION "public"."get_catalog_products"("p_slug" "text") OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."get_catalog_products"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_products"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_products"("p_slug" "text") TO "service_role";
