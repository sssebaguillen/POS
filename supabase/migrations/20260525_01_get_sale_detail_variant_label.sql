-- Add variant_label to get_sale_detail items so the POS Historial and
-- Dashboard Sales History expanded views can show which variant was sold.

CREATE OR REPLACE FUNCTION public.get_sale_detail(p_sale_id uuid, p_business_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_result json;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales
    WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Sale not found');
  END IF;

  SELECT json_build_object(
    'success',        true,
    'operator_name',  COALESCE(direct_op.name, session_op.name),
    'payment_method', pay.method,
    'items', (
      SELECT json_agg(json_build_object(
        'id',                    si.id,
        'product_id',            si.product_id,
        'variant_id',            si.variant_id,
        'variant_label',         (
          SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
          FROM public.product_variant_option_values pvov
          JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
          JOIN public.product_options po        ON po.id  = pov.option_id
          WHERE pvov.variant_id = si.variant_id
        ),
        'product_name',          COALESCE(p.name, si.free_line_description, 'Producto eliminado'),
        'product_icon',          cat.icon,
        'product_icon_color',    cat.icon_color,
        'quantity',              si.quantity,
        'unit_price',            si.unit_price,
        'free_line_description', si.free_line_description
      ) ORDER BY si.id)
      FROM sale_items si
      LEFT JOIN products p     ON p.id = si.product_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE si.sale_id = p_sale_id
    )
  )
  INTO v_result
  FROM sales s
  LEFT JOIN operators direct_op  ON direct_op.id = s.operator_id
  LEFT JOIN cash_sessions cs     ON cs.id = s.session_id
  LEFT JOIN operators session_op ON session_op.id = cs.opened_by
  LEFT JOIN LATERAL (
    SELECT method FROM payments
    WHERE sale_id = p_sale_id
    ORDER BY created_at DESC
    LIMIT 1
  ) pay ON true
  WHERE s.id = p_sale_id;

  RETURN v_result;
END;
$function$;
