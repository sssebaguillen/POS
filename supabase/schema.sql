-- =============================================================================
-- PULSAR POS — DATABASE SCHEMA
-- Supabase project: zrnthcznbrplzpmxmkwk (sa-east-1)
-- Generated: 2026-04-11
-- =============================================================================
-- Solo estructura: tablas, tipos, constraints, índices, triggers, RLS, funciones.
-- No incluye datos.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA graphql;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;


-- ---------------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------------
CREATE TYPE public.expense_category AS ENUM (
  'mercaderia',
  'alquiler',
  'servicios',
  'seguros',
  'proveedores',
  'sueldos',
  'otro'
);

CREATE TYPE public.expense_attachment_type AS ENUM (
  'image',
  'pdf',
  'spreadsheet',
  'other'
);


-- ---------------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------------

-- businesses
CREATE TABLE public.businesses (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL,
  plan        text        NOT NULL DEFAULT 'free',
  settings    jsonb                DEFAULT '{}'::jsonb,
  created_at  timestamptz          DEFAULT now(),
  whatsapp    text,
  logo_url    text,
  description text,
  CONSTRAINT businesses_pkey PRIMARY KEY (id),
  CONSTRAINT businesses_slug_key UNIQUE (slug)
);

-- profiles
CREATE TABLE public.profiles (
  id          uuid        NOT NULL,
  business_id uuid,
  role        text        NOT NULL DEFAULT 'cashier',
  name        text        NOT NULL,
  pin         text,
  created_at  timestamptz          DEFAULT now(),
  permissions jsonb       NOT NULL DEFAULT '{"sales": true, "stats": true, "stock": true, "settings": false}'::jsonb,
  avatar_url  text,
  onboarding_state jsonb NOT NULL DEFAULT '{"completed": false, "wizard_step": 0, "steps_done": [], "tour_done": false, "wizard_suppressed": false}'::jsonb,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE
);

-- operators
CREATE TABLE public.operators (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL,
  name        text        NOT NULL,
  role        text        NOT NULL DEFAULT 'cashier',
  pin         text        NOT NULL,
  permissions jsonb       NOT NULL DEFAULT '{"sales": true, "stock": false, "stock_write": false, "stats": false, "price_lists": false, "price_lists_write": false, "settings": false, "operators_write": false, "expenses": false}'::jsonb,
  is_active   boolean              DEFAULT true,
  created_at  timestamptz          DEFAULT now(),
  CONSTRAINT operators_pkey PRIMARY KEY (id),
  CONSTRAINT operators_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE
);

-- brands
CREATE TABLE public.brands (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brands_pkey PRIMARY KEY (id),
  CONSTRAINT unique_brand_per_business UNIQUE (business_id, name),
  CONSTRAINT brands_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE
);

-- categories
CREATE TABLE public.categories (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid,
  name        text        NOT NULL,
  icon        text                 DEFAULT '📦',
  position    integer              DEFAULT 0,
  is_active   boolean              DEFAULT true,
  created_at  timestamptz          DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id),
  CONSTRAINT categories_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE
);

-- products
CREATE TABLE public.products (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id     uuid,
  category_id     uuid,
  name            text        NOT NULL,
  sku             text,
  barcode         text,
  price           numeric     NOT NULL DEFAULT 0,
  cost            numeric              DEFAULT 0,
  stock           integer     NOT NULL DEFAULT 0,
  min_stock       integer              DEFAULT 0,
  image_url       text,
  is_active       boolean              DEFAULT true,
  show_in_catalog boolean              DEFAULT true,
  sales_count     integer              DEFAULT 0,
  created_at      timestamptz          DEFAULT now(),
  brand_id        uuid,
  image_source    text,
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT unique_sku_per_business     UNIQUE (business_id, sku),
  CONSTRAINT unique_barcode_per_business UNIQUE (business_id, barcode),
  CONSTRAINT products_business_id_fkey  FOREIGN KEY (business_id)  REFERENCES public.businesses (id)  ON DELETE CASCADE,
  CONSTRAINT products_category_id_fkey  FOREIGN KEY (category_id)  REFERENCES public.categories (id)  ON DELETE SET NULL,
  CONSTRAINT products_brand_id_fkey     FOREIGN KEY (brand_id)     REFERENCES public.brands (id)      ON DELETE SET NULL
);

-- price_lists
CREATE TABLE public.price_lists (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid        NOT NULL,
  name        text        NOT NULL,
  description text,
  multiplier  numeric     NOT NULL DEFAULT 1.0,
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_lists_pkey PRIMARY KEY (id),
  CONSTRAINT price_lists_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE
);

-- price_list_overrides
CREATE TABLE public.price_list_overrides (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  price_list_id uuid        NOT NULL,
  product_id    uuid,
  multiplier    numeric     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  brand_id      uuid,
  CONSTRAINT price_list_overrides_pkey            PRIMARY KEY (id),
  CONSTRAINT unique_override_per_list_product     UNIQUE (price_list_id, product_id),
  CONSTRAINT unique_override_per_list_brand_id    UNIQUE (price_list_id, brand_id),
  CONSTRAINT price_list_overrides_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES public.price_lists (id) ON DELETE CASCADE,
  CONSTRAINT price_list_overrides_product_id_fkey    FOREIGN KEY (product_id)    REFERENCES public.products (id)    ON DELETE CASCADE,
  CONSTRAINT price_list_overrides_brand_id_fkey      FOREIGN KEY (brand_id)      REFERENCES public.brands (id)      ON DELETE CASCADE
);

