-- ============================================================
-- Product Variants (P8b)
-- Tables: attribute_types, product_options, product_option_values,
--         product_variants, product_variant_option_values
-- Schema changes: products.has_variants, sale_items.variant_id
-- RPCs: get_attribute_types, get_product_with_variants,
--       create_product_with_variants, update_product_variants
-- Trigger mod: update_stock_on_sale (variant bifurcation)
-- RPC mod: update_sale (variant stock restore bifurcation)
-- ============================================================

-- ============================================================
-- 1. attribute_types (system table — no RLS, shared across tenants)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attribute_types (
  id       text PRIMARY KEY,
  label    text NOT NULL,
  position int  NOT NULL DEFAULT 0
);

INSERT INTO public.attribute_types (id, label, position) VALUES
  ('size',         'Talle / Tamaño',  0),
  ('color',        'Color',           1),
  ('material',     'Material / Tela', 2),
  ('weight',       'Peso / Gramaje',  3),
  ('presentation', 'Presentación',    4),
  ('flavor',       'Sabor',           5),
  ('custom',       'Personalizado',   6)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. product_options
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_options (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id        uuid        NOT NULL REFERENCES public.products(id)   ON DELETE CASCADE,
  attribute_type_id text        NOT NULL REFERENCES public.attribute_types(id),
  name              text        NOT NULL,
  position          int         NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.product_options
  USING (business_id = public.get_business_id());

CREATE INDEX IF NOT EXISTS idx_product_options_product_id
  ON public.product_options(product_id);
CREATE INDEX IF NOT EXISTS idx_product_options_business_id
  ON public.product_options(business_id);

-- ============================================================
-- 3. product_option_values
--    No RLS — access controlled through joins with product_options
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_option_values (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_id uuid NOT NULL REFERENCES public.product_options(id) ON DELETE CASCADE,
  value     text NOT NULL,
  position  int  NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_product_option_values_option_id
  ON public.product_option_values(option_id);

-- ============================================================
-- 4. product_variants
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_variants (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES public.products(id)   ON DELETE CASCADE,
  sku          text,
  barcode      text,
  price        numeric     NOT NULL DEFAULT 0,
  cost         numeric     NOT NULL DEFAULT 0,
  stock        int         NOT NULL DEFAULT 0,
  min_stock    int         NOT NULL DEFAULT 0,
  image_url    text,
  image_source text        CHECK (image_source IN ('upload', 'url')),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_variant_sku     UNIQUE (business_id, sku)     DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uq_variant_barcode UNIQUE (business_id, barcode) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.product_variants
  USING (business_id = public.get_business_id());

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id
  ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_business_id
  ON public.product_variants(business_id);

CREATE TRIGGER set_updated_at_product_variants
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 5. product_variant_option_values (join table)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_variant_option_values (
  variant_id      uuid NOT NULL REFERENCES public.product_variants(id)      ON DELETE CASCADE,
  option_value_id uuid NOT NULL REFERENCES public.product_option_values(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, option_value_id)
);

CREATE INDEX IF NOT EXISTS idx_pvov_variant_id
  ON public.product_variant_option_values(variant_id);

-- ============================================================
-- 6. Schema changes on existing tables
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS has_variants boolean NOT NULL DEFAULT false;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS variant_id uuid
    REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- ============================================================
-- 7. RPC: get_attribute_types
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_attribute_types()
RETURNS TABLE(id text, label text, "position" int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, label, position
  FROM attribute_types
  ORDER BY position;
$$;

GRANT EXECUTE ON FUNCTION public.get_attribute_types() TO authenticated;

-- ============================================================
-- 8. RPC: get_product_with_variants
--
-- Returns JSON:
--   { success, product, options: [{ id, attribute_type_id, name, position,
--     values: [{ id, value, position }] }],
--     variants: [{ id, sku, barcode, price, cost, stock, min_stock,
--       image_url, image_source, is_active, created_at, updated_at,
--       is_in_stock, option_values: [{ option_id, option_value_id, value }] }] }
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_product_with_variants(p_product_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_result      json;
BEGIN
  v_business_id := get_business_id();

  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND business_id = v_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Product not found');
  END IF;

  SELECT json_build_object(
    'success', true,
    'product', json_build_object(
      'id',              p.id,
      'business_id',     p.business_id,
      'category_id',     p.category_id,
      'brand_id',        p.brand_id,
      'name',            p.name,
      'sku',             p.sku,
      'barcode',         p.barcode,
      'price',           p.price,
      'cost',            p.cost,
      'stock',           p.stock,
      'min_stock',       p.min_stock,
      'image_url',       p.image_url,
      'image_source',    p.image_source,
      'is_active',       p.is_active,
      'show_in_catalog', p.show_in_catalog,
      'sales_count',     p.sales_count,
      'has_variants',    p.has_variants,
      'created_at',      p.created_at
    ),
    'options', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',                po.id,
          'attribute_type_id', po.attribute_type_id,
          'name',              po.name,
          'position',          po.position,
          'values', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'id',       pov.id,
                'value',    pov.value,
                'position', pov.position
              ) ORDER BY pov.position
            ), '[]'::json)
            FROM product_option_values pov
            WHERE pov.option_id = po.id
          )
        ) ORDER BY po.position
      ), '[]'::json)
      FROM product_options po
      WHERE po.product_id = p_product_id
        AND po.business_id = v_business_id
    ),
    'variants', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',           pv.id,
          'sku',          pv.sku,
          'barcode',      pv.barcode,
          'price',        pv.price,
          'cost',         pv.cost,
          'stock',        pv.stock,
          'min_stock',    pv.min_stock,
          'image_url',    pv.image_url,
          'image_source', pv.image_source,
          'is_active',    pv.is_active,
          'created_at',   pv.created_at,
          'updated_at',   pv.updated_at,
          'is_in_stock',  pv.stock > 0,
          'option_values', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'option_id',       po.id,
                'option_value_id', pov.id,
                'value',           pov.value
              )
            ), '[]'::json)
            FROM product_variant_option_values pvov
            JOIN product_option_values pov ON pov.id = pvov.option_value_id
            JOIN product_options po        ON po.id  = pov.option_id
            WHERE pvov.variant_id = pv.id
          )
        ) ORDER BY pv.created_at
      ), '[]'::json)
      FROM product_variants pv
      WHERE pv.product_id = p_product_id
        AND pv.business_id = v_business_id
        AND pv.is_active = true
    )
  )
  INTO v_result
  FROM products p
  WHERE p.id = p_product_id AND p.business_id = v_business_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_with_variants(uuid) TO authenticated;

