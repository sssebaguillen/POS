-- Promociones y Ofertas — F1: fundación de DB.
-- Plan completo: docs/todo/promotions.md
--
-- Contenido:
--   1. Tabla promotions (una promo = un target: producto XOR categoría XOR marca).
--   2. Columnas informativas de tracking: sale_items / catalog_order_items
--      (promotion_id + promo_discount). Las líneas siguen siendo NETAS → los
--      invariantes R2/R3 de reconciliación no cambian.
--   3. Helpers de resolución/cálculo (espejo TS pendiente en src/lib/promotions.ts — regla 11):
--      find_applicable_promotion, apply_unit_promo, compute_quantity_promo_discount.
--   4. RPCs CRUD con guard inventory_write + assert de tenant + audit (reglas 32/34):
--      create_promotion, update_promotion, archive_promotion.
--   5. Passthrough de promo en create_sale_transaction (misma firma).
--   6. daily_snapshots: promo_discounts_total + promo_sales_count (para P12),
--      agregados en upsert_daily_snapshot y proyectados en get_daily_snapshots.
--
-- Semántica de promo "vigente": is_active AND archived_at IS NULL AND now() ∈ [starts_at, ends_at].
-- show_in_catalog controla SOLO la sección "Ofertas" destacada del catálogo;
-- el precio de la promo aplica siempre (paridad POS ↔ catálogo).
-- Sin CASCADE (decisión del proyecto): una promo usada en ventas se ARCHIVA, no se borra.

-- ============================================================
-- 1. Tabla
-- ============================================================

CREATE TABLE IF NOT EXISTS public.promotions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id),
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('percent', 'offer_price', 'quantity')),
  -- kind = 'percent'
  percent         numeric,
  -- kind = 'offer_price' (solo productos sin variantes; se valida en la RPC)
  offer_price     numeric,
  -- kind = 'quantity': "por cada grupo de N unidades, las últimas K pagan el P%"
  --   2x1 = (2,1,0) · 3x2 = (3,1,0) · 2da unidad al 50% = (2,1,50)
  group_size      integer,
  affected_units  integer,
  pay_percent     numeric,
  -- scope: exactamente uno
  product_id      uuid REFERENCES public.products(id),
  category_id     uuid REFERENCES public.categories(id),
  brand_id        uuid REFERENCES public.brands(id),
  starts_at       timestamptz,
  ends_at         timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  show_in_catalog boolean NOT NULL DEFAULT true,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_scope_one CHECK (
    (product_id IS NOT NULL)::int + (category_id IS NOT NULL)::int + (brand_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT promotions_kind_fields CHECK (
    (kind = 'percent' AND percent IS NOT NULL AND percent > 0 AND percent <= 100)
    OR (kind = 'offer_price' AND offer_price IS NOT NULL AND offer_price > 0 AND product_id IS NOT NULL)
    OR (kind = 'quantity'
        AND group_size IS NOT NULL AND group_size BETWEEN 2 AND 100
        AND affected_units IS NOT NULL AND affected_units BETWEEN 1 AND group_size - 1
        AND pay_percent IS NOT NULL AND pay_percent >= 0 AND pay_percent < 100
        AND product_id IS NOT NULL)
  ),
  CONSTRAINT promotions_date_range CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  )
);

CREATE INDEX IF NOT EXISTS promotions_business_active_idx
  ON public.promotions (business_id)
  WHERE archived_at IS NULL;

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

-- Solo lectura directa (POS necesita las promos vigentes client-side).
-- Escrituras EXCLUSIVAMENTE vía RPCs guardadas (regla 32) — sin policy de INSERT/UPDATE/DELETE.
CREATE POLICY promotions_select ON public.promotions
  FOR SELECT USING (business_id = public.get_business_id());

-- ============================================================
-- 2. Columnas informativas de tracking
-- ============================================================

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.promotions(id),
  ADD COLUMN IF NOT EXISTS promo_discount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.catalog_order_items
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.promotions(id),
  ADD COLUMN IF NOT EXISTS promo_discount numeric(12,2) NOT NULL DEFAULT 0;

-- Para el reporte de impacto futuro ("ventas con la promo X")
CREATE INDEX IF NOT EXISTS sale_items_promotion_idx
  ON public.sale_items (promotion_id)
  WHERE promotion_id IS NOT NULL;

ALTER TABLE public.daily_snapshots
  ADD COLUMN IF NOT EXISTS promo_discounts_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_sales_count integer NOT NULL DEFAULT 0;