-- customers
CREATE TABLE public.customers (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id    uuid,
  name           text        NOT NULL,
  phone          text,
  email          text,
  dni            text,
  credit_balance numeric              DEFAULT 0,
  notes          text,
  created_at     timestamptz          DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id),
  CONSTRAINT customers_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE
);

-- cash_sessions
CREATE TABLE public.cash_sessions (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id     uuid,
  opened_by       uuid,
  closed_by       uuid,
  opening_amount  numeric              DEFAULT 0,
  closing_amount  numeric,
  expected_amount numeric,
  opened_at       timestamptz          DEFAULT now(),
  closed_at       timestamptz,
  notes           text,
  CONSTRAINT cash_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT cash_sessions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE,
  CONSTRAINT cash_sessions_opened_by_fkey   FOREIGN KEY (opened_by)   REFERENCES public.profiles (id),
  CONSTRAINT cash_sessions_closed_by_fkey   FOREIGN KEY (closed_by)   REFERENCES public.profiles (id)
);

-- sales
CREATE TABLE public.sales (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id   uuid,
  session_id    uuid,
  customer_id   uuid,
  subtotal      numeric     NOT NULL DEFAULT 0,
  discount      numeric              DEFAULT 0,
  total         numeric     NOT NULL DEFAULT 0,
  status        text                 DEFAULT 'completed',
  notes         text,
  created_at    timestamptz          DEFAULT now(),
  price_list_id uuid,
  operator_id   uuid,
  CONSTRAINT sales_pkey PRIMARY KEY (id),
  CONSTRAINT sales_business_id_fkey   FOREIGN KEY (business_id)   REFERENCES public.businesses (id)   ON DELETE CASCADE,
  CONSTRAINT sales_session_id_fkey    FOREIGN KEY (session_id)    REFERENCES public.cash_sessions (id),
  CONSTRAINT sales_customer_id_fkey   FOREIGN KEY (customer_id)   REFERENCES public.customers (id)    ON DELETE SET NULL,
  CONSTRAINT sales_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES public.price_lists (id)  ON DELETE SET NULL,
  CONSTRAINT sales_operator_id_fkey   FOREIGN KEY (operator_id)   REFERENCES public.operators (id)    ON DELETE SET NULL
);

-- sale_items
CREATE TABLE public.sale_items (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  sale_id             uuid,
  product_id          uuid,
  quantity            integer     NOT NULL DEFAULT 1,
  unit_price          numeric     NOT NULL,
  total               numeric     NOT NULL,
  unit_price_override numeric,
  override_reason     text,
  CONSTRAINT sale_items_pkey PRIMARY KEY (id),
  CONSTRAINT sale_items_sale_id_fkey    FOREIGN KEY (sale_id)    REFERENCES public.sales (id)    ON DELETE CASCADE,
  CONSTRAINT sale_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products (id) ON DELETE SET NULL
);

-- payments
CREATE TABLE public.payments (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  sale_id    uuid,
  method     text        NOT NULL,
  amount     numeric     NOT NULL,
  reference  text,
  status     text                 DEFAULT 'completed',
  created_at timestamptz          DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales (id) ON DELETE CASCADE
);

-- inventory_movements
CREATE TABLE public.inventory_movements (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id         uuid,
  product_id          uuid,
  type                text        NOT NULL,
  quantity            integer     NOT NULL,
  reason              text,
  reference_id        uuid,
  created_by          uuid,
  created_at          timestamptz          DEFAULT now(),
  created_by_operator uuid,
  CONSTRAINT inventory_movements_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_movements_business_id_fkey      FOREIGN KEY (business_id)         REFERENCES public.businesses (id) ON DELETE CASCADE,
  CONSTRAINT inventory_movements_product_id_fkey       FOREIGN KEY (product_id)          REFERENCES public.products (id)  ON DELETE SET NULL,
  CONSTRAINT inventory_movements_created_by_operator_fkey FOREIGN KEY (created_by_operator) REFERENCES public.operators (id) ON DELETE SET NULL
);

-- suppliers
CREATE TABLE public.suppliers (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  business_id  uuid        NOT NULL,
  name         text        NOT NULL,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  notes        text,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_pkey PRIMARY KEY (id),
  CONSTRAINT suppliers_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses (id) ON DELETE CASCADE
);

-- expenses
CREATE TABLE public.expenses (
  id              uuid                        NOT NULL DEFAULT gen_random_uuid(),
  business_id     uuid                        NOT NULL,
  operator_id     uuid,
  supplier_id     uuid,
  category        public.expense_category     NOT NULL DEFAULT 'otro',
  amount          numeric                     NOT NULL,
  description     text                        NOT NULL,
  date            date                        NOT NULL DEFAULT CURRENT_DATE,
  attachment_url  text,
  attachment_type public.expense_attachment_type,
  attachment_name text,
  notes           text,
  created_at      timestamptz                 NOT NULL DEFAULT now(),
  updated_at      timestamptz                 NOT NULL DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_business_id_fkey  FOREIGN KEY (business_id)  REFERENCES public.businesses (id) ON DELETE CASCADE,
  CONSTRAINT expenses_operator_id_fkey  FOREIGN KEY (operator_id)  REFERENCES public.operators (id)  ON DELETE SET NULL,
  CONSTRAINT expenses_supplier_id_fkey  FOREIGN KEY (supplier_id)  REFERENCES public.suppliers (id)  ON DELETE SET NULL
);


-- ---------------------------------------------------------------------------
-- INDEXES (performance, non-PK/unique)
-- ---------------------------------------------------------------------------