-- ============================================================
-- 9. RPC: create_product_with_variants
--
-- p_product  jsonb — product fields (name, category_id, brand_id, sku,
--                    barcode, price, cost, min_stock, image_url,
--                    image_source, is_active, show_in_catalog)
-- p_options  jsonb — array of {
--                      attribute_type_id, name, position,
--                      values: [{ value, position }]
--                    }
-- p_variants jsonb — array of {
--                      sku, barcode, price, cost, stock, min_stock,
--                      image_url, image_source, is_active,
--                      option_value_indices: [[option_idx, value_idx], ...]
--                    }
--
-- option_value_indices references the zero-based index of the option and
-- value within p_options so the RPC can resolve the generated UUIDs.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_product_with_variants(
  p_product  jsonb,
  p_options  jsonb,
  p_variants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_product_id  uuid;
  v_option      jsonb;
  v_option_idx  int := 0;
  v_option_id   uuid;
  v_value       jsonb;
  v_value_idx   int;
  v_value_id    uuid;
  v_variant     jsonb;
  v_variant_id  uuid;
  v_ov_ref      jsonb;
  v_value_map   jsonb := '{}'::jsonb;
  v_key         text;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  END IF;

  -- 1. Insert the parent product.
  --    Stock lives at variant level; product.stock stays 0 for variant products.
  INSERT INTO products (
    business_id, category_id, brand_id, name, sku, barcode,
    price, cost, stock, min_stock, image_url, image_source,
    is_active, show_in_catalog, has_variants
  )
  VALUES (
    v_business_id,
    NULLIF(p_product->>'category_id', '')::uuid,
    NULLIF(p_product->>'brand_id', '')::uuid,
    p_product->>'name',
    NULLIF(p_product->>'sku', ''),
    NULLIF(p_product->>'barcode', ''),
    COALESCE((p_product->>'price')::numeric, 0),
    COALESCE((p_product->>'cost')::numeric, 0),
    0,
    COALESCE((p_product->>'min_stock')::int, 0),
    NULLIF(p_product->>'image_url', ''),
    NULLIF(p_product->>'image_source', ''),
    COALESCE((p_product->>'is_active')::boolean, true),
    COALESCE((p_product->>'show_in_catalog')::boolean, true),
    true
  )
  RETURNING id INTO v_product_id;

  -- 2. Insert options and values, building [option_idx:value_idx] → uuid map
  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    INSERT INTO product_options (
      business_id, product_id, attribute_type_id, name, position
    )
    VALUES (
      v_business_id,
      v_product_id,
      v_option->>'attribute_type_id',
      v_option->>'name',
      COALESCE((v_option->>'position')::int, v_option_idx)
    )
    RETURNING id INTO v_option_id;

    v_value_idx := 0;
    FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
    LOOP
      INSERT INTO product_option_values (option_id, value, position)
      VALUES (
        v_option_id,
        v_value->>'value',
        COALESCE((v_value->>'position')::int, v_value_idx)
      )
      RETURNING id INTO v_value_id;

      v_key := v_option_idx::text || ':' || v_value_idx::text;
      v_value_map := v_value_map || jsonb_build_object(v_key, v_value_id::text);
      v_value_idx := v_value_idx + 1;
    END LOOP;

    v_option_idx := v_option_idx + 1;
  END LOOP;

  -- 3. Insert variants and link their option values via the index map
  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    INSERT INTO product_variants (
      business_id, product_id, sku, barcode, price, cost,
      stock, min_stock, image_url, image_source, is_active
    )
    VALUES (
      v_business_id,
      v_product_id,
      NULLIF(v_variant->>'sku', ''),
      NULLIF(v_variant->>'barcode', ''),
      COALESCE((v_variant->>'price')::numeric, 0),
      COALESCE((v_variant->>'cost')::numeric, 0),
      COALESCE((v_variant->>'stock')::int, 0),
      COALESCE((v_variant->>'min_stock')::int, 0),
      NULLIF(v_variant->>'image_url', ''),
      NULLIF(v_variant->>'image_source', ''),
      COALESCE((v_variant->>'is_active')::boolean, true)
    )
    RETURNING id INTO v_variant_id;

    FOR v_ov_ref IN SELECT * FROM jsonb_array_elements(v_variant->'option_value_indices')
    LOOP
      v_key := (v_ov_ref->0)::text || ':' || (v_ov_ref->1)::text;
      v_value_id := (v_value_map->>v_key)::uuid;
      IF v_value_id IS NOT NULL THEN
        INSERT INTO product_variant_option_values (variant_id, option_value_id)
        VALUES (v_variant_id, v_value_id);
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_variants(jsonb, jsonb, jsonb) TO authenticated;

-- ============================================================
-- 10. RPC: update_product_variants
--
-- p_options  jsonb — array of options. Each option:
--   Existing: { id, attribute_type_id, name, position,
--               values: [{ id?, value, position }] }
--   New:      { attribute_type_id, name, position,
--               values: [{ value, position }] }
--
-- p_variants jsonb — complete desired set of active variants. Each variant:
--   Existing: { id, sku, barcode, price, cost, stock, min_stock,
--               image_url, image_source, is_active }
--   New:      { sku, barcode, price, cost, stock, min_stock,
--               image_url, image_source, is_active,
--               option_value_ids: ["uuid", ...] }
--
-- Variants absent from p_variants but active in DB → set is_active = false.
-- Option values for existing variants are immutable (identified by their combo).
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_product_variants(
  p_product_id uuid,
  p_options    jsonb,
  p_variants   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id  uuid;
  v_option       jsonb;
  v_option_id    uuid;
  v_value        jsonb;
  v_variant      jsonb;
  v_variant_id   uuid;
  v_ov_id        jsonb;
  v_active_ids   uuid[] := '{}';
  v_active_count int;
BEGIN
  v_business_id := get_business_id();

  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND business_id = v_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Product not found');
  END IF;

  -- 1. Upsert options (existing options are never deleted)
  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    IF (v_option->>'id') IS NOT NULL THEN
      UPDATE product_options
      SET
        attribute_type_id = COALESCE(v_option->>'attribute_type_id', attribute_type_id),
        name              = COALESCE(v_option->>'name', name),
        position          = COALESCE((v_option->>'position')::int, position)
      WHERE id = (v_option->>'id')::uuid AND business_id = v_business_id;

      -- Upsert values for the existing option
      FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
      LOOP
        IF (v_value->>'id') IS NOT NULL THEN
          UPDATE product_option_values
          SET
            value    = COALESCE(v_value->>'value', value),
            position = COALESCE((v_value->>'position')::int, position)
          WHERE id = (v_value->>'id')::uuid
            AND option_id = (v_option->>'id')::uuid;
        ELSE
          INSERT INTO product_option_values (option_id, value, position)
          VALUES (
            (v_option->>'id')::uuid,
            v_value->>'value',
            COALESCE((v_value->>'position')::int, 0)
          );
        END IF;
      END LOOP;
    ELSE
      -- Insert new option
      INSERT INTO product_options (
        business_id, product_id, attribute_type_id, name, position
      )
      VALUES (
        v_business_id,
        p_product_id,
        v_option->>'attribute_type_id',
        v_option->>'name',
        COALESCE((v_option->>'position')::int, 0)
      )
      RETURNING id INTO v_option_id;

      FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
      LOOP
        INSERT INTO product_option_values (option_id, value, position)
        VALUES (
          v_option_id,
          v_value->>'value',
          COALESCE((v_value->>'position')::int, 0)
        );
      END LOOP;
    END IF;
  END LOOP;

  -- 2. Upsert variants; collect the ids of all variants in the input
  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    IF (v_variant->>'id') IS NOT NULL THEN
      -- Update existing variant metadata (option_value links are immutable)
      UPDATE product_variants
      SET
        sku          = NULLIF(v_variant->>'sku', ''),
        barcode      = NULLIF(v_variant->>'barcode', ''),
        price        = COALESCE((v_variant->>'price')::numeric, price),
        cost         = COALESCE((v_variant->>'cost')::numeric, cost),
        stock        = COALESCE((v_variant->>'stock')::int, stock),
        min_stock    = COALESCE((v_variant->>'min_stock')::int, min_stock),
        image_url    = NULLIF(v_variant->>'image_url', ''),
        image_source = NULLIF(v_variant->>'image_source', ''),
        is_active    = COALESCE((v_variant->>'is_active')::boolean, true)
      WHERE id = (v_variant->>'id')::uuid AND business_id = v_business_id;

      v_variant_id := (v_variant->>'id')::uuid;
    ELSE
      -- Insert new variant
      INSERT INTO product_variants (
        business_id, product_id, sku, barcode, price, cost,
        stock, min_stock, image_url, image_source, is_active
      )
      VALUES (
        v_business_id,
        p_product_id,
        NULLIF(v_variant->>'sku', ''),
        NULLIF(v_variant->>'barcode', ''),
        COALESCE((v_variant->>'price')::numeric, 0),
        COALESCE((v_variant->>'cost')::numeric, 0),
        COALESCE((v_variant->>'stock')::int, 0),
        COALESCE((v_variant->>'min_stock')::int, 0),
        NULLIF(v_variant->>'image_url', ''),
        NULLIF(v_variant->>'image_source', ''),
        COALESCE((v_variant->>'is_active')::boolean, true)
      )
      RETURNING id INTO v_variant_id;

      -- Link option values (caller passes known UUIDs)
      FOR v_ov_id IN SELECT * FROM jsonb_array_elements(v_variant->'option_value_ids')
      LOOP
        INSERT INTO product_variant_option_values (variant_id, option_value_id)
        VALUES (v_variant_id, (v_ov_id#>>'{}')::uuid)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    v_active_ids := array_append(v_active_ids, v_variant_id);
  END LOOP;

  -- 3. Soft-delete variants absent from the input
  UPDATE product_variants
  SET is_active = false
  WHERE product_id   = p_product_id
    AND business_id  = v_business_id
    AND is_active    = true
    AND id <> ALL(v_active_ids);

  -- 4. Sync has_variants flag
  SELECT COUNT(*)::int INTO v_active_count
  FROM product_variants
  WHERE product_id  = p_product_id
    AND business_id = v_business_id
    AND is_active   = true;

  UPDATE products
  SET has_variants = (v_active_count > 0)
  WHERE id = p_product_id AND business_id = v_business_id;

  RETURN jsonb_build_object('success', true, 'active_variants', v_active_count);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_product_variants(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================
-- 11. Modify trigger: update_stock_on_sale
--     When variant_id IS NOT NULL → decrement product_variants.stock
--     and update products.sales_count.
--     When variant_id IS NULL     → original behavior (no change).
--     Guard added for free-line items (product_id IS NULL).
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Free-line items have no product; nothing to decrement.
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.variant_id IS NOT NULL THEN
    -- Variant sale: stock lives on the variant row.
    UPDATE product_variants
    SET stock = stock - NEW.quantity
    WHERE id = NEW.variant_id;

    UPDATE products
    SET sales_count = sales_count + NEW.quantity
    WHERE id = NEW.product_id;
  ELSE
    -- Standard product sale: original behavior.
    UPDATE products
    SET
      stock       = stock - NEW.quantity,
      sales_count = sales_count + NEW.quantity
    WHERE id = NEW.product_id;
  END IF;

  INSERT INTO inventory_movements (
    business_id, product_id, type, quantity, reason, reference_id
  )
  SELECT s.business_id, NEW.product_id, 'sale', -NEW.quantity, 'Venta', NEW.sale_id
  FROM sales s
  WHERE s.id = NEW.sale_id;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 12. Modify RPC: update_sale
--     Step 1 (stock restore) bifurcated: variant items restore to
--     product_variants.stock; non-variant items restore to products.stock.
--     Step 3 (re-insert) now passes variant_id so the trigger above
--     correctly handles stock deduction for variant items.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_sale(
  p_sale_id        uuid,
  p_business_id    uuid,
  p_items          jsonb,
  p_payment_method text,
  p_status         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric(12,2);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  -- 1a. Restore stock for non-variant items → products
  UPDATE products p
  SET
    stock       = p.stock + si.quantity,
    sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND p.id          = si.product_id
    AND si.variant_id IS NULL;

  -- 1b. Restore stock for variant items → product_variants
  UPDATE product_variants pv
  SET stock = pv.stock + si.quantity
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND pv.id         = si.variant_id
    AND si.variant_id IS NOT NULL;

  -- 1c. Restore sales_count for variant items → products
  UPDATE products p
  SET sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id    = p_sale_id
    AND p.id          = si.product_id
    AND si.variant_id IS NOT NULL;

  -- 2. Delete old items
  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  -- 3. Insert new items — trigger update_stock_on_sale handles stock deduction
  INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, unit_price, total)
  SELECT
    p_sale_id,
    (item->>'product_id')::uuid,
    NULLIF(item->>'variant_id', '')::uuid,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric(12,2),
    (item->>'quantity')::int * (item->>'unit_price')::numeric(12,2)
  FROM jsonb_array_elements(p_items) AS item;

  -- 4. Calculate new total
  SELECT COALESCE(SUM(total), 0) INTO v_total
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- 5. Update sale header
  UPDATE sales
  SET
    total    = v_total,
    subtotal = v_total,
    status   = COALESCE(p_status, status)
  WHERE id = p_sale_id AND business_id = p_business_id;

  -- 6. Update payment method
  UPDATE payments
  SET method = p_payment_method
  WHERE sale_id = p_sale_id;

  PERFORM reconcile_sales_count(p_business_id);

  RETURN jsonb_build_object('success', true, 'total', v_total);
END;
$$;
