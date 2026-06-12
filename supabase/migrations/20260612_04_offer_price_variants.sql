-- ─────────────────────────────────────────────────────────────────────────────
-- Precio de oferta sobre productos CON variantes ("todas las variantes a $X").
--
-- La restricción de v1 (offer_price solo en productos sin variantes) era solo
-- una validación de alta en create_promotion/update_promotion + un filtro de UI.
-- Todo el pipeline de consumo (POS, get_catalog_products,
-- get_catalog_product_with_variants, create_catalog_order) ya aplica
-- apply_unit_promo por línea/variante con LEAST(oferta, precio): una oferta
-- nunca SUBE el precio de una variante más barata que $X.
--
-- Este archivo re-crea ambas RPCs sin la guarda de variantes (la verificación
-- de pertenencia del producto se mantiene). Sin cambios de firma ni de grants.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_promotion(
  p_operator_id uuid,
  p_business_id uuid,
  p_name text,
  p_kind text,
  p_percent numeric DEFAULT NULL,
  p_offer_price numeric DEFAULT NULL,
  p_group_size integer DEFAULT NULL,
  p_affected_units integer DEFAULT NULL,
  p_pay_percent numeric DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_show_in_catalog boolean DEFAULT true
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_row                public.promotions%ROWTYPE;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  -- Validaciones de negocio (los CHECK de la tabla son la red de seguridad final)
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;
  IF p_kind NOT IN ('percent', 'offer_price', 'quantity') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tipo de promoción inválido');
  END IF;
  IF (p_product_id IS NOT NULL)::int + (p_category_id IS NOT NULL)::int + (p_brand_id IS NOT NULL)::int <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La promoción debe tener exactamente un alcance (producto, categoría o marca)');
  END IF;
  IF p_kind = 'percent' AND (p_percent IS NULL OR p_percent <= 0 OR p_percent > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 0 y 100');
  END IF;
  IF p_kind = 'offer_price' THEN
    IF p_offer_price IS NULL OR p_offer_price <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta debe ser mayor a 0');
    END IF;
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta requiere un producto específico');
    END IF;
  END IF;
  IF p_kind = 'quantity' THEN
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Las promos por cantidad requieren un producto específico');
    END IF;
    IF p_group_size IS NULL OR p_group_size < 2 OR p_group_size > 100
       OR p_affected_units IS NULL OR p_affected_units < 1 OR p_affected_units >= p_group_size
       OR p_pay_percent IS NULL OR p_pay_percent < 0 OR p_pay_percent >= 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Configuración de cantidad inválida');
    END IF;
  END IF;
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'La fecha de fin debe ser posterior a la de inicio');
  END IF;

  -- El target debe pertenecer al negocio
  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada');
  END IF;

  INSERT INTO promotions (
    business_id, name, kind, percent, offer_price,
    group_size, affected_units, pay_percent,
    product_id, category_id, brand_id,
    starts_at, ends_at, show_in_catalog
  ) VALUES (
    v_caller_business_id, btrim(p_name), p_kind,
    CASE WHEN p_kind = 'percent' THEN p_percent END,
    CASE WHEN p_kind = 'offer_price' THEN p_offer_price END,
    CASE WHEN p_kind = 'quantity' THEN p_group_size END,
    CASE WHEN p_kind = 'quantity' THEN p_affected_units END,
    CASE WHEN p_kind = 'quantity' THEN p_pay_percent END,
    p_product_id, p_category_id, p_brand_id,
    p_starts_at, p_ends_at, COALESCE(p_show_in_catalog, true)
  ) RETURNING * INTO v_row;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'promotion_created', 'promotion', v_row.id, v_row.name, NULL, to_jsonb(v_row));

  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_promotion(
  p_operator_id uuid,
  p_business_id uuid,
  p_promotion_id uuid,
  p_name text,
  p_kind text,
  p_percent numeric DEFAULT NULL,
  p_offer_price numeric DEFAULT NULL,
  p_group_size integer DEFAULT NULL,
  p_affected_units integer DEFAULT NULL,
  p_pay_percent numeric DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_ends_at timestamptz DEFAULT NULL,
  p_show_in_catalog boolean DEFAULT true,
  p_is_active boolean DEFAULT true
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_old                public.promotions%ROWTYPE;
  v_row                public.promotions%ROWTYPE;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT * INTO v_old FROM promotions
  WHERE id = p_promotion_id AND business_id = v_caller_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promoción no encontrada');
  END IF;
  IF v_old.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No se puede editar una promoción archivada');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;
  IF p_kind NOT IN ('percent', 'offer_price', 'quantity') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tipo de promoción inválido');
  END IF;
  IF (p_product_id IS NOT NULL)::int + (p_category_id IS NOT NULL)::int + (p_brand_id IS NOT NULL)::int <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La promoción debe tener exactamente un alcance (producto, categoría o marca)');
  END IF;
  IF p_kind = 'percent' AND (p_percent IS NULL OR p_percent <= 0 OR p_percent > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 0 y 100');
  END IF;
  IF p_kind = 'offer_price' THEN
    IF p_offer_price IS NULL OR p_offer_price <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta debe ser mayor a 0');
    END IF;
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta requiere un producto específico');
    END IF;
  END IF;
  IF p_kind = 'quantity' THEN
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Las promos por cantidad requieren un producto específico');
    END IF;
    IF p_group_size IS NULL OR p_group_size < 2 OR p_group_size > 100
       OR p_affected_units IS NULL OR p_affected_units < 1 OR p_affected_units >= p_group_size
       OR p_pay_percent IS NULL OR p_pay_percent < 0 OR p_pay_percent >= 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Configuración de cantidad inválida');
    END IF;
  END IF;
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'La fecha de fin debe ser posterior a la de inicio');
  END IF;

  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada');
  END IF;

  UPDATE promotions SET
    name            = btrim(p_name),
    kind            = p_kind,
    percent         = CASE WHEN p_kind = 'percent' THEN p_percent END,
    offer_price     = CASE WHEN p_kind = 'offer_price' THEN p_offer_price END,
    group_size      = CASE WHEN p_kind = 'quantity' THEN p_group_size END,
    affected_units  = CASE WHEN p_kind = 'quantity' THEN p_affected_units END,
    pay_percent     = CASE WHEN p_kind = 'quantity' THEN p_pay_percent END,
    product_id      = p_product_id,
    category_id     = p_category_id,
    brand_id        = p_brand_id,
    starts_at       = p_starts_at,
    ends_at         = p_ends_at,
    show_in_catalog = COALESCE(p_show_in_catalog, true),
    is_active       = COALESCE(p_is_active, true),
    updated_at      = now()
  WHERE id = p_promotion_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'promotion_updated', 'promotion', v_row.id, v_row.name, to_jsonb(v_old), to_jsonb(v_row));

  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;