-- cash_sessions
CREATE INDEX idx_cash_sessions_business_id ON public.cash_sessions USING btree (business_id);
CREATE INDEX idx_cash_sessions_opened_by   ON public.cash_sessions USING btree (opened_by);
CREATE INDEX idx_cash_sessions_closed_by   ON public.cash_sessions USING btree (closed_by);

-- categories
CREATE INDEX idx_categories_business_id ON public.categories USING btree (business_id);

-- customers
CREATE INDEX idx_customers_business_id ON public.customers USING btree (business_id);

-- expenses
CREATE INDEX expenses_date_idx     ON public.expenses USING btree (business_id, date DESC);
CREATE INDEX expenses_category_idx ON public.expenses USING btree (business_id, category);
CREATE INDEX idx_expenses_operator_id ON public.expenses USING btree (operator_id);
CREATE INDEX idx_expenses_supplier_id ON public.expenses USING btree (supplier_id);

-- inventory_movements
CREATE INDEX idx_inventory_movements_business_id ON public.inventory_movements USING btree (business_id);
CREATE INDEX idx_inventory_movements_product_id  ON public.inventory_movements USING btree (product_id);
CREATE INDEX idx_inventory_movements_operator    ON public.inventory_movements USING btree (created_by_operator);

-- operators
CREATE INDEX idx_operators_business_id ON public.operators USING btree (business_id);

-- payments
CREATE INDEX idx_payments_sale_id ON public.payments USING btree (sale_id);

-- price_list_overrides
CREATE INDEX idx_price_list_overrides_price_list_id ON public.price_list_overrides USING btree (price_list_id);
CREATE INDEX idx_price_list_overrides_product_id    ON public.price_list_overrides USING btree (product_id);
CREATE INDEX idx_price_list_overrides_brand_id      ON public.price_list_overrides USING btree (brand_id);

-- price_lists
CREATE INDEX idx_price_lists_business_id ON public.price_lists USING btree (business_id);
CREATE UNIQUE INDEX unique_default_price_list_per_business ON public.price_lists USING btree (business_id) WHERE (is_default = true);

-- products
CREATE INDEX idx_products_business_id     ON public.products USING btree (business_id);
CREATE INDEX idx_products_business_active ON public.products USING btree (business_id, is_active);
CREATE INDEX idx_products_category_id     ON public.products USING btree (category_id);
CREATE INDEX idx_products_brand_id        ON public.products USING btree (brand_id) WHERE (brand_id IS NOT NULL);
CREATE INDEX idx_products_sku             ON public.products USING btree (sku)      WHERE (sku IS NOT NULL);
CREATE INDEX idx_products_barcode         ON public.products USING btree (barcode)  WHERE (barcode IS NOT NULL);

-- profiles
CREATE INDEX idx_profiles_business_id ON public.profiles USING btree (business_id);

-- sale_items
CREATE INDEX idx_sale_items_sale_id    ON public.sale_items USING btree (sale_id);
CREATE INDEX idx_sale_items_product_id ON public.sale_items USING btree (product_id);

-- sales
CREATE INDEX idx_sales_business_created ON public.sales USING btree (business_id, created_at DESC);
CREATE INDEX idx_sales_session_id       ON public.sales USING btree (session_id);
CREATE INDEX idx_sales_price_list_id    ON public.sales USING btree (price_list_id);
CREATE INDEX idx_sales_customer_id      ON public.sales USING btree (customer_id) WHERE (customer_id IS NOT NULL);
CREATE INDEX sales_operator_id_idx      ON public.sales USING btree (operator_id);

-- suppliers
CREATE INDEX suppliers_business_id_idx ON public.suppliers USING btree (business_id);


-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

ALTER TABLE public.businesses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operators           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses            ENABLE ROW LEVEL SECURITY;

-- businesses
CREATE POLICY "tenant_isolation" ON public.businesses
  FOR ALL USING (id = get_business_id());

CREATE POLICY "public_read_businesses" ON public.businesses
  FOR SELECT USING (
    (SELECT auth.role()) = 'anon' OR id = get_business_id()
  );

-- profiles
CREATE POLICY "own_profile" ON public.profiles
  FOR ALL USING (id = auth.uid());

CREATE POLICY "insert_own_profile" ON public.profiles
  FOR INSERT WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "tenant_select_profiles" ON public.profiles
  FOR SELECT USING (business_id = get_business_id());

-- operators
CREATE POLICY "tenant_isolation" ON public.operators
  FOR ALL USING (business_id = get_business_id());

-- brands
CREATE POLICY "tenant_isolation" ON public.brands
  FOR ALL USING (business_id = get_business_id());

-- categories
CREATE POLICY "tenant_isolation" ON public.categories
  FOR ALL USING (business_id = get_business_id());

CREATE POLICY "public_read_categories" ON public.categories
  FOR SELECT USING (business_id = get_business_id());

-- products
CREATE POLICY "tenant_isolation" ON public.products
  FOR ALL USING (business_id = get_business_id());

CREATE POLICY "public_read_products" ON public.products
  FOR SELECT USING (business_id = get_business_id());

-- price_lists
CREATE POLICY "tenant_isolation" ON public.price_lists
  FOR ALL USING (business_id = get_business_id());

-- price_list_overrides
CREATE POLICY "tenant_isolation" ON public.price_list_overrides
  FOR ALL USING (
    price_list_id IN (
      SELECT id FROM public.price_lists WHERE business_id = get_business_id()
    )
  );

-- customers
CREATE POLICY "tenant_isolation" ON public.customers
  FOR ALL USING (business_id = get_business_id());

