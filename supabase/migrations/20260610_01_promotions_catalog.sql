-- Promociones — F4: catálogo público. Plan: docs/todo/promotions.md
--
-- 1. get_catalog_products: sale_price ya viene con la promo unitaria aplicada;
--    se agregan original_price (para tachado) + campos crudos de la promo
--    (el label lo arma el cliente con promoBadgeLabel — una sola implementación).
-- 2. get_catalog_product_with_variants: ídem para el detalle y el selector de
--    variantes (precio de cada variante con promo + original_price + objeto promo).
-- 3. create_catalog_order: aplica la promo server-side al re-preciar (crítico:
--    sin esto el catálogo mostraría oferta pero cobraría precio lleno) y
--    persiste promotion_id/promo_discount en catalog_order_items.
-- 4. update_catalog_order_status: passthrough de promotion_id/promo_discount
--    en la conversión a venta (create_sale_transaction ya los valida/guarda).

-- ============================================================
-- 1. get_catalog_products (cambia el RETURNS TABLE → DROP + re-grant)
-- ============================================================

DROP FUNCTION IF EXISTS public.get_catalog_products(text);

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
        WHEN p.has_variants AND pv_def.id IS NOT NULL THEN
          public.compute_effective_price(
            pv_def.cost::numeric, pv_def.price::numeric, pv_def.price::numeric,
            NULL, NULL, p.id, p.brand_id)
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

REVOKE ALL ON FUNCTION public.get_catalog_products(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_products(text) TO anon, authenticated, service_role;

-- ============================================================
-- 2. get_catalog_product_with_variants
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_catalog_product_with_variants(p_slug text, p_product_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id     uuid;
  v_product         record;
  v_promo           public.promotions;
  v_base_price      numeric;
  v_computed_price  numeric;
  v_options_json    json;
  v_variants_json   json;
BEGIN
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Negocio no encontrado');
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND business_id = v_business_id
    AND is_active = true
    AND show_in_catalog = true
  LIMIT 1;

  IF v_product IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  v_promo := public.find_applicable_promotion(v_business_id, v_product.id, v_product.category_id, v_product.brand_id);

  v_base_price := public.compute_effective_price(
    v_product.cost::numeric,
    v_product.price::numeric,
    NULL,
    NULL,
    NULL,
    v_product.id,
    v_product.brand_id
  );
  v_computed_price := public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, v_base_price);

  SELECT json_agg(
    json_build_object(
      'id',                opt.id,
      'attribute_type_id', opt.attribute_type_id,
      'name',              opt.name,
      'position',          opt.position,
      'values', (
        SELECT json_agg(
          json_build_object(
            'id',       pov.id,
            'value',    pov.value,
            'position', pov.position
          ) ORDER BY pov.position
        )
        FROM public.product_option_values pov
        WHERE pov.option_id = opt.id
      )
    ) ORDER BY opt.position
  )
  INTO v_options_json
  FROM public.product_options opt
  WHERE opt.product_id = p_product_id
    AND opt.business_id = v_business_id;

  SELECT json_agg(
    json_build_object(
      'id',          pv.id,
      'price',       public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, pv_base.price),
      'original_price', CASE
                          WHEN public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, pv_base.price) < pv_base.price
                          THEN pv_base.price
                        END,
      'stock',       pv.stock,
      'image_url',   pv.image_url,
      'is_active',   pv.is_active,
      'is_in_stock', pv.stock > 0,
      'option_values', (
        SELECT json_agg(
          json_build_object(
            'option_id',       po.id,
            'option_value_id', pov.id,
            'value',           pov.value
          ) ORDER BY po.position
        )
        FROM public.product_variant_option_values pvov
        JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
        JOIN public.product_options po ON po.id = pov.option_id
        WHERE pvov.variant_id = pv.id
      )
    ) ORDER BY pv.id
  )
  INTO v_variants_json
  FROM public.product_variants pv
  CROSS JOIN LATERAL (
    SELECT public.compute_effective_price(
      pv.cost::numeric,
      pv.price::numeric,
      pv.price::numeric,
      NULL,
      NULL,
      v_product.id,
      v_product.brand_id
    ) AS price
  ) pv_base
  WHERE pv.product_id = p_product_id
    AND pv.business_id = v_business_id
    AND pv.is_active = true;

  RETURN json_build_object(
    'success', true,
    'product', json_build_object(
      'id',             v_product.id,
      'name',           v_product.name,
      'stock',          v_product.stock,
      'image_url',      v_product.image_url,
      'has_variants',   v_product.has_variants,
      'computed_price', v_computed_price,
      'original_price', CASE WHEN v_computed_price < v_base_price THEN v_base_price END,
      'promo', CASE WHEN v_promo.id IS NOT NULL THEN json_build_object(
        'kind',           v_promo.kind,
        'percent',        v_promo.percent,
        'group_size',     v_promo.group_size,
        'affected_units', v_promo.affected_units,
        'pay_percent',    v_promo.pay_percent,
        'ends_at',        v_promo.ends_at,
        'featured',       v_promo.show_in_catalog
      ) END
    ),
    'options',  COALESCE(v_options_json, '[]'::json),
    'variants', COALESCE(v_variants_json, '[]'::json)
  );