-- ============================================================
-- 3. Helpers de resolución y cálculo (espejo TS: src/lib/promotions.ts)
-- ============================================================

-- Promo vigente más aplicable para un producto. Resolución determinística:
-- más específica gana (producto > categoría > marca); a igual especificidad,
-- la más reciente. Sin stacking: una línea matchea UNA promo.
-- Sin guard de tenant: es un helper del path del catálogo público (como
-- compute_effective_price); las promos se exhiben públicamente en el catálogo.
CREATE OR REPLACE FUNCTION public.find_applicable_promotion(
  p_business_id uuid,
  p_product_id uuid,
  p_category_id uuid,
  p_brand_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS public.promotions
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT pr.*
  FROM public.promotions pr
  WHERE pr.business_id = p_business_id
    AND pr.is_active = true
    AND pr.archived_at IS NULL
    AND (pr.starts_at IS NULL OR pr.starts_at <= p_at)
    AND (pr.ends_at IS NULL OR pr.ends_at >= p_at)
    AND (
      (pr.product_id IS NOT NULL AND pr.product_id = p_product_id)
      OR (pr.category_id IS NOT NULL AND pr.category_id = p_category_id)
      OR (pr.brand_id IS NOT NULL AND pr.brand_id = p_brand_id)
    )
  ORDER BY
    CASE
      WHEN pr.product_id IS NOT NULL THEN 0
      WHEN pr.category_id IS NOT NULL THEN 1
      ELSE 2
    END,
    pr.created_at DESC
  LIMIT 1;
$$;

-- Precio unitario con promo unitaria aplicada.
-- percent → precio × (1 − pct/100); offer_price → LEAST(oferta, precio): una
-- oferta nunca SUBE el precio. quantity (u otro) → el unitario no se toca.
CREATE OR REPLACE FUNCTION public.apply_unit_promo(
  p_kind text,
  p_percent numeric,
  p_offer_price numeric,
  p_unit_price numeric
) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT CASE
    WHEN p_kind = 'percent' AND p_percent IS NOT NULL AND p_percent > 0
      THEN ROUND(p_unit_price * (1 - p_percent / 100.0), 2)
    WHEN p_kind = 'offer_price' AND p_offer_price IS NOT NULL AND p_offer_price > 0
      THEN LEAST(ROUND(p_offer_price, 2), ROUND(p_unit_price, 2))
    ELSE ROUND(p_unit_price, 2)
  END;
$$;

-- Descuento de línea de una promo de cantidad:
-- floor(qty / N) × K × unit_price × (1 − P/100)
CREATE OR REPLACE FUNCTION public.compute_quantity_promo_discount(
  p_group_size integer,
  p_affected_units integer,
  p_pay_percent numeric,
  p_unit_price numeric,
  p_quantity integer
) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT CASE
    WHEN p_group_size IS NULL OR p_group_size < 2
      OR p_affected_units IS NULL OR p_affected_units < 1
      OR COALESCE(p_quantity, 0) < p_group_size
      OR COALESCE(p_unit_price, 0) <= 0
      THEN 0::numeric
    ELSE GREATEST(
      ROUND(
        FLOOR(p_quantity::numeric / p_group_size) * p_affected_units
          * p_unit_price * (1 - COALESCE(p_pay_percent, 0) / 100.0),
        2
      ),
      0
    )
  END;
$$;

-- ============================================================
-- 4. RPCs CRUD (guard inventory_write + audit)
-- ============================================================

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
  v_has_variants       boolean;
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
  IF p_product_id IS NOT NULL THEN
    SELECT has_variants INTO v_has_variants
    FROM products WHERE id = p_product_id AND business_id = v_caller_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
    END IF;
    IF p_kind = 'offer_price' AND v_has_variants THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta no aplica a productos con variantes; usa porcentaje');
    END IF;
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
  v_has_variants       boolean;
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

  IF p_product_id IS NOT NULL THEN
    SELECT has_variants INTO v_has_variants
    FROM products WHERE id = p_product_id AND business_id = v_caller_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
    END IF;
    IF p_kind = 'offer_price' AND v_has_variants THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta no aplica a productos con variantes; usa porcentaje');
    END IF;
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

CREATE OR REPLACE FUNCTION public.archive_promotion(
  p_operator_id uuid,
  p_business_id uuid,
  p_promotion_id uuid
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
    RETURN jsonb_build_object('success', false, 'error', 'La promoción ya está archivada');
  END IF;

  UPDATE promotions SET
    is_active   = false,
    archived_at = now(),
    updated_at  = now()
  WHERE id = p_promotion_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'promotion_archived', 'promotion', v_row.id, v_row.name, to_jsonb(v_old), to_jsonb(v_row));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 5. create_sale_transaction — passthrough de promo (misma firma)
-- ============================================================
-- Cambios: lee promotion_id / promo_discount de cada ítem (informativos).
-- promotion_id se valida contra el negocio del llamador (si no pertenece, se
-- descarta junto con su promo_discount — columnas informativas, nunca bloquean
-- la venta). El resto del cuerpo es idéntico al vigente.

CREATE OR REPLACE FUNCTION public.create_sale_transaction(
  p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric,
  p_status text, p_price_list_id uuid, p_operator_id uuid,
  p_items jsonb, p_payments jsonb,
  p_customer_id uuid DEFAULT NULL, p_session_id uuid DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
  v_payment            jsonb;
  v_payments_total     numeric := 0;
  v_credit_total       numeric := 0;
  v_actor_role         text;
  v_actor_permissions  jsonb;
  v_stored_op_id       uuid;
  v_new_data           jsonb;
  v_customer           customers%ROWTYPE;
  v_credit_available   numeric;
  v_has_price_override boolean := false;
  v_balance_after      numeric;
  v_item_promo_id      uuid;
  v_item_promo_disc    numeric;
BEGIN
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un item');
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un pago');
  END IF;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric;
    IF (v_payment->>'method') = 'credit' THEN
      v_credit_total := v_credit_total + (v_payment->>'amount')::numeric;
    END IF;
  END LOOP;
  IF v_payments_total < p_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'El monto de los pagos no cubre el total de la venta');
  END IF;

  SELECT role, permissions INTO v_actor_role, v_actor_permissions
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
    v_actor_permissions := NULL;
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'unit_price_override') IS NOT NULL THEN
      v_has_price_override := true;
      EXIT;
    END IF;
  END LOOP;
  IF v_has_price_override AND v_actor_role <> 'owner' THEN
    IF v_actor_permissions IS NULL OR (normalize_permissions(v_actor_permissions)->>'pos_pricing') <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permiso de override de precio requerido');
    END IF;
  END IF;

  IF v_credit_total > 0 THEN
    IF p_customer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Pago con crédito requiere cliente');
    END IF;

    SELECT * INTO v_customer
    FROM customers
    WHERE id = p_customer_id AND business_id = v_caller_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio');
    END IF;

    IF NOT v_customer.is_credit_enabled THEN
      RETURN jsonb_build_object('success', false, 'error', 'El cliente no tiene crédito habilitado');
    END IF;

    v_credit_available := v_customer.credit_limit - COALESCE(v_customer.credit_balance, 0);
    IF v_credit_total > v_credit_available THEN
      RETURN jsonb_build_object('success', false, 'error', 'El monto supera el crédito disponible');
    END IF;
  ELSIF p_customer_id IS NOT NULL THEN
    PERFORM 1 FROM customers
    WHERE id = p_customer_id AND business_id = v_caller_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio');
    END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM cash_sessions
    WHERE id = p_session_id AND business_id = v_caller_business_id AND status = 'open';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Sesión de caja no válida');
    END IF;
  END IF;

  INSERT INTO sales (business_id, subtotal, discount, total, status, price_list_id, operator_id, customer_id, session_id)
  VALUES (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id, p_customer_id, p_session_id)
  RETURNING id, created_at INTO v_sale_id, v_sale_created_at;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_promo_id   := NULLIF(v_item->>'promotion_id', '')::uuid;
    v_item_promo_disc := GREATEST(COALESCE((v_item->>'promo_discount')::numeric, 0), 0);
    IF v_item_promo_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM promotions WHERE id = v_item_promo_id AND business_id = v_caller_business_id
    ) THEN
      v_item_promo_id   := NULL;
      v_item_promo_disc := 0;
    END IF;
    IF v_item_promo_id IS NULL THEN
      v_item_promo_disc := 0;
    END IF;

    INSERT INTO sale_items (
      sale_id, product_id, variant_id, quantity, unit_price, total,
      unit_price_override, override_reason, free_line_description,
      promotion_id, promo_discount
    ) VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      (v_item->>'unit_price_override')::numeric,
      v_item->>'override_reason',
      v_item->>'free_line_description',
      v_item_promo_id,
      v_item_promo_disc
    );
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO payments (sale_id, method, amount, status)
    VALUES (v_sale_id, v_payment->>'method', (v_payment->>'amount')::numeric, 'completed');
  END LOOP;

  IF v_credit_total > 0 THEN
    UPDATE customers
    SET credit_balance = COALESCE(credit_balance, 0) + v_credit_total
    WHERE id = p_customer_id
    RETURNING credit_balance INTO v_balance_after;

    INSERT INTO customer_account_movements
      (business_id, customer_id, type, amount, sale_id, operator_id, balance_after)
    VALUES
      (p_business_id, p_customer_id, 'charge', v_credit_total, v_sale_id, v_stored_op_id, v_balance_after);
  END IF;

  SELECT jsonb_build_object(
    'total', s.total, 'subtotal', s.subtotal, 'discount', s.discount, 'status', s.status, 'customer_id', s.customer_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id, 'variant_id', si.variant_id,
        'quantity', si.quantity, 'unit_price', si.unit_price, 'total', si.total,
        'promotion_id', si.promotion_id, 'promo_discount', si.promo_discount) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = v_sale_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = v_sale_id), '[]'::jsonb)
  ) INTO v_new_data FROM sales s WHERE s.id = v_sale_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'sale_created', 'sale', v_sale_id, NULL, NULL, v_new_data);

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'created_at', v_sale_created_at);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================
-- 6. Snapshot diario — agregados de promo (para P12)
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_daily_snapshot(p_business_id uuid, p_snapshot_date date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_snapshot_row public.daily_snapshots%ROWTYPE;
  v_timezone     text;
BEGIN
  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  WITH sales_base AS (
    SELECT
      COUNT(*)::integer AS sales_count,
      COALESCE(SUM(s.subtotal), 0) AS gross_revenue,
      COALESCE(SUM(s.discount), 0) AS discounts_total,
      COALESCE(SUM(s.total), 0) AS net_revenue,
      COALESCE(AVG(s.total), 0) AS avg_ticket,
      COUNT(DISTINCT s.customer_id) FILTER (WHERE s.customer_id IS NOT NULL)::integer AS customers_count
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
  ),
  item_stats AS (
    SELECT
      COALESCE(SUM(si.quantity), 0)::integer AS items_sold,
      COALESCE(SUM(si.promo_discount), 0) AS promo_discounts_total,
      COUNT(DISTINCT s.id) FILTER (WHERE si.promotion_id IS NOT NULL)::integer AS promo_sales_count
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
  ),
  expense_stats AS (
    SELECT
      COALESCE(SUM(e.amount), 0) AS expenses_total,
      COALESCE(SUM(e.amount) FILTER (WHERE e.category <> 'mercaderia'), 0) AS operating_expenses_total,
      COALESCE(SUM(e.amount) FILTER (WHERE e.category = 'mercaderia'), 0) AS inventory_expenses_total
    FROM public.expenses e
    WHERE e.business_id = p_business_id
      AND e.date = p_snapshot_date
  ),
  top_product AS (
    SELECT
      si.product_id AS top_product_id,
      MAX(p.name) AS top_product_name,
      SUM(si.quantity)::integer AS top_product_units,
      COALESCE(SUM(si.total), 0) AS top_product_revenue
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
      AND si.product_id IS NOT NULL
    GROUP BY si.product_id
    ORDER BY SUM(si.quantity) DESC, SUM(si.total) DESC, si.product_id
    LIMIT 1
  )
  INSERT INTO public.daily_snapshots (
    business_id,
    snapshot_date,
    sales_count,
    items_sold,
    gross_revenue,
    discounts_total,
    net_revenue,
    avg_ticket,
    customers_count,
    expenses_total,
    operating_expenses_total,
    inventory_expenses_total,
    top_product_id,
    top_product_name,
    top_product_units,
    top_product_revenue,
    promo_discounts_total,
    promo_sales_count,
    updated_at
  )
  SELECT
    p_business_id,
    p_snapshot_date,
    sb.sales_count,
    ist.items_sold,
    sb.gross_revenue,
    sb.discounts_total,
    sb.net_revenue,
    sb.avg_ticket,
    sb.customers_count,
    es.expenses_total,
    es.operating_expenses_total,
    es.inventory_expenses_total,
    tp.top_product_id,
    tp.top_product_name,
    COALESCE(tp.top_product_units, 0),
    COALESCE(tp.top_product_revenue, 0),
    ist.promo_discounts_total,
    ist.promo_sales_count,
    now()
  FROM sales_base sb
  CROSS JOIN item_stats ist
  CROSS JOIN expense_stats es
  LEFT JOIN top_product tp ON true
  ON CONFLICT (business_id, snapshot_date) DO UPDATE
  SET
    sales_count              = EXCLUDED.sales_count,
    items_sold               = EXCLUDED.items_sold,
    gross_revenue            = EXCLUDED.gross_revenue,
    discounts_total          = EXCLUDED.discounts_total,
    net_revenue              = EXCLUDED.net_revenue,
    avg_ticket               = EXCLUDED.avg_ticket,
    customers_count          = EXCLUDED.customers_count,
    expenses_total           = EXCLUDED.expenses_total,
    operating_expenses_total = EXCLUDED.operating_expenses_total,
    inventory_expenses_total = EXCLUDED.inventory_expenses_total,
    top_product_id           = EXCLUDED.top_product_id,
    top_product_name         = EXCLUDED.top_product_name,
    top_product_units        = EXCLUDED.top_product_units,
    top_product_revenue      = EXCLUDED.top_product_revenue,
    promo_discounts_total    = EXCLUDED.promo_discounts_total,
    promo_sales_count        = EXCLUDED.promo_sales_count,
    updated_at               = now()
  RETURNING * INTO v_snapshot_row;

  RETURN jsonb_build_object(
    'success', true,
    'data', to_jsonb(v_snapshot_row)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_snapshots(p_business_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_caller_business_id uuid; v_from date; v_to date; v_rows jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb);
  END IF;
  v_to := COALESCE(p_to, current_date);
  v_from := COALESCE(p_from, v_to - 29);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'snapshot_date', ds.snapshot_date, 'sales_count', ds.sales_count, 'items_sold', ds.items_sold,
    'gross_revenue', ds.gross_revenue, 'discounts_total', ds.discounts_total, 'net_revenue', ds.net_revenue,
    'avg_ticket', ds.avg_ticket, 'customers_count', ds.customers_count, 'expenses_total', ds.expenses_total,
    'operating_expenses_total', ds.operating_expenses_total, 'inventory_expenses_total', ds.inventory_expenses_total,
    'top_product_id', ds.top_product_id, 'top_product_name', ds.top_product_name,
    'top_product_units', ds.top_product_units, 'top_product_revenue', ds.top_product_revenue,
    'promo_discounts_total', ds.promo_discounts_total, 'promo_sales_count', ds.promo_sales_count
  ) ORDER BY ds.snapshot_date), '[]'::jsonb) INTO v_rows
  FROM public.daily_snapshots ds
  WHERE ds.business_id = p_business_id AND ds.snapshot_date BETWEEN v_from AND v_to;
  RETURN jsonb_build_object('data', v_rows);
