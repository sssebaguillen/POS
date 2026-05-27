-- Extend get_mercaderia_expense_items to return current stock per line.
--
-- The Edit-expense panel needs the current stock to render the "Stock: X → Y"
-- preview as the user adjusts quantities. For variant lines, stock comes from
-- product_variants; for product-level lines, from products.
--
-- DROP first because we're changing the RETURNS TABLE signature (adding a column).

DROP FUNCTION IF EXISTS public.get_mercaderia_expense_items(uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_mercaderia_expense_items(p_expense_id uuid, p_business_id uuid)
RETURNS TABLE (
  id            uuid,
  product_id    uuid,
  product_name  text,
  variant_id    uuid,
  variant_label text,
  quantity      integer,
  unit_cost     numeric,
  update_cost   boolean,
  stock         integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ei.id,
    ei.product_id,
    ei.product_name,
    ei.variant_id,
    CASE WHEN ei.variant_id IS NOT NULL THEN (
      SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
      FROM public.product_variant_option_values pvov
      JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
      JOIN public.product_options po        ON po.id  = pov.option_id
      WHERE pvov.variant_id = ei.variant_id
    ) END,
    ei.quantity,
    ei.unit_cost,
    ei.update_cost,
    COALESCE(
      CASE WHEN ei.variant_id IS NOT NULL
        THEN (SELECT pv.stock FROM public.product_variants pv WHERE pv.id = ei.variant_id)
        ELSE (SELECT p.stock  FROM public.products p          WHERE p.id  = ei.product_id)
      END,
      0
    ) AS stock
  FROM public.expense_items ei
  WHERE ei.expense_id = p_expense_id
    AND ei.business_id = p_business_id
  ORDER BY ei.id;
$$;