END;
$$;

-- ============================================================
-- 3. create_catalog_order — promo aplicada server-side
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_catalog_order(
  p_slug text, p_customer_name text, p_phone text, p_delivery_type text,
  p_address text, p_notes text, p_items jsonb, p_client_ip inet DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid; v_list_id uuid; v_list_mult numeric;
  v_normalized_phone text; v_order_number int; v_order_id uuid;
  v_subtotal numeric := 0; v_total numeric := 0;
  v_item jsonb; v_product record;
  v_variant_id uuid; v_variant_price numeric; v_variant_cost numeric;
  v_variant_image text; v_variant_active boolean;
  v_unit_price numeric; v_quantity int; v_line_total numeric;
  v_product_name text; v_variant_label text; v_image_url text;
  v_pending_count int;
  v_new_data jsonb;
  v_promo public.promotions;
  v_base_unit numeric;
  v_promo_id uuid;
  v_promo_discount numeric;
BEGIN
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_slug'); END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_name'); END IF;
  v_normalized_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_normalized_phone) < 8 OR length(v_normalized_phone) > 20 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_phone'); END IF;
  IF p_delivery_type NOT IN ('takeaway','delivery') THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_delivery_type'); END IF;
  IF p_delivery_type = 'delivery' AND (p_address IS NULL OR btrim(p_address) = '') THEN RETURN jsonb_build_object('success', false, 'error', 'address_required'); END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'empty_cart'); END IF;
  IF jsonb_array_length(p_items) > 50 THEN RETURN jsonb_build_object('success', false, 'error', 'too_many_items'); END IF;

  SELECT b.id INTO v_business_id FROM businesses b WHERE b.slug = btrim(p_slug);
  IF v_business_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'business_not_found'); END IF;

  IF EXISTS (SELECT 1 FROM catalog_phone_blacklist WHERE business_id = v_business_id AND phone = v_normalized_phone) THEN
    RETURN jsonb_build_object('success', false, 'error', 'blacklisted');
  END IF;

  SELECT count(*) INTO v_pending_count FROM catalog_orders
   WHERE business_id = v_business_id AND customer_phone = v_normalized_phone
     AND status = 'recibido' AND created_at > now() - interval '1 hour';
  IF v_pending_count >= 3 THEN RETURN jsonb_build_object('success', false, 'error', 'too_many_pending'); END IF;

  v_list_id := NULL;
  v_list_mult := NULL;

  INSERT INTO catalog_order_counters (business_id, last_number) VALUES (v_business_id, 1)
   ON CONFLICT (business_id) DO UPDATE SET last_number = catalog_order_counters.last_number + 1
   RETURNING last_number INTO v_order_number;

  INSERT INTO catalog_orders (
    business_id, order_number, customer_name, customer_phone,
    delivery_type, address, notes, subtotal, total, client_ip
  ) VALUES (
    v_business_id, v_order_number, left(btrim(p_customer_name), 120), v_normalized_phone,
    p_delivery_type, NULLIF(left(btrim(p_address), 300), ''), NULLIF(left(btrim(p_notes), 1000), ''),
    0, 0, p_client_ip
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := LEAST(GREATEST(FLOOR(COALESCE((v_item->>'quantity')::numeric, 0)), 0), 1000)::int;
    IF v_quantity <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_product FROM products
     WHERE id = NULLIF(v_item->>'product_id','')::uuid AND business_id = v_business_id
       AND is_active = true AND show_in_catalog = true;
    IF v_product.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'product_not_available'); END IF;

    v_variant_id    := NULL;
    v_variant_label := NULL;
    v_image_url     := v_product.image_url;

    IF v_item ? 'variant_id' AND NULLIF(v_item->>'variant_id','') IS NOT NULL THEN
      SELECT id, price, cost, image_url, is_active
        INTO v_variant_id, v_variant_price, v_variant_cost, v_variant_image, v_variant_active
        FROM product_variants
       WHERE id = (v_item->>'variant_id')::uuid AND product_id = v_product.id
         AND business_id = v_business_id AND is_active = true;
      IF v_variant_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'variant_not_available'); END IF;
      IF v_variant_image IS NOT NULL THEN v_image_url := v_variant_image; END IF;

      SELECT string_agg(pov.value, ' / ' ORDER BY po.position) INTO v_variant_label
       FROM product_variant_option_values pvov
       JOIN product_option_values pov ON pov.id = pvov.option_value_id
       JOIN product_options po ON po.id = pov.option_id
      WHERE pvov.variant_id = v_variant_id;

      v_unit_price := compute_effective_price(
        v_variant_cost, v_variant_price, v_variant_price,
        v_list_id, v_list_mult, v_product.id, v_product.brand_id);
    ELSE
      v_unit_price := compute_effective_price(
        v_product.cost::numeric, v_product.price::numeric, NULL,
        v_list_id, v_list_mult, v_product.id, v_product.brand_id);
    END IF;

    -- Promo: el precio del catálogo es promesa — el checkout DEBE re-preciar igual.
    -- Unitaria baja el unitario; cantidad descuenta a nivel línea (2x1, 3x2, 2da al X%).
    v_promo_id := NULL;
    v_promo_discount := 0;
    v_promo := find_applicable_promotion(v_business_id, v_product.id, v_product.category_id, v_product.brand_id);
    IF v_promo.id IS NOT NULL THEN
      IF v_promo.kind = 'quantity' THEN
        v_promo_discount := compute_quantity_promo_discount(
          v_promo.group_size, v_promo.affected_units, v_promo.pay_percent, v_unit_price, v_quantity);
        IF v_promo_discount > 0 THEN v_promo_id := v_promo.id; END IF;
      ELSE
        v_base_unit := v_unit_price;
        v_unit_price := apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, v_unit_price);
        IF v_unit_price < v_base_unit THEN
          v_promo_id := v_promo.id;
          v_promo_discount := ROUND((v_base_unit - v_unit_price) * v_quantity, 2);
        END IF;
      END IF;
    END IF;

    v_product_name := v_product.name;
    v_line_total := ROUND(v_unit_price * v_quantity, 2)
      - CASE WHEN v_promo_id IS NOT NULL AND v_promo.kind = 'quantity' THEN v_promo_discount ELSE 0 END;
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO catalog_order_items (
      order_id, product_id, product_name, variant_id, variant_label,
      quantity, unit_price, line_total, image_url,
      promotion_id, promo_discount
    ) VALUES (
      v_order_id, v_product.id, v_product_name,
      v_variant_id, v_variant_label,
      v_quantity, v_unit_price, v_line_total, v_image_url,
      v_promo_id, v_promo_discount
    );
  END LOOP;

  IF v_subtotal <= 0 THEN
    DELETE FROM catalog_orders WHERE id = v_order_id;
    RETURN jsonb_build_object('success', false, 'error', 'empty_cart');
  END IF;
  v_total := v_subtotal;

  UPDATE catalog_orders SET subtotal = v_subtotal, total = v_total WHERE id = v_order_id;

  SELECT to_jsonb(o.*) INTO v_new_data FROM catalog_orders o WHERE o.id = v_order_id;

  PERFORM log_audit_event(
    v_business_id,
    NULL,
    'customer',
    'catalog_order_creado',
    'catalog_order',
    v_order_id,
    'Pedido #' || v_order_number,
    NULL,
    v_new_data
  );

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_order_number, 'total', v_total);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'create_catalog_order failed: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', 'unexpected_error');
END; $$;

