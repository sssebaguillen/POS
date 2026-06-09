-- Paridad de redondeo POS ↔ catálogo (regla 11 de CLAUDE.md).
-- compute_effective_price es el espejo SQL de calculateProductPrice. La rama de lista
-- (costo × multiplicador) devolvía ROUND(x, 2) sin aplicar el rounding_step de la lista,
-- mientras el cliente (applyRounding en src/lib/price-lists.ts) sí lo aplica.
--
-- Hoy es inerte: todos los callers SQL pasan p_list_id = NULL (catálogo y
-- create_catalog_order muestran precio base), así que la rama de lista no corre. Pero el
-- día que se implemente "elegir qué lista mostrar en el catálogo", el caller pasaría una
-- lista activa y el catálogo redondearía distinto que el POS. Se cierra el gap ahora:
-- la función busca rounding_step/rounding_up por p_list_id (sin cambiar la firma) y replica
-- exactamente applyRounding del cliente.

CREATE OR REPLACE FUNCTION "public"."compute_effective_price"("p_cost" numeric, "p_price" numeric, "p_variant_price" numeric, "p_list_id" "uuid", "p_list_multiplier" numeric, "p_product_id" "uuid", "p_brand_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_mult numeric;
  v_raw  numeric;
  v_step numeric;
  v_up   boolean;
BEGIN
  IF p_list_id IS NULL THEN
    IF p_variant_price IS NOT NULL AND p_variant_price > 0 THEN
      RETURN ROUND(p_variant_price, 2);
    END IF;
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  IF COALESCE(p_cost, 0) <= 0 THEN
    IF p_variant_price IS NOT NULL AND p_variant_price > 0 THEN
      RETURN ROUND(p_variant_price, 2);
    END IF;
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  SELECT plo.multiplier INTO v_mult
  FROM public.price_list_overrides plo
  WHERE plo.price_list_id = p_list_id
    AND plo.product_id = p_product_id
  LIMIT 1;

  IF v_mult IS NULL AND p_brand_id IS NOT NULL THEN
    SELECT plo.multiplier INTO v_mult
    FROM public.price_list_overrides plo
    WHERE plo.price_list_id = p_list_id
      AND plo.product_id IS NULL
      AND plo.brand_id = p_brand_id
    LIMIT 1;
  END IF;

  v_mult := COALESCE(v_mult, p_list_multiplier);
  v_raw  := p_cost * v_mult;

  -- Redondeo por lista — espejo de applyRounding (src/lib/price-lists.ts).
  SELECT pl.rounding_step, pl.rounding_up INTO v_step, v_up
  FROM public.price_lists pl
  WHERE pl.id = p_list_id;

  IF v_step IS NULL OR v_step <= 0 THEN
    RETURN ROUND(v_raw, 2);
  END IF;

  IF COALESCE(v_up, false) THEN
    RETURN ROUND(CEIL(v_raw / v_step) * v_step, 2);
  ELSE
    RETURN ROUND(ROUND(v_raw / v_step) * v_step, 2);
  END IF;
END;
$$;