-- cash_sessions
CREATE POLICY "tenant_isolation" ON public.cash_sessions
  FOR ALL USING (business_id = get_business_id());

-- sales
CREATE POLICY "tenant_isolation" ON public.sales
  FOR ALL USING (business_id = get_business_id());

-- sale_items
CREATE POLICY "tenant_isolation" ON public.sale_items
  FOR ALL USING (
    sale_id IN (
      SELECT id FROM public.sales WHERE business_id = get_business_id()
    )
  );

-- payments
CREATE POLICY "tenant_isolation" ON public.payments
  FOR ALL USING (
    sale_id IN (
      SELECT id FROM public.sales WHERE business_id = get_business_id()
    )
  );

-- inventory_movements
CREATE POLICY "tenant_isolation" ON public.inventory_movements
  FOR ALL USING (business_id = get_business_id());

-- suppliers
CREATE POLICY "suppliers_business_access" ON public.suppliers
  FOR ALL USING (business_id = get_business_id());

-- expenses
CREATE POLICY "expenses_business_access" ON public.expenses
  FOR ALL USING (business_id = get_business_id());


-- ---------------------------------------------------------------------------
-- FUNCTIONS & RPCs
-- ---------------------------------------------------------------------------

-- get_business_id: helper central de tenant isolation
CREATE OR REPLACE FUNCTION public.get_business_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT business_id FROM profiles WHERE id = (SELECT auth.uid())
$$;

