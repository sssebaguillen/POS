-- Pedidos Online (Catalog Orders)
--
-- Captura las solicitudes de pedido que los clientes envían desde
-- /catalogo/[slug] antes de abrir WhatsApp. La orden vive como una
-- entidad propia con su propia máquina de estados; sólo cuando se marca
-- como "completado" se convierte en una venta real (sale + stock).
--
-- Decisiones clave:
--   * `create_catalog_order` es llamada por el cliente anon (granted a anon)
--     pero re-precia todos los items server-side (nunca confía en el precio
--     enviado por el cliente).
--   * `update_catalog_order_status` valida la transición y, en 'completado',
--     llama a create_sale_transaction para que el stock decrezca por el
--     trigger existente.
--   * El owner se identifica por operator_id NULL en audit_log
--     (rule #31 en CLAUDE.md).
--   * Stock negativo permitido (no validamos stock disponible).

-- ============================================================
-- 1. Tablas
-- ============================================================

CREATE TABLE IF NOT EXISTS public.catalog_orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_number    int         NOT NULL,
  customer_name   text        NOT NULL,
  customer_phone  text        NOT NULL,
  delivery_type   text        NOT NULL CHECK (delivery_type IN ('takeaway','delivery')),
  address         text,
  notes           text,
  subtotal        numeric(12,2) NOT NULL,
  total           numeric(12,2) NOT NULL,
  status          text        NOT NULL DEFAULT 'recibido'
                              CHECK (status IN (
                                'recibido','aceptado','en_camino','listo_retiro',
                                'completado','rechazado','cancelado'
                              )),
  sale_id         uuid        REFERENCES public.sales(id) ON DELETE SET NULL,
  client_ip       inet,
  accepted_at     timestamptz,
  completed_at    timestamptz,
  rejected_at     timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_orders_address_required
    CHECK (delivery_type <> 'delivery' OR (address IS NOT NULL AND btrim(address) <> '')),
  CONSTRAINT catalog_orders_business_order_number_unique
    UNIQUE (business_id, order_number)
);

CREATE INDEX IF NOT EXISTS catalog_orders_business_created_idx
  ON public.catalog_orders (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_orders_business_status_idx
  ON public.catalog_orders (business_id, status);

CREATE INDEX IF NOT EXISTS catalog_orders_business_phone_created_idx
  ON public.catalog_orders (business_id, customer_phone, created_at DESC);

CREATE TABLE IF NOT EXISTS public.catalog_order_items (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid          NOT NULL REFERENCES public.catalog_orders(id) ON DELETE CASCADE,
  product_id    uuid          REFERENCES public.products(id) ON DELETE SET NULL,
  product_name  text          NOT NULL,
  variant_id    uuid          REFERENCES public.product_variants(id) ON DELETE SET NULL,
  variant_label text,
  quantity      int           NOT NULL CHECK (quantity > 0),
  unit_price    numeric(12,2) NOT NULL,
  line_total    numeric(12,2) NOT NULL,
  image_url     text
);

CREATE INDEX IF NOT EXISTS catalog_order_items_order_idx
  ON public.catalog_order_items (order_id);

CREATE TABLE IF NOT EXISTS public.catalog_phone_blacklist (
  business_id uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone       text        NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, phone)
);

-- Per-business order counter (atomic increment via ON CONFLICT).
CREATE TABLE IF NOT EXISTS public.catalog_order_counters (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  last_number int  NOT NULL DEFAULT 0
);

-- ============================================================
-- 2. RLS
-- ============================================================

ALTER TABLE public.catalog_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_phone_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_order_counters  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business isolation" ON public.catalog_orders;
CREATE POLICY "business isolation" ON public.catalog_orders
  FOR ALL
  USING      (business_id = get_business_id())
  WITH CHECK (business_id = get_business_id());

DROP POLICY IF EXISTS "business isolation via order" ON public.catalog_order_items;
CREATE POLICY "business isolation via order" ON public.catalog_order_items
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.catalog_orders o
    WHERE o.id = catalog_order_items.order_id
      AND o.business_id = get_business_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.catalog_orders o
    WHERE o.id = catalog_order_items.order_id
      AND o.business_id = get_business_id()
  ));

DROP POLICY IF EXISTS "business isolation" ON public.catalog_phone_blacklist;
CREATE POLICY "business isolation" ON public.catalog_phone_blacklist
  FOR ALL
  USING      (business_id = get_business_id())
  WITH CHECK (business_id = get_business_id());

DROP POLICY IF EXISTS "business isolation" ON public.catalog_order_counters;
CREATE POLICY "business isolation" ON public.catalog_order_counters
  FOR ALL
  USING      (business_id = get_business_id())
  WITH CHECK (business_id = get_business_id());

