-- get_catalog_products: el precio de un producto con variantes ahora es el MÍNIMO
-- efectivo entre sus variantes activas (la UI lo muestra como "Desde $X"), no el de
-- la variante default — que puede ser la más cara y mostraba un "precio representativo"
-- engañoso. Imagen y stock siguen a la variante default (sin cambios).
--
-- La promo unitaria se aplica DESPUÉS sobre ese mínimo: apply_unit_promo es monótona
-- (percent lineal, offer_price = LEAST), así que promo(min base) = min(promo(base)).
-- Fallback: si ninguna variante activa resuelve a precio > 0, se mantiene el
-- comportamiento anterior (variante default → producto padre).
--
-- RETURNS TABLE sin cambios → CREATE OR REPLACE (conserva grants de 20260610_01).

CREATE OR REPLACE FUNCTION public.get_catalog_products(p_slug text)
RETURNS TABLE(
  id uuid,
  category_id uuid,
  name text,
  sale_price numeric,
  stock integer,
  image_url text,
  has_variants boolean,
  brand_id uuid,
  brand_name text,
  variant_count integer,
  original_price numeric,
  promo_kind text,
  promo_percent numeric,
  promo_group_size integer,
  promo_affected_units integer,
  promo_pay_percent numeric,
  promo_ends_at timestamptz,
  promo_featured boolean
)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
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
    base.id,
    base.category_id,
    base.name,
    public.apply_unit_promo(fp.kind, fp.percent, fp.offer_price, base.base_price) AS sale_price,
    base.stock,
    base.image_url,
    base.has_variants,
    base.brand_id,
    base.brand_name,
    base.variant_count,
    CASE
      WHEN fp.id IS NOT NULL
       AND public.apply_unit_promo(fp.kind, fp.percent, fp.offer_price, base.base_price) < base.base_price
      THEN base.base_price
    END AS original_price,
    fp.kind AS promo_kind,
    fp.percent AS promo_percent,
    fp.group_size AS promo_group_size,
    fp.affected_units AS promo_affected_units,
    fp.pay_percent AS promo_pay_percent,
    fp.ends_at AS promo_ends_at,
    CASE WHEN fp.id IS NOT NULL THEN fp.show_in_catalog END AS promo_featured
  FROM (
    SELECT
      p.id,
      p.category_id,
      p.name,
      CASE
        WHEN p.has_variants THEN
          COALESCE(
            (SELECT MIN(ep.price)
             FROM (
               SELECT public.compute_effective_price(
                 pv.cost::numeric, pv.price::numeric, pv.price::numeric,
                 NULL, NULL, p.id, p.brand_id) AS price
               FROM product_variants pv
               WHERE pv.product_id = p.id AND pv.is_active = true
             ) ep
             WHERE ep.price > 0),
            CASE
              WHEN pv_def.id IS NOT NULL THEN
                public.compute_effective_price(
                  pv_def.cost::numeric, pv_def.price::numeric, pv_def.price::numeric,
                  NULL, NULL, p.id, p.brand_id)
              ELSE
                public.compute_effective_price(
                  p.cost::numeric, p.price::numeric, NULL,
                  NULL, NULL, p.id, p.brand_id)
            END
          )
        ELSE
          public.compute_effective_price(
            p.cost::numeric, p.price::numeric, NULL,
            NULL, NULL, p.id, p.brand_id)
      END AS base_price,
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
  ) base
  LEFT JOIN LATERAL public.find_applicable_promotion(v_business_id, base.id, base.category_id, base.brand_id) fp ON true
  ORDER BY base.name ASC;
END;
$$;
