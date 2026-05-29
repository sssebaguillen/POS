-- 20260529_07_harden_create_catalog_order.sql
-- Hardening del endpoint anónimo del catálogo (frente sección 5 del doc 08). create_catalog_order
-- es anon-ejecutable (el catálogo público la llama directo), así que la RPC es la frontera real
-- y debe validar todo aunque el route también lo haga. Cambios:
--   A) El catch-all devolvía SQLERRM crudo al cliente anónimo (fuga de detalles internos: tipos,
--      esquema, p.ej. "invalid input syntax for type uuid"). Ahora devuelve 'unexpected_error'
--      genérico y loguea el detalle server-side (RAISE WARNING -> logs de Postgres).
--   B) customer_name/address/notes eran text ilimitado -> un anónimo podía guardar blobs de MB.
--      Se capean con left() (120/300/1000) como backstop server-side.
--   C) quantity sin tope: se castea vía numeric (evita overflow de int al pasar valores enormes),
--      se floorea y se clampa a 1000 por línea; además se rechazan pedidos con > 50 ítems.
-- El núcleo (re-precio server-side, scoping de producto/variante al negocio del slug) no cambia.

CREATE OR REPLACE FUNCTION public.create_catalog_order(p_slug text, p_customer_name text, p_phone text, p_delivery_type text, p_address text, p_notes text, p_items jsonb, p_client_ip inet DEFAULT NULL::inet)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  SELECT pl.id, pl.multiplier INTO v_list_id, v_list_mult
   FROM price_lists pl WHERE pl.business_id = v_business_id AND pl.is_default = true LIMIT 1;

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
    -- Cast vía numeric para no romper ante valores enormes, luego floor + clamp a 1000.
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

    v_product_name := v_product.name;
    v_line_total := ROUND(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO catalog_order_items (
      order_id, product_id, product_name, variant_id, variant_label,
      quantity, unit_price, line_total, image_url
    ) VALUES (
      v_order_id, v_product.id, v_product_name,
      v_variant_id, v_variant_label,
      v_quantity, v_unit_price, v_line_total, v_image_url
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
  -- No filtrar detalles internos al cliente anónimo; el detalle queda en los logs de Postgres.
  RAISE WARNING 'create_catalog_order failed: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', 'unexpected_error');
END; $function$;