-- ============================================================
-- 4. update_catalog_order_status — passthrough de promo en la conversión
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_catalog_order_status(
  p_operator_id uuid, p_order_id uuid, p_new_status text,
  p_blacklist boolean DEFAULT false, p_payment_method text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid; v_sales_perm text; v_actor_role text; v_actor_op_id uuid;
  v_order record; v_valid boolean := false;
  v_sale_items jsonb := '[]'::jsonb; v_sale_payments jsonb; v_sale_result jsonb;
  v_sale_id uuid; v_old_data jsonb; v_new_data jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthorized'); END IF;

  SELECT normalize_permissions(permissions)->>'online_orders', role INTO v_sales_perm, v_actor_role
   FROM operators WHERE id = p_operator_id AND business_id = v_business_id AND is_active = true;
  IF FOUND THEN
    IF v_sales_perm <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de ventas insuficientes'); END IF;
    v_actor_op_id := p_operator_id;
  ELSE
    IF p_operator_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner'; v_actor_op_id := NULL;
  END IF;

  SELECT * INTO v_order FROM catalog_orders WHERE id = p_order_id AND business_id = v_business_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  IF v_order.status = 'recibido' AND p_new_status IN ('aceptado','rechazado','cancelado') THEN v_valid := true;
  ELSIF v_order.status = 'aceptado' AND (
      (p_new_status = 'en_camino' AND v_order.delivery_type = 'delivery') OR
      (p_new_status = 'listo_retiro' AND v_order.delivery_type = 'takeaway') OR
      p_new_status = 'cancelado'
  ) THEN v_valid := true;
  ELSIF v_order.status IN ('en_camino','listo_retiro') AND p_new_status IN ('completado','cancelado') THEN v_valid := true;
  END IF;
  IF NOT v_valid THEN
    RETURN jsonb_build_object('success', false, 'error', format('invalid_transition: %s -> %s', v_order.status, p_new_status));
  END IF;

  v_old_data := to_jsonb(v_order);

  IF p_new_status = 'completado' THEN
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card','transfer','mercadopago') THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_payment_method');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', ci.product_id, 'variant_id', ci.variant_id,
      'quantity', ci.quantity, 'unit_price', ci.unit_price, 'total', ci.line_total,
      'promotion_id', ci.promotion_id, 'promo_discount', ci.promo_discount
    )), '[]'::jsonb) INTO v_sale_items
     FROM catalog_order_items ci WHERE ci.order_id = p_order_id;

    v_sale_payments := jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', v_order.total));

    SELECT public.create_sale_transaction(
      v_business_id, v_order.subtotal, 0::numeric, v_order.total,
      'completed', NULL, v_actor_op_id, v_sale_items, v_sale_payments
    ) INTO v_sale_result;

    IF NOT COALESCE((v_sale_result->>'success')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_sale_result->>'error', 'sale_creation_failed'));
    END IF;
    v_sale_id := (v_sale_result->>'sale_id')::uuid;

    UPDATE sales SET source = 'catalog' WHERE id = v_sale_id;
  END IF;

  UPDATE catalog_orders SET
    status = p_new_status, updated_at = now(),
    accepted_at  = CASE WHEN p_new_status = 'aceptado'   AND accepted_at  IS NULL THEN now() ELSE accepted_at  END,
    completed_at = CASE WHEN p_new_status = 'completado' AND completed_at IS NULL THEN now() ELSE completed_at END,
    rejected_at  = CASE WHEN p_new_status = 'rechazado'  AND rejected_at  IS NULL THEN now() ELSE rejected_at  END,
    cancelled_at = CASE WHEN p_new_status = 'cancelado'  AND cancelled_at IS NULL THEN now() ELSE cancelled_at END,
    sale_id      = COALESCE(v_sale_id, sale_id)
  WHERE id = p_order_id;

  IF p_new_status = 'rechazado' AND p_blacklist = true THEN
    INSERT INTO catalog_phone_blacklist (business_id, phone, reason)
    VALUES (v_business_id, v_order.customer_phone, 'rechazado desde pedido #' || v_order.order_number)
    ON CONFLICT (business_id, phone) DO NOTHING;
  END IF;

  SELECT to_jsonb(o.*) INTO v_new_data FROM catalog_orders o WHERE o.id = p_order_id;

  PERFORM log_audit_event(
    v_business_id, v_actor_op_id, v_actor_role,
    'catalog_order_' || p_new_status, 'catalog_order', p_order_id,
    'Pedido #' || v_order.order_number, v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'status', p_new_status);
END; $$;