-- ============================================================
-- 3. Expandir audit_log para incluir catalog_order
-- ============================================================

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type IN (
    'sale','product','category','brand',
    'expense','supplier','price_list','setting','operator','customer',
    'catalog_order'
  ));

-- ============================================================
-- 4. RPCs
-- ============================================================

-- 4a. create_catalog_order — llamada por anon vía API route /api/catalog/orders.
--
-- Re-precia items server-side con compute_effective_price (nunca confía en
-- el precio del cliente). Valida formato de teléfono, blacklist y un límite
-- de "pendientes por teléfono" como capa anti-spam (la API route también
-- agrega rate-limit por IP).

CREATE OR REPLACE FUNCTION public.create_catalog_order(
  p_slug          text,
  p_customer_name text,
  p_phone         text,
  p_delivery_type text,
  p_address       text,
  p_notes         text,
  p_items         jsonb,
  p_client_ip     inet DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id    uuid;
  v_list_id        uuid;
  v_list_mult      numeric;
  v_normalized_phone text;
  v_order_number   int;
  v_order_id       uuid;
  v_subtotal       numeric := 0;
  v_total          numeric := 0;
  v_item           jsonb;
  v_product        record;
  v_variant        record;
  v_unit_price     numeric;
  v_quantity       int;
  v_line_total     numeric;
  v_product_name   text;
  v_variant_label  text;
  v_image_url      text;
  v_pending_count  int;
BEGIN
  -- 1. Validaciones básicas
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_slug');
  END IF;

  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_name');
  END IF;

  v_normalized_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_normalized_phone) < 8 OR length(v_normalized_phone) > 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_phone');
  END IF;

  IF p_delivery_type NOT IN ('takeaway','delivery') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_delivery_type');
  END IF;

  IF p_delivery_type = 'delivery' AND (p_address IS NULL OR btrim(p_address) = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'address_required');
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'empty_cart');
  END IF;

  -- 2. Resolver negocio
  SELECT b.id INTO v_business_id
  FROM businesses b
  WHERE b.slug = btrim(p_slug);

  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'business_not_found');
  END IF;

  -- 3. Blacklist
  IF EXISTS (
    SELECT 1 FROM catalog_phone_blacklist
    WHERE business_id = v_business_id AND phone = v_normalized_phone
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'blacklisted');
  END IF;

  -- 4. Anti-spam: máximo 3 órdenes "recibido" pendientes para el mismo teléfono
  --    en la última hora. La API route agrega rate-limit por IP.
  SELECT count(*) INTO v_pending_count
  FROM catalog_orders
  WHERE business_id = v_business_id
    AND customer_phone = v_normalized_phone
    AND status = 'recibido'
    AND created_at > now() - interval '1 hour';

  IF v_pending_count >= 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'too_many_pending');
  END IF;

  -- 5. Lista de precios default (para re-pricing)
  SELECT pl.id, pl.multiplier
  INTO v_list_id, v_list_mult
  FROM price_lists pl
  WHERE pl.business_id = v_business_id
    AND pl.is_default = true
  LIMIT 1;

  -- 6. Reservar order_number (atómico)
  INSERT INTO catalog_order_counters (business_id, last_number)
  VALUES (v_business_id, 1)
  ON CONFLICT (business_id) DO UPDATE
    SET last_number = catalog_order_counters.last_number + 1
  RETURNING last_number INTO v_order_number;

  -- 7. Insertar orden (subtotal/total se actualizan al final)
  INSERT INTO catalog_orders (
    business_id, order_number, customer_name, customer_phone,
    delivery_type, address, notes, subtotal, total, client_ip
  ) VALUES (
    v_business_id, v_order_number, btrim(p_customer_name), v_normalized_phone,
    p_delivery_type, NULLIF(btrim(p_address), ''), NULLIF(btrim(p_notes), ''),
    0, 0, p_client_ip
  )
  RETURNING id INTO v_order_id;

  -- 8. Re-precing y persistencia de items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := COALESCE((v_item->>'quantity')::int, 0);
    IF v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_product
    FROM products
    WHERE id = NULLIF(v_item->>'product_id','')::uuid
      AND business_id = v_business_id
      AND is_active = true
      AND show_in_catalog = true;

    IF v_product.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'product_not_available');
    END IF;

    v_variant := NULL;
    v_variant_label := NULL;
    v_image_url := v_product.image_url;

    IF v_item ? 'variant_id' AND NULLIF(v_item->>'variant_id','') IS NOT NULL THEN
      SELECT * INTO v_variant
      FROM product_variants
      WHERE id = (v_item->>'variant_id')::uuid
        AND product_id = v_product.id
        AND business_id = v_business_id
        AND is_active = true;

      IF v_variant.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'variant_not_available');
      END IF;

      IF v_variant.image_url IS NOT NULL THEN
        v_image_url := v_variant.image_url;
      END IF;

      -- variant_label: concatenar valores de opciones
      SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
      INTO v_variant_label
      FROM product_variant_option_values pvov
      JOIN product_option_values pov ON pov.id = pvov.option_value_id
      JOIN product_options po ON po.id = pov.option_id
      WHERE pvov.variant_id = v_variant.id;

      v_unit_price := compute_effective_price(
        v_variant.cost::numeric,
        v_variant.price::numeric,
        v_variant.price::numeric,
        v_list_id,
        v_list_mult,
        v_product.id,
        v_product.brand_id
      );
    ELSE
      v_unit_price := compute_effective_price(
        v_product.cost::numeric,
        v_product.price::numeric,
        NULL,
        v_list_id,
        v_list_mult,
        v_product.id,
        v_product.brand_id
      );
    END IF;

    v_product_name := v_product.name;
    v_line_total := ROUND(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO catalog_order_items (
      order_id, product_id, product_name, variant_id, variant_label,
      quantity, unit_price, line_total, image_url
    ) VALUES (
      v_order_id, v_product.id, v_product_name,
      CASE WHEN v_variant.id IS NOT NULL THEN v_variant.id ELSE NULL END,
      v_variant_label,
      v_quantity, v_unit_price, v_line_total, v_image_url
    );
  END LOOP;

  IF v_subtotal <= 0 THEN
    -- Rollback effectively: borrar la orden vacía
    DELETE FROM catalog_orders WHERE id = v_order_id;
    RETURN jsonb_build_object('success', false, 'error', 'empty_cart');
  END IF;

  v_total := v_subtotal;

  UPDATE catalog_orders
  SET subtotal = v_subtotal, total = v_total
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'success',      true,
    'order_id',     v_order_id,
    'order_number', v_order_number,
    'total',        v_total
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_catalog_order(text, text, text, text, text, text, jsonb, inet) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_catalog_order(text, text, text, text, text, text, jsonb, inet) TO anon, authenticated;


-- 4b. get_catalog_orders — listado para la app (autenticado).
CREATE OR REPLACE FUNCTION public.get_catalog_orders(
  p_status text[]      DEFAULT NULL,
  p_from   timestamptz DEFAULT NULL,
  p_to     timestamptz DEFAULT NULL
) RETURNS TABLE(
  id             uuid,
  order_number   int,
  customer_name  text,
  customer_phone text,
  delivery_type  text,
  status         text,
  subtotal       numeric,
  total          numeric,
  item_count     int,
  created_at     timestamptz,
  accepted_at    timestamptz,
  completed_at   timestamptz,
  sale_id        uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    o.customer_name,
    o.customer_phone,
    o.delivery_type,
    o.status,
    o.subtotal,
    o.total,
    (SELECT COUNT(*)::int FROM catalog_order_items ci WHERE ci.order_id = o.id) AS item_count,
    o.created_at,
    o.accepted_at,
    o.completed_at,
    o.sale_id
  FROM catalog_orders o
  WHERE o.business_id = v_business_id
    AND (p_status IS NULL OR o.status = ANY(p_status))
    AND (p_from   IS NULL OR o.created_at >= p_from)
    AND (p_to     IS NULL OR o.created_at <  p_to)
  ORDER BY o.created_at DESC;
END;
$$;


-- 4c. get_catalog_order — detalle + items.
CREATE OR REPLACE FUNCTION public.get_catalog_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id uuid;
  v_order       jsonb;
  v_items       jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT to_jsonb(o.*) INTO v_order
  FROM catalog_orders o
  WHERE o.id = p_order_id AND o.business_id = v_business_id;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(ci.*) ORDER BY ci.id), '[]'::jsonb)
  INTO v_items
  FROM catalog_order_items ci
  WHERE ci.order_id = p_order_id;

  RETURN jsonb_build_object('success', true, 'order', v_order, 'items', v_items);