END;
$$;

-- ============================================================
-- 7. Grants (regla 34: Supabase otorga EXECUTE a PUBLIC por defecto)
-- ============================================================

REVOKE ALL ON FUNCTION public.create_promotion(uuid, uuid, text, text, numeric, numeric, integer, integer, numeric, uuid, uuid, uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_promotion(uuid, uuid, text, text, numeric, numeric, integer, integer, numeric, uuid, uuid, uuid, timestamptz, timestamptz, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.update_promotion(uuid, uuid, uuid, text, text, numeric, numeric, integer, integer, numeric, uuid, uuid, uuid, timestamptz, timestamptz, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_promotion(uuid, uuid, uuid, text, text, numeric, numeric, integer, integer, numeric, uuid, uuid, uuid, timestamptz, timestamptz, boolean, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.archive_promotion(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_promotion(uuid, uuid, uuid) TO authenticated;

-- Helpers: solo se invocan desde funciones SECURITY DEFINER (catálogo, F4) o
-- vía espejo TS; no hace falta exponerlos a anon.
REVOKE ALL ON FUNCTION public.find_applicable_promotion(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_applicable_promotion(uuid, uuid, uuid, uuid, timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.apply_unit_promo(text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_unit_promo(text, numeric, numeric, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.compute_quantity_promo_discount(integer, integer, numeric, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_quantity_promo_discount(integer, integer, numeric, numeric, integer) TO authenticated, service_role;