-- bootstrap_new_user
CREATE OR REPLACE FUNCTION public.bootstrap_new_user(
  p_user_id       uuid,
  p_business_name text,
  p_user_name     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_business_id uuid;
  v_slug text;
begin
  v_slug := lower(regexp_replace(p_business_name, '\s+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
  v_slug := v_slug || '-' || extract(epoch from now())::bigint;

  insert into businesses (name, slug)
  values (p_business_name, v_slug)
  returning id into v_business_id;

  insert into profiles (id, business_id, role, name)
  values (p_user_id, v_business_id, 'owner', p_user_name);

  return json_build_object(
    'business_id', v_business_id,
    'success', true
  );
exception
  when others then
    return json_build_object(
      'success', false,
      'error', sqlerrm
    );
end;
$$;

-- create_operator
CREATE OR REPLACE FUNCTION public.create_operator(
  p_business_id uuid,
  p_name        text,
  p_role        text,
  p_pin         text,
  p_permissions jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_default_permissions jsonb;
  v_final_permissions   jsonb;
  v_operator_id         uuid;
BEGIN
  v_default_permissions := CASE p_role
    WHEN 'manager' THEN
      '{"sales": true, "stock": true, "stock_write": true, "stats": true, "price_lists": true, "price_lists_write": true, "settings": false, "operators_write": false, "expenses": false}'::jsonb
    WHEN 'cashier' THEN
      '{"sales": true, "stock": true, "stock_write": false, "stats": false, "price_lists": false, "price_lists_write": false, "settings": false, "operators_write": false, "expenses": false}'::jsonb
    ELSE
      '{"sales": true, "stock": false, "stock_write": false, "stats": false, "price_lists": false, "price_lists_write": false, "settings": false, "operators_write": false, "expenses": false}'::jsonb
  END;

  v_final_permissions := COALESCE(p_permissions, v_default_permissions);

  -- Garantizar campos obligatorios aunque se pase p_permissions parcial
  IF (v_final_permissions->>'expenses') IS NULL THEN
    v_final_permissions := v_final_permissions || '{"expenses": false}'::jsonb;
  END IF;
  IF (v_final_permissions->>'operators_write') IS NULL THEN
    v_final_permissions := v_final_permissions || '{"operators_write": false}'::jsonb;
  END IF;

  INSERT INTO operators (business_id, name, role, pin, permissions)
  VALUES (
    p_business_id,
    p_name,
    p_role,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    v_final_permissions
  )
  RETURNING id INTO v_operator_id;

  RETURN json_build_object('success', true, 'operator_id', v_operator_id);
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;

-- verify_operator_pin
CREATE OR REPLACE FUNCTION public.verify_operator_pin(
  p_business_id uuid,
  p_operator_id uuid,
  p_pin         text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
declare
  v_operator operators%rowtype;
begin
  select * into v_operator
  from operators
  where id = p_operator_id
    and business_id = p_business_id
    and is_active = true;

  if not found then
    return json_build_object('success', false, 'error', 'Operador no encontrado');
  end if;

  if v_operator.pin != extensions.crypt(p_pin, v_operator.pin) then
    return json_build_object('success', false, 'error', 'PIN incorrecto');
  end if;

  return json_build_object(
    'success', true,
    'profile_id', v_operator.id,
    'name', v_operator.name,
    'role', v_operator.role,
    'permissions', v_operator.permissions
  );
exception
  when others then
    return json_build_object('success', false, 'error', sqlerrm);
end;
$$;

-- create_category_guarded
CREATE OR REPLACE FUNCTION public.create_category_guarded(
  p_operator_id uuid,
  p_business_id uuid,
  p_name        text,
  p_icon        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_new_id             uuid;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT permissions->>'stock_write' INTO v_stock_write
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
  END IF;

  INSERT INTO categories (business_id, name, icon, is_active)
  VALUES (v_caller_business_id, btrim(p_name), btrim(p_icon), true)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

-- create_brand_guarded
CREATE OR REPLACE FUNCTION public.create_brand_guarded(
  p_operator_id uuid,
  p_business_id uuid,
  p_name        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_new_id             uuid;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT permissions->>'stock_write' INTO v_stock_write
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
  END IF;

  INSERT INTO brands (business_id, name)
  VALUES (v_caller_business_id, btrim(p_name))
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

-- swap_default_price_list
CREATE OR REPLACE FUNCTION public.swap_default_price_list(
  p_price_list_id uuid,
  p_business_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE price_lists SET is_default = false WHERE business_id = p_business_id AND is_default = true;
  UPDATE price_lists SET is_default = true  WHERE id = p_price_list_id AND business_id = p_business_id;
END;
$$;

-- reconcile_sales_count
CREATE OR REPLACE FUNCTION public.reconcile_sales_count(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_business_id != get_business_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE products
  SET sales_count = (
    SELECT COALESCE(SUM(si.quantity), 0)
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND si.product_id = products.id
  )
  WHERE business_id = p_business_id;
END;
$$;

-- set_updated_at (trigger function)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- update_stock_on_sale (trigger function)
CREATE OR REPLACE FUNCTION public.update_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  update products
  set
    stock       = stock - new.quantity,
    sales_count = sales_count + new.quantity
  where id = new.product_id;

  insert into inventory_movements (business_id, product_id, type, quantity, reason, reference_id)
  select s.business_id, new.product_id, 'sale', -new.quantity, 'Venta', new.sale_id
  from sales s where s.id = new.sale_id;

  return new;
end;
$$;

-- create_sale_transaction
CREATE OR REPLACE FUNCTION public.create_sale_transaction(
  p_business_id    uuid,
  p_subtotal       numeric,
  p_discount       numeric,
  p_total          numeric,
  p_status         text,
  p_price_list_id  uuid,
  p_operator_id    uuid,
  p_items          jsonb,
  p_payment_method text,
  p_payment_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
begin
  v_caller_business_id := get_business_id();
  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    return jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un item');
  end if;

  insert into sales (business_id, subtotal, discount, total, status, price_list_id, operator_id)
  values (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id)
  returning id, created_at into v_sale_id, v_sale_created_at;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into sale_items (sale_id, product_id, quantity, unit_price, total, unit_price_override, override_reason)
    values (
      v_sale_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      (v_item->>'unit_price_override')::numeric,
      v_item->>'override_reason'
    );
  end loop;

  insert into payments (sale_id, method, amount, status)
  values (v_sale_id, p_payment_method, p_payment_amount, 'completed');

  return jsonb_build_object(
    'success', true,
    'sale_id', v_sale_id,
    'created_at', v_sale_created_at
  );

exception when others then
  return jsonb_build_object('success', false, 'error', SQLERRM);
end;
$$;

-- update_sale
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
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric(12,2);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  -- 1. Restaurar stock de los items anteriores
  UPDATE products p
  SET
    stock       = p.stock + si.quantity,
    sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id = p_sale_id AND p.id = si.product_id;

  -- 2. Eliminar items viejos
  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  -- 3. Insertar nuevos items (trigger on_sale_item_inserted descuenta stock)
  INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total)
  SELECT
    p_sale_id,
    (item->>'product_id')::uuid,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric(12,2),
    (item->>'quantity')::int * (item->>'unit_price')::numeric(12,2)
  FROM jsonb_array_elements(p_items) AS item;

  -- 4. Calcular total
  SELECT COALESCE(SUM(total), 0) INTO v_total
  FROM sale_items
  WHERE sale_id = p_sale_id;

  -- 5. Actualizar cabecera
  UPDATE sales
  SET
    total    = v_total,
    subtotal = v_total,
    status   = COALESCE(p_status, status)
  WHERE id = p_sale_id AND business_id = p_business_id;

  -- 6. Actualizar método de pago
  UPDATE payments
  SET method = p_payment_method
  WHERE sale_id = p_sale_id;

  PERFORM reconcile_sales_count(p_business_id);

  RETURN jsonb_build_object('success', true, 'total', v_total);
END;
$$;

-- delete_sale
CREATE OR REPLACE FUNCTION public.delete_sale(
  p_sale_id     uuid,
  p_business_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Sale not found');
  END IF;

  FOR v_item IN
    SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    UPDATE products
    SET
      stock       = stock + v_item.quantity,
      sales_count = GREATEST(0, sales_count - v_item.quantity)
    WHERE id = v_item.product_id
      AND business_id = p_business_id;
  END LOOP;

  DELETE FROM inventory_movements WHERE reference_id = p_sale_id;
  DELETE FROM payments WHERE sale_id = p_sale_id;
  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM sales WHERE id = p_sale_id AND business_id = p_business_id;

  PERFORM reconcile_sales_count(p_business_id);

  RETURN json_build_object('success', true);
END;
$$;

-- get_sale_detail
CREATE OR REPLACE FUNCTION public.get_sale_detail(
  p_sale_id     uuid,
  p_business_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_result json;
begin
  if not exists (
    select 1 from sales where id = p_sale_id and business_id = p_business_id
  ) then
    return json_build_object('success', false, 'error', 'Sale not found');
  end if;

  select json_build_object(
    'success',        true,
    'operator_name',  coalesce(direct_op.name, session_op.name),
    'payment_method', pay.method,
    'items', (
      select json_agg(json_build_object(
        'id',           si.id,
        'product_id',   si.product_id,
        'product_name', coalesce(p.name, 'Producto eliminado'),
        'product_icon', cat.icon,
        'quantity',     si.quantity,
        'unit_price',   si.unit_price
      ) order by si.id)
      from sale_items si
      left join products p     on p.id = si.product_id
      left join categories cat on cat.id = p.category_id
      where si.sale_id = p_sale_id
    )
  )
  into v_result
  from sales s
  left join operators direct_op  on direct_op.id = s.operator_id
  left join cash_sessions cs     on cs.id = s.session_id
  left join operators session_op on session_op.id = cs.opened_by
  left join lateral (
    select method from payments
    where sale_id = p_sale_id
    order by created_at desc
    limit 1
  ) pay on true
  where s.id = p_sale_id;

  return v_result;
end;
$$;

-- bulk_delete_products
CREATE OR REPLACE FUNCTION public.bulk_delete_products(
  p_business_id uuid,
  p_product_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted      int := 0;
  v_discontinued int := 0;
  v_pid          uuid;
  v_has_sales    boolean;
BEGIN
  FOREACH v_pid IN ARRAY p_product_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM products WHERE id = v_pid AND business_id = p_business_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = v_pid
        AND s.business_id = p_business_id
        AND s.status = 'completed'
    ) INTO v_has_sales;

    IF v_has_sales THEN
      UPDATE products SET is_active = false WHERE id = v_pid AND business_id = p_business_id;
      v_discontinued := v_discontinued + 1;
    ELSE
      DELETE FROM price_list_overrides WHERE product_id = v_pid;
      DELETE FROM inventory_movements  WHERE product_id = v_pid;
      DELETE FROM products WHERE id = v_pid AND business_id = p_business_id;
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'discontinued', v_discontinued);
END;
$$;

-- bulk_set_product_status
CREATE OR REPLACE FUNCTION public.bulk_set_product_status(
  p_business_id uuid,
  p_product_ids uuid[],
  p_is_active   boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE products
  SET is_active = p_is_active
  WHERE id = ANY(p_product_ids) AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_count);
END;
$$;

-- bulk_update_product_brand
CREATE OR REPLACE FUNCTION public.bulk_update_product_brand(
  p_business_id uuid,
  p_product_ids uuid[],
  p_brand_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  UPDATE products
  SET brand_id = p_brand_id
  WHERE id = ANY(p_product_ids) AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_count);
END;
$$;

-- bulk_update_product_category
CREATE OR REPLACE FUNCTION public.bulk_update_product_category(
  p_business_id uuid,
  p_product_ids uuid[],
  p_category_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  UPDATE products
  SET category_id = p_category_id
  WHERE id = ANY(p_product_ids) AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_count);
END;
$$;

-- create_expense
CREATE OR REPLACE FUNCTION public.create_expense(
  p_business_id     uuid,
  p_category        text,
  p_amount          numeric,
  p_description     text,
  p_date            date    DEFAULT CURRENT_DATE,
  p_supplier_id     uuid    DEFAULT NULL,
  p_operator_id     uuid    DEFAULT NULL,
  p_attachment_url  text    DEFAULT NULL,
  p_attachment_type text    DEFAULT NULL,
  p_attachment_name text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_expense_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  INSERT INTO public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id,
    attachment_url, attachment_type, attachment_name, notes
  ) VALUES (
    p_business_id, p_category::public.expense_category, p_amount, p_description, p_date,
    p_supplier_id, p_operator_id,
    p_attachment_url, p_attachment_type::public.expense_attachment_type, p_attachment_name, p_notes
  )
  RETURNING id INTO v_expense_id;

  RETURN jsonb_build_object('success', true, 'id', v_expense_id);
END;
$$;

-- delete_expense
CREATE OR REPLACE FUNCTION public.delete_expense(
  p_business_id uuid,
  p_expense_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.expenses WHERE id = p_expense_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- get_expenses_list
CREATE OR REPLACE FUNCTION public.get_expenses_list(
  p_business_id uuid,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_category    text    DEFAULT NULL,
  p_limit       integer DEFAULT 50,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows  jsonb;
  v_total bigint;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM public.expenses e
  WHERE e.business_id = p_business_id
    AND (p_from IS NULL     OR e.date >= p_from)
    AND (p_to IS NULL       OR e.date <= p_to)
    AND (p_category IS NULL OR e.category::text = p_category);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      e.id, e.category, e.amount, e.description, e.date,
      e.attachment_url, e.attachment_type, e.attachment_name,
      e.notes, e.created_at,
      s.id   AS supplier_id,
      s.name AS supplier_name
    FROM public.expenses e
    LEFT JOIN public.suppliers s ON s.id = e.supplier_id
    WHERE e.business_id = p_business_id
      AND (p_from IS NULL     OR e.date >= p_from)
      AND (p_to IS NULL       OR e.date <= p_to)
      AND (p_category IS NULL OR e.category::text = p_category)
    ORDER BY e.date DESC, e.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object('data', COALESCE(v_rows, '[]'::jsonb), 'total', v_total);
END;
$$;

-- get_business_balance
CREATE OR REPLACE FUNCTION public.get_business_balance(
  p_business_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from        date    := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
  v_to          date    := COALESCE(p_to, CURRENT_DATE);
  v_income      numeric := 0;
  v_expenses    numeric := 0;
  v_by_category jsonb;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO v_income
  FROM public.sales
  WHERE business_id = p_business_id AND status = 'completed'
    AND created_at::date BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
  FROM public.expenses
  WHERE business_id = p_business_id AND date BETWEEN v_from AND v_to;

  SELECT COALESCE(jsonb_object_agg(category, total_amount), '{}'::jsonb) INTO v_by_category
  FROM (
    SELECT category::text, SUM(amount) AS total_amount
    FROM public.expenses
    WHERE business_id = p_business_id AND date BETWEEN v_from AND v_to
    GROUP BY category
  ) sub;

  RETURN jsonb_build_object(
    'income',       v_income,
    'expenses',     v_expenses,
    'profit',       v_income - v_expenses,
    'margin',       CASE WHEN v_income > 0 THEN ROUND(((v_income - v_expenses) / v_income) * 100, 2) ELSE 0 END,
    'by_category',  v_by_category,
    'period_from',  v_from,
    'period_to',    v_to
  );
END;
$$;

-- get_catalog_products (SECURITY DEFINER + GRANT anon)
-- Price resolution mirrors calculateProductPrice in src/lib/price-lists.ts:
--   cost > 0  → cost × effective_multiplier (product override > brand override > list)
--   cost = 0  → use explicit products.price
CREATE OR REPLACE FUNCTION public.get_catalog_products(p_slug text)
RETURNS TABLE(id uuid, category_id uuid, name text, price numeric, stock integer, image_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business_id uuid;
  v_list_id     uuid;
  v_list_mult   numeric;
BEGIN
  SELECT b.id INTO v_business_id FROM businesses b WHERE b.slug = p_slug;
  IF v_business_id IS NULL THEN RETURN; END IF;

  SELECT pl.id, pl.multiplier
  INTO v_list_id, v_list_mult
  FROM price_lists pl
  WHERE pl.business_id = v_business_id AND pl.is_default = true
  LIMIT 1;

  RETURN QUERY
  SELECT
    p.id,
    p.category_id,
    p.name,
    CASE
      WHEN p.cost > 0 AND v_list_id IS NOT NULL THEN
        (p.cost * COALESCE(
          (SELECT plo.multiplier FROM price_list_overrides plo
           WHERE plo.price_list_id = v_list_id AND plo.product_id = p.id LIMIT 1),
          CASE WHEN p.brand_id IS NOT NULL THEN
            (SELECT plo.multiplier FROM price_list_overrides plo
             WHERE plo.price_list_id = v_list_id
               AND plo.product_id IS NULL AND plo.brand_id = p.brand_id LIMIT 1)
          END,
          v_list_mult
        ))::numeric
      WHEN p.cost > 0 THEN p.cost::numeric
      ELSE p.price::numeric
    END AS price,
    p.stock::integer,
    p.image_url
  FROM products p
  WHERE p.business_id = v_business_id
    AND p.is_active = true
    AND p.show_in_catalog = true
  ORDER BY p.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_products(text) TO anon;

-- get_catalog_categories (SECURITY DEFINER + GRANT anon)
CREATE OR REPLACE FUNCTION public.get_catalog_categories(p_slug text)
RETURNS TABLE(id uuid, name text, sort_order integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT b.id INTO v_business_id FROM businesses b WHERE b.slug = p_slug;
  IF v_business_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT c.id, c.name, c.position AS sort_order
  FROM categories c
  WHERE c.business_id = v_business_id AND c.is_active = true
  ORDER BY c.position ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_categories(text) TO anon;

-- get_stats_kpis
CREATE OR REPLACE FUNCTION public.get_stats_kpis(
  p_business_id uuid,
  p_from        date DEFAULT NULL,
  p_to          date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from v_to v_prev_from v_prev_to date;
  v_days int;
  v_total_sales int; v_total_revenue numeric; v_total_units int; v_avg_ticket numeric;
  v_prev_sales int;  v_prev_revenue numeric;  v_prev_units int;
  v_peak_day text;   v_peak_revenue numeric;
  v_day_of_week jsonb;
BEGIN
  v_to   := COALESCE(p_to,   CURRENT_DATE);
  v_from := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
  v_days      := (v_to - v_from) + 1;
  v_prev_to   := v_from - interval '1 day';
  v_prev_from := v_prev_to - (v_days - 1) * interval '1 day';

  SELECT COUNT(*)::int, COALESCE(SUM(s.total),0), COALESCE(SUM(si_totals.units),0)::int,
         CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(s.total)/COUNT(*),2) ELSE 0 END
  INTO v_total_sales, v_total_revenue, v_total_units, v_avg_ticket
  FROM sales s
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(si.quantity),0) AS units FROM sale_items si WHERE si.sale_id = s.id) si_totals ON true
  WHERE s.business_id = p_business_id AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_from AND v_to;

  SELECT COUNT(*)::int, COALESCE(SUM(s.total),0), COALESCE(SUM(si_totals.units),0)::int
  INTO v_prev_sales, v_prev_revenue, v_prev_units
  FROM sales s
  LEFT JOIN LATERAL (SELECT COALESCE(SUM(si.quantity),0) AS units FROM sale_items si WHERE si.sale_id = s.id) si_totals ON true
  WHERE s.business_id = p_business_id AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_prev_from AND v_prev_to;

  SELECT to_char(s.created_at::date,'YYYY-MM-DD'), ROUND(SUM(s.total),2)
  INTO v_peak_day, v_peak_revenue
  FROM sales s
  WHERE s.business_id = p_business_id AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_from AND v_to
  GROUP BY s.created_at::date ORDER BY SUM(s.total) DESC LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'dow',     dow_num,
      'label',   CASE dow_num WHEN 0 THEN 'Dom' WHEN 1 THEN 'Lun' WHEN 2 THEN 'Mar'
                              WHEN 3 THEN 'Mié' WHEN 4 THEN 'Jue' WHEN 5 THEN 'Vie' ELSE 'Sáb' END,
      'revenue', ROUND(COALESCE(revenue,0),2),
      'count',   COALESCE(cnt,0)::int
    ) ORDER BY dow_num
  ), '[]'::jsonb)
  INTO v_day_of_week
  FROM (
    SELECT EXTRACT(DOW FROM s.created_at)::int AS dow_num, SUM(s.total) AS revenue, COUNT(*) AS cnt
    FROM sales s
    WHERE s.business_id = p_business_id AND s.status = 'completed'
      AND s.created_at::date BETWEEN v_from AND v_to
    GROUP BY EXTRACT(DOW FROM s.created_at)::int
  ) dow_data;

  RETURN jsonb_build_object(
    'total_sales', v_total_sales, 'total_revenue', v_total_revenue,
    'total_units', v_total_units, 'avg_ticket', v_avg_ticket,
    'prev_total_sales', v_prev_sales, 'prev_total_revenue', v_prev_revenue, 'prev_total_units', v_prev_units,
    'peak_day', v_peak_day, 'peak_revenue', v_peak_revenue,
    'day_of_week', v_day_of_week, 'period_from', v_from, 'period_to', v_to
  );
END;
$$;

-- get_stats_evolution (omitida por longitud — ver función completa en Supabase)
-- get_stats_breakdown, get_top_products_detail, get_sales_by_category_detail,
-- get_sales_by_operator_detail, get_sales_by_payment_detail
-- (funciones de analytics — ver definiciones completas en Supabase Dashboard > Database > Functions)


-- update_operator
CREATE OR REPLACE FUNCTION public.update_operator(
  p_operator_id uuid,
  p_name        text    DEFAULT NULL,
  p_new_pin     text    DEFAULT NULL,
  p_permissions jsonb   DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_id            uuid;
  v_business_id          uuid;
  v_operator_business_id uuid;
BEGIN
  v_caller_id := auth.uid();

  SELECT business_id INTO v_business_id
  FROM profiles WHERE id = v_caller_id;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'caller_not_found');
  END IF;

  SELECT business_id INTO v_operator_business_id
  FROM operators WHERE id = p_operator_id;

  IF v_operator_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'operator_not_found');
  END IF;

  IF v_operator_business_id <> v_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  UPDATE operators
  SET
    name        = COALESCE(p_name, name),
    pin         = CASE
                    WHEN p_new_pin IS NOT NULL
                    THEN extensions.crypt(p_new_pin, extensions.gen_salt('bf'))
                    ELSE pin
                  END,
    permissions = CASE
                    WHEN p_permissions IS NOT NULL
                    THEN permissions || p_permissions
                    ELSE permissions
                  END
  WHERE id = p_operator_id;

  RETURN json_build_object('success', true);
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;

-- get_operator_stats
CREATE OR REPLACE FUNCTION public.get_operator_stats(
  p_operator_id uuid,
  p_date_from   timestamptz DEFAULT NULL,
  p_date_to     timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id            uuid;
  v_business_id          uuid;
  v_operator_business_id uuid;
  v_total_sales          int;
  v_total_revenue        numeric;
  v_top_products         json;
  v_sale_history         json;
BEGIN
  v_caller_id := auth.uid();

  SELECT business_id INTO v_business_id
  FROM profiles WHERE id = v_caller_id;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'caller_not_found');
  END IF;

  SELECT business_id INTO v_operator_business_id
  FROM operators WHERE id = p_operator_id;

  IF v_operator_business_id <> v_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT COUNT(*)::int, COALESCE(SUM(total), 0)
  INTO v_total_sales, v_total_revenue
  FROM sales
  WHERE operator_id = p_operator_id
    AND business_id = v_business_id
    AND status = 'completed'
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to   IS NULL OR created_at <= p_date_to);

  SELECT json_agg(t) INTO v_top_products
  FROM (
    SELECT
      p.name AS product_name,
      SUM(si.quantity)::int AS total_quantity,
      SUM(si.quantity * si.unit_price) AS total_revenue
    FROM sale_items si
    JOIN sales s    ON s.id  = si.sale_id
    JOIN products p ON p.id  = si.product_id
    WHERE s.operator_id  = p_operator_id
      AND s.business_id  = v_business_id
      AND s.status       = 'completed'
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR s.created_at <= p_date_to)
    GROUP BY p.id, p.name
    ORDER BY total_quantity DESC
    LIMIT 5
  ) t;

  SELECT json_agg(t) INTO v_sale_history
  FROM (
    SELECT
      s.id,
      s.total,
      s.created_at,
      s.status,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)::int AS items_count
    FROM sales s
    WHERE s.operator_id = p_operator_id
      AND s.business_id = v_business_id
      AND s.status      = 'completed'
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR s.created_at <= p_date_to)
    ORDER BY s.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'success',       true,
    'total_sales',   v_total_sales,
    'total_revenue', v_total_revenue,
    'top_products',  COALESCE(v_top_products, '[]'::json),
    'sale_history',  COALESCE(v_sale_history, '[]'::json)
  );
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;

-- ---------------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------------

-- on_sale_item_inserted: descuenta stock y registra inventory_movement
CREATE TRIGGER on_sale_item_inserted
  AFTER INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_stock_on_sale();

-- expenses_updated_at: mantiene updated_at actualizado
CREATE TRIGGER expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ---------------------------------------------------------------------------
-- STORAGE BUCKETS (referencia — se configuran desde Supabase Dashboard)
-- ---------------------------------------------------------------------------
-- bucket: product-images  → public: true
-- bucket: expense-receipts → public: false
--
-- RLS expense-receipts (storage.objects):
--   SELECT/INSERT/UPDATE/DELETE: auth.uid() IN (
--     SELECT id FROM profiles WHERE business_id = (
--       SELECT business_id FROM profiles WHERE id = auth.uid()
--     )
--   )
-- =============================================================================