END;
$$;


-- 4d. get_catalog_orders_unread_count — para el badge del sidebar.
CREATE OR REPLACE FUNCTION public.get_catalog_orders_unread_count()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id uuid;
  v_count       int;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM catalog_orders
  WHERE business_id = v_business_id AND status = 'recibido';

  RETURN COALESCE(v_count, 0);
END;
$$;


-- 4e. update_catalog_order_status — transición de estado + conversión en venta.
--
-- Reglas:
--   recibido       → aceptado | rechazado | cancelado
--   aceptado       → en_camino (delivery) | listo_retiro (takeaway) | cancelado
--   en_camino      → completado | cancelado
--   listo_retiro   → completado | cancelado
--   completado / rechazado / cancelado son terminales.
--
-- En 'completado': crea una sale via create_sale_transaction reusando los
-- mismos items, payment_method = 'other', y guarda sale_id en la orden.
-- En 'rechazado' con p_blacklist=true: agrega el teléfono al blacklist.

CREATE OR REPLACE FUNCTION public.update_catalog_order_status(
  p_operator_id uuid,
  p_order_id    uuid,
  p_new_status  text,
  p_blacklist   boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id    uuid;
  v_sales_perm     text;
  v_actor_role     text;
  v_actor_op_id    uuid;
  v_order          record;
  v_valid          boolean := false;
  v_sale_items     jsonb := '[]'::jsonb;
  v_sale_payments  jsonb;
  v_sale_result    jsonb;
  v_sale_id        uuid;
  v_old_data       jsonb;
  v_new_data       jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  -- Permisos: reusar `sales`
  SELECT permissions->>'sales', role
  INTO v_sales_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_business_id AND is_active = true;

  IF FOUND THEN
    IF v_sales_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de ventas insuficientes');
    END IF;
    v_actor_op_id := p_operator_id;
  ELSE
    -- Owner: validar que el operator_id corresponde al profile del owner
    IF p_operator_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
    v_actor_op_id := NULL;
  END IF;

  -- Cargar orden
  SELECT * INTO v_order FROM catalog_orders WHERE id = p_order_id AND business_id = v_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- Validar transición
  IF v_order.status = 'recibido' AND p_new_status IN ('aceptado','rechazado','cancelado') THEN
    v_valid := true;
  ELSIF v_order.status = 'aceptado' AND (
      (p_new_status = 'en_camino'    AND v_order.delivery_type = 'delivery') OR
      (p_new_status = 'listo_retiro' AND v_order.delivery_type = 'takeaway') OR
      p_new_status = 'cancelado'
  ) THEN
    v_valid := true;
  ELSIF v_order.status IN ('en_camino','listo_retiro') AND p_new_status IN ('completado','cancelado') THEN
    v_valid := true;
  END IF;

  IF NOT v_valid THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('invalid_transition: %s → %s', v_order.status, p_new_status)
    );
  END IF;

  v_old_data := to_jsonb(v_order);

  -- Si pasa a 'completado': crear sale
  IF p_new_status = 'completado' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', ci.product_id,
      'variant_id', ci.variant_id,
      'quantity',   ci.quantity,
      'unit_price', ci.unit_price,
      'total',      ci.line_total
    )), '[]'::jsonb)
    INTO v_sale_items
    FROM catalog_order_items ci
    WHERE ci.order_id = p_order_id;

    v_sale_payments := jsonb_build_array(jsonb_build_object(
      'method', 'other',
      'amount', v_order.total
    ));

    SELECT public.create_sale_transaction(
      v_business_id,
      v_order.subtotal,
      0::numeric,
      v_order.total,
      'completed',
      NULL,
      v_actor_op_id,
      v_sale_items,
      v_sale_payments
    ) INTO v_sale_result;

    IF NOT COALESCE((v_sale_result->>'success')::boolean, false) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', COALESCE(v_sale_result->>'error', 'sale_creation_failed')
      );
    END IF;

    v_sale_id := (v_sale_result->>'sale_id')::uuid;
  END IF;

  -- Update orden
  UPDATE catalog_orders SET
    status       = p_new_status,
    updated_at   = now(),
    accepted_at  = CASE WHEN p_new_status = 'aceptado'   AND accepted_at  IS NULL THEN now() ELSE accepted_at  END,
    completed_at = CASE WHEN p_new_status = 'completado' AND completed_at IS NULL THEN now() ELSE completed_at END,
    rejected_at  = CASE WHEN p_new_status = 'rechazado'  AND rejected_at  IS NULL THEN now() ELSE rejected_at  END,
    cancelled_at = CASE WHEN p_new_status = 'cancelado'  AND cancelled_at IS NULL THEN now() ELSE cancelled_at END,
    sale_id      = COALESCE(v_sale_id, sale_id)
  WHERE id = p_order_id;

  -- Blacklist opcional al rechazar
  IF p_new_status = 'rechazado' AND p_blacklist = true THEN
    INSERT INTO catalog_phone_blacklist (business_id, phone, reason)
    VALUES (v_business_id, v_order.customer_phone, 'rechazado desde pedido #' || v_order.order_number)
    ON CONFLICT (business_id, phone) DO NOTHING;
  END IF;

  SELECT to_jsonb(o.*) INTO v_new_data
  FROM catalog_orders o WHERE o.id = p_order_id;

  PERFORM log_audit_event(
    v_business_id,
    v_actor_op_id,
    v_actor_role,
    'catalog_order_' || p_new_status,
    'catalog_order',
    p_order_id,
    'Pedido #' || v_order.order_number,
    v_old_data,
    v_new_data
  );

  RETURN jsonb_build_object(
    'success',  true,
    'sale_id',  v_sale_id,
    'status',   p_new_status
  );
END;
$$;
