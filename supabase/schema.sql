-- ============================================================
-- Pulsar POS — Schema completo
-- Proyecto Supabase: zrnthycznbrplzpmxmkwk (sa-east-1)
-- Vercel: pulsarpos
-- Última actualización: P7a completo
-- NOTA: Este es un snapshot — no aplicar como migración incremental
-- ============================================================


-- ============================================================
-- EXTENSIONES
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto" schema extensions;


-- ============================================================
-- ENUMS
-- ============================================================

create type expense_category as enum (
  'mercaderia',
  'alquiler',
  'servicios',
  'seguros',
  'proveedores',
  'sueldos',
  'otro'
);

create type expense_attachment_type as enum (
  'image',
  'pdf',
  'spreadsheet',
  'other'
);


-- ============================================================
-- BUSINESSES (tenants)
-- ============================================================

create table businesses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text not null unique,
  plan                text not null default 'free',
  settings            jsonb default '{}',
  whatsapp            text,
  logo_url            text,
  description         text,
  accounting_enabled  bool not null default false,
  created_at          timestamptz default now()
);


-- ============================================================
-- PROFILES (owner del negocio — 1 por business)
-- ============================================================

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  role        text not null default 'owner',
  name        text not null,
  pin         text,
  avatar_url  text,
  permissions jsonb not null default '{
    "sales": true,
    "stock": true,
    "stock_write": true,
    "stats": true,
    "price_lists": true,
    "price_lists_write": true,
    "settings": true,
    "expenses": true
  }'::jsonb,
  created_at  timestamptz default now()
);


-- ============================================================
-- OPERATORS (sub-usuarios con PIN — N por business)
-- Roles válidos: 'manager', 'cashier', 'custom'
-- ============================================================

create table operators (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  role        text not null default 'cashier',
  pin         text not null,
  permissions jsonb not null default '{
    "sales": true,
    "stock": false,
    "stock_write": false,
    "stats": false,
    "price_lists": false,
    "price_lists_write": false,
    "settings": false,
    "expenses": false
  }'::jsonb,
  is_active   bool not null default true,
  created_at  timestamptz default now()
);


-- ============================================================
-- BRANDS
-- ============================================================

create table brands (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  constraint unique_brand_per_business unique (business_id, name)
);


-- ============================================================
-- CATEGORIES
-- ============================================================

create table categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name        text not null,
  icon        text default '📦',
  position    int default 0,
  is_active   bool default true,
  created_at  timestamptz default now()
);


-- ============================================================
-- PRODUCTS
-- image_url + image_source: ambos null o ambos not null (constraint de consistencia)
-- image_source: 'upload' = archivo en bucket product-images, 'url' = URL externa HTTPS
-- ============================================================

create table products (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references businesses(id) on delete cascade,
  category_id     uuid references categories(id) on delete set null,
  brand_id        uuid references brands(id) on delete set null,
  name            text not null,
  sku             text,
  barcode         text,
  price           numeric(12,2) not null default 0,
  cost            numeric(12,2) default 0,
  stock           int not null default 0,
  min_stock       int default 0,
  image_url       text,
  image_source    text check (image_source in ('upload', 'url')),
  is_active       bool default true,
  show_in_catalog bool default true,
  sales_count     int default 0,
  created_at      timestamptz default now(),
  constraint image_consistency check (
    (image_url is null and image_source is null) or
    (image_url is not null and image_source is not null)
  )
);

-- Upsert por SKU (importación masiva)
alter table products
  add constraint unique_sku_per_business unique (business_id, sku);

-- Upsert por barcode (importación masiva)
alter table products
  add constraint unique_barcode_per_business unique (business_id, barcode);


-- ============================================================
-- PRICE LISTS
-- UI muestra porcentaje (40%), DB guarda multiplier (1.40)
-- Conversión: multiplier = 1 + percentage / 100
-- ============================================================

create table price_lists (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  description text,
  multiplier  numeric(6,4) not null default 1.0,
  is_default  bool not null default false,
  created_at  timestamptz not null default now()
);

-- Solo una lista default por negocio
create unique index unique_default_price_list_per_business
  on price_lists (business_id)
  where is_default = true;


-- ============================================================
-- PRICE LIST OVERRIDES
-- Runtime: precio_final = cost × (product_override ?? brand_override ?? list.multiplier)
-- ============================================================

create table price_list_overrides (
  id            uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references price_lists(id) on delete cascade,
  product_id    uuid references products(id) on delete cascade,
  brand_id      uuid references brands(id) on delete cascade,
  multiplier    numeric(6,4) not null,
  created_at    timestamptz not null default now(),
  constraint override_target check (
    (product_id is not null and brand_id is null) or
    (product_id is null and brand_id is not null)
  ),
  constraint unique_override_per_list_product unique (price_list_id, product_id),
  constraint unique_override_per_list_brand_id unique (price_list_id, brand_id)
);


-- ============================================================
-- CUSTOMERS
-- ============================================================

create table customers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references businesses(id) on delete cascade,
  name           text not null,
  phone          text,
  email          text,
  dni            text,
  tax_type       text,
  credit_balance numeric(12,2) default 0,
  notes          text,
  created_at     timestamptz default now()
);


-- ============================================================
-- CASH SESSIONS
-- ============================================================

create table cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid references businesses(id) on delete cascade,
  opened_by       uuid references profiles(id),
  closed_by       uuid references profiles(id),
  opening_amount  numeric(12,2) default 0,
  closing_amount  numeric(12,2),
  expected_amount numeric(12,2),
  opened_at       timestamptz default now(),
  closed_at       timestamptz,
  notes           text
);


-- ============================================================
-- SALES
-- price_list_id registra qué lista se usó en la venta
-- ============================================================

create table sales (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references businesses(id) on delete cascade,
  session_id    uuid references cash_sessions(id),
  customer_id   uuid references customers(id) on delete set null,
  price_list_id uuid references price_lists(id) on delete set null,
  operator_id   uuid references operators(id) on delete set null,
  subtotal      numeric(12,2) not null default 0,
  discount      numeric(12,2) default 0,
  total         numeric(12,2) not null default 0,
  status        text default 'completed',
  notes         text,
  created_at    timestamptz default now()
);


-- ============================================================
-- SALE ITEMS
-- ============================================================

create table sale_items (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid references sales(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity   int not null default 1,
  unit_price numeric(12,2) not null,
  total      numeric(12,2) not null
);


-- ============================================================
-- PAYMENTS
-- method: siempre en inglés (cash/card/transfer/mercadopago/otro)
-- Labels en UI via PAYMENT_LABELS en lib/payments.ts
-- ============================================================

create table payments (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid references sales(id) on delete cascade,
  method     text not null,
  amount     numeric(12,2) not null,
  reference  text,
  status     text default 'completed',
  created_at timestamptz default now()
);


-- ============================================================
-- INVENTORY MOVEMENTS
-- ============================================================

create table inventory_movements (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid references businesses(id) on delete cascade,
  product_id          uuid references products(id) on delete set null,
  type                text not null,
  quantity            int not null,
  reason              text,
  reference_id        uuid,
  created_by          uuid references profiles(id),
  created_by_operator uuid references operators(id) on delete set null,
  created_at          timestamptz default now()
);


-- ============================================================
-- SUPPLIERS
-- ============================================================

create table suppliers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  notes        text,
  is_active    bool not null default true,
  created_at   timestamptz default now()
);


-- ============================================================
-- EXPENSES
-- ============================================================

create table expenses (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  operator_id     uuid references operators(id) on delete set null,
  supplier_id     uuid references suppliers(id) on delete set null,
  category        expense_category not null,
  amount          numeric(12,2) not null check (amount > 0),
  description     text not null,
  date            date not null default current_date,
  attachment_url  text,
  attachment_type expense_attachment_type,
  attachment_name text,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Trigger updated_at para expenses
create or replace function set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger expenses_updated_at
  before update on expenses
  for each row execute function set_updated_at();


-- ============================================================
-- INVOICES
-- Capa fiscal abstracta — activa con P10 (accounting_enabled)
-- provider: 'facturama' | 'alegra' | null
-- ============================================================

create table invoices (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sale_id     uuid references sales(id) on delete set null,
  provider    text,
  external_id text,
  status      text,
  pdf_url     text,
  created_at  timestamptz default now()
);


-- ============================================================
-- RLS — habilitar en todas las tablas
-- ============================================================

alter table businesses         enable row level security;
alter table profiles           enable row level security;
alter table operators          enable row level security;
alter table brands             enable row level security;
alter table categories         enable row level security;
alter table products           enable row level security;
alter table price_lists        enable row level security;
alter table price_list_overrides enable row level security;
alter table customers          enable row level security;
alter table cash_sessions      enable row level security;
alter table sales              enable row level security;
alter table sale_items         enable row level security;
alter table payments           enable row level security;
alter table inventory_movements enable row level security;
alter table suppliers          enable row level security;
alter table expenses           enable row level security;
alter table invoices           enable row level security;


-- ============================================================
-- HELPER FUNCTION
-- STABLE: permite al planner cachear el resultado por query
-- (select auth.uid()): evita re-eval por fila en policies
-- ============================================================

create or replace function get_business_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select business_id from profiles where id = (select auth.uid())
$$;


-- ============================================================
-- RLS POLICIES
-- CRÍTICO: public_read_* solo para auth.role() = 'anon'
-- Usuarios autenticados ven solo sus propios datos via tenant_isolation
-- ============================================================

-- businesses
create policy "public_read_businesses" on businesses
  for select using (auth.role() = 'anon');

create policy "tenant_isolation" on businesses
  for all using (id = get_business_id());

-- profiles
create policy "own_profile" on profiles
  for all using (id = auth.uid());

create policy "insert_own_profile" on profiles
  for insert with check (id = auth.uid());

create policy "tenant_select_profiles" on profiles
  for select using (business_id = get_business_id());

-- operators
create policy "tenant_isolation" on operators
  for all using (business_id = get_business_id());

-- brands
create policy "tenant_isolation" on brands
  for all using (business_id = get_business_id());

-- categories
create policy "public_read_categories" on categories
  for select using (auth.role() = 'anon' and is_active = true);

create policy "tenant_isolation" on categories
  for all using (business_id = get_business_id());

-- products
create policy "public_read_products" on products
  for select using (auth.role() = 'anon' and is_active = true and show_in_catalog = true);

create policy "tenant_isolation" on products
  for all using (business_id = get_business_id());

-- price_lists
create policy "tenant_isolation" on price_lists
  for all using (business_id = get_business_id());

-- price_list_overrides
create policy "tenant_isolation" on price_list_overrides
  for all using (
    price_list_id in (select id from price_lists where business_id = get_business_id())
  );

-- customers
create policy "tenant_isolation" on customers
  for all using (business_id = get_business_id());

-- cash_sessions
create policy "tenant_isolation" on cash_sessions
  for all using (business_id = get_business_id());

-- sales
create policy "tenant_isolation" on sales
  for all using (business_id = get_business_id());

-- sale_items
create policy "tenant_isolation" on sale_items
  for all using (
    sale_id in (select id from sales where business_id = get_business_id())
  );

-- payments
create policy "tenant_isolation" on payments
  for all using (
    sale_id in (select id from sales where business_id = get_business_id())
  );

-- inventory_movements
create policy "tenant_isolation" on inventory_movements
  for all using (business_id = get_business_id());

-- suppliers
create policy "tenant_isolation" on suppliers
  for all using (business_id = get_business_id());

-- expenses
create policy "tenant_isolation" on expenses
  for all using (business_id = get_business_id());

-- invoices
create policy "tenant_isolation" on invoices
  for all using (business_id = get_business_id());


-- ============================================================
-- INDEXES
-- ============================================================

-- businesses
create index idx_businesses_slug on businesses (slug);

-- profiles
create index idx_profiles_business_id on profiles (business_id);

-- operators
create index idx_operators_business_id on operators (business_id);

-- brands
create index idx_brands_business_id on brands (business_id);

-- categories
create index idx_categories_business_id on categories (business_id);

-- products
create index idx_products_business_id on products (business_id);
create index idx_products_business_active on products (business_id, is_active);
create index idx_products_category_id on products (category_id);
create index idx_products_brand_id on products (brand_id) where brand_id is not null;
create index idx_products_sku on products (sku) where sku is not null;
create index idx_products_barcode on products (barcode) where barcode is not null;

-- price_lists
create index idx_price_lists_business_id on price_lists (business_id);

-- price_list_overrides
create index idx_price_list_overrides_price_list_id on price_list_overrides (price_list_id);
create index idx_price_list_overrides_product_id on price_list_overrides (product_id) where product_id is not null;
create index idx_price_list_overrides_brand_id on price_list_overrides (brand_id) where brand_id is not null;

-- customers
create index idx_customers_business_id on customers (business_id);

-- cash_sessions
create index idx_cash_sessions_business_id on cash_sessions (business_id);

-- sales
create index idx_sales_business_id on sales (business_id);
create index idx_sales_business_created on sales (business_id, created_at desc);
create index idx_sales_session_id on sales (session_id);
create index idx_sales_customer_id on sales (customer_id) where customer_id is not null;
create index idx_sales_operator_id on sales (operator_id) where operator_id is not null;
create index idx_sales_price_list_id on sales (price_list_id) where price_list_id is not null;

-- sale_items
create index idx_sale_items_sale_id on sale_items (sale_id);
create index idx_sale_items_product_id on sale_items (product_id);

-- payments
create index idx_payments_sale_id on payments (sale_id);

-- inventory_movements
create index idx_inventory_movements_business_id on inventory_movements (business_id);
create index idx_inventory_movements_business_created on inventory_movements (business_id, created_at desc);
create index idx_inventory_movements_product_id on inventory_movements (product_id);
create index idx_inventory_movements_operator_id on inventory_movements (created_by_operator) where created_by_operator is not null;

-- suppliers
create index idx_suppliers_business_id on suppliers (business_id);

-- expenses
create index idx_expenses_business_id on expenses (business_id);
create index idx_expenses_business_date on expenses (business_id, date desc);
create index idx_expenses_supplier_id on expenses (supplier_id) where supplier_id is not null;
create index idx_expenses_operator_id on expenses (operator_id) where operator_id is not null;

-- invoices
create index idx_invoices_business_id on invoices (business_id);
create index idx_invoices_sale_id on invoices (sale_id) where sale_id is not null;


-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Registra un nuevo negocio y su owner al hacer signup
create or replace function bootstrap_new_user(
  p_user_id       uuid,
  p_business_name text,
  p_user_name     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_slug        text;
begin
  v_slug := lower(regexp_replace(btrim(p_business_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'negocio'; end if;
  v_slug := v_slug || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  insert into businesses (name, slug)
  values (btrim(p_business_name), v_slug)
  returning id into v_business_id;

  insert into profiles (id, business_id, role, name, permissions)
  values (
    p_user_id,
    v_business_id,
    'owner',
    btrim(p_user_name),
    '{
      "sales": true,
      "stock": true,
      "stock_write": true,
      "stats": true,
      "price_lists": true,
      "price_lists_write": true,
      "settings": true,
      "expenses": true
    }'::jsonb
  );

  return jsonb_build_object('success', true, 'business_id', v_business_id);
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;


-- Crea un operador con PIN hasheado y permisos según rol
-- p_permissions solo se usa si p_role = 'custom'
-- IMPORTANTE: siempre incluye expenses en defaults con fallback defensivo
create or replace function create_operator(
  p_business_id uuid,
  p_name        text,
  p_role        text,
  p_pin         text,
  p_permissions jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_default_permissions jsonb;
  v_final_permissions   jsonb;
  v_operator_id         uuid;
begin
  v_default_permissions := case p_role
    when 'manager' then '{
      "sales": true,
      "stock": true,
      "stock_write": true,
      "stats": true,
      "price_lists": true,
      "price_lists_write": true,
      "settings": false,
      "expenses": true
    }'::jsonb
    when 'cashier' then '{
      "sales": true,
      "stock": true,
      "stock_write": false,
      "stats": false,
      "price_lists": false,
      "price_lists_write": false,
      "settings": false,
      "expenses": false
    }'::jsonb
    else '{
      "sales": true,
      "stock": false,
      "stock_write": false,
      "stats": false,
      "price_lists": false,
      "price_lists_write": false,
      "settings": false,
      "expenses": false
    }'::jsonb
  end;

  v_final_permissions := coalesce(p_permissions, v_default_permissions);

  -- Fallback defensivo: garantizar que expenses siempre esté presente
  if v_final_permissions->>'expenses' is null then
    v_final_permissions := v_final_permissions || '{"expenses": false}'::jsonb;
  end if;

  insert into operators (business_id, name, role, pin, permissions)
  values (
    p_business_id,
    p_name,
    p_role,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    v_final_permissions
  )
  returning id into v_operator_id;

  return json_build_object('success', true, 'operator_id', v_operator_id);
exception
  when others then
    return json_build_object('success', false, 'error', sqlerrm);
end;
$$;


-- Verifica el PIN de un operador y retorna sus datos de sesión
create or replace function verify_operator_pin(
  p_business_id uuid,
  p_operator_id uuid,
  p_pin         text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
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
    'success',     true,
    'profile_id',  v_operator.id,
    'name',        v_operator.name,
    'role',        v_operator.role,
    'permissions', v_operator.permissions
  );
exception
  when others then
    return json_build_object('success', false, 'error', sqlerrm);
end;
$$;


-- Swap atómico de lista de precios default
create or replace function swap_default_price_list(
  p_price_list_id uuid,
  p_business_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update price_lists set is_default = false
  where business_id = p_business_id and is_default = true;

  update price_lists set is_default = true
  where id = p_price_list_id and business_id = p_business_id;
end;
$$;


-- Trigger: descuenta stock y registra movimiento al insertar un sale_item
create or replace function update_stock_on_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

create trigger on_sale_item_inserted
  after insert on sale_items
  for each row execute function update_stock_on_sale();


-- ============================================================
-- GUARDED FUNCTIONS
-- Verifican stock_write antes de insertar
-- Owners (en profiles) siempre tienen acceso completo
-- ============================================================

create or replace function create_category_guarded(
  p_operator_id uuid,
  p_business_id uuid,
  p_name        text,
  p_icon        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business_id uuid;
  v_stock_write        text;
  v_new_id             uuid;
begin
  if p_operator_id is null then
    return jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  end if;

  v_caller_business_id := get_business_id();
  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    return jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  end if;

  select permissions->>'stock_write' into v_stock_write
  from operators
  where id = p_operator_id and business_id = v_caller_business_id and is_active = true;

  if found then
    if v_stock_write <> 'true' then
      return jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    end if;
  else
    if not exists (
      select 1 from profiles
      where id = p_operator_id and business_id = v_caller_business_id
    ) then
      return jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    end if;
  end if;

  insert into categories (business_id, name, icon, is_active)
  values (v_caller_business_id, btrim(p_name), btrim(p_icon), true)
  returning id into v_new_id;

  return jsonb_build_object('success', true, 'id', v_new_id);
end;
$$;


create or replace function create_brand_guarded(
  p_operator_id uuid,
  p_business_id uuid,
  p_name        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business_id uuid;
  v_stock_write        text;
  v_new_id             uuid;
begin
  if p_operator_id is null then
    return jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  end if;

  v_caller_business_id := get_business_id();
  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    return jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  end if;

  select permissions->>'stock_write' into v_stock_write
  from operators
  where id = p_operator_id and business_id = v_caller_business_id and is_active = true;

  if found then
    if v_stock_write <> 'true' then
      return jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    end if;
  else
    if not exists (
      select 1 from profiles
      where id = p_operator_id and business_id = v_caller_business_id
    ) then
      return jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    end if;
  end if;

  insert into brands (business_id, name)
  values (v_caller_business_id, btrim(p_name))
  returning id into v_new_id;

  return jsonb_build_object('success', true, 'id', v_new_id);
end;
$$;


-- ============================================================
-- get_sale_detail
-- ============================================================

create or replace function get_sale_detail(
  p_sale_id     uuid,
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status         text;
  v_operator_name  text;
  v_payment_method text;
  v_items          jsonb;
begin
  select s.status, o.name
  into v_status, v_operator_name
  from sales s
  left join operators o on o.id = s.operator_id
  where s.id = p_sale_id and s.business_id = p_business_id;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  select method into v_payment_method
  from payments
  where sale_id = p_sale_id
  order by created_at asc
  limit 1;

  select jsonb_agg(
    jsonb_build_object(
      'id',           si.id,
      'product_id',   coalesce(si.product_id::text, ''),
      'product_name', coalesce(p.name, 'Producto eliminado'),
      'quantity',     si.quantity,
      'unit_price',   si.unit_price
    ) order by si.id
  )
  into v_items
  from sale_items si
  left join products p on p.id = si.product_id
  where si.sale_id = p_sale_id;

  return jsonb_build_object(
    'success',        true,
    'status',         v_status,
    'payment_method', coalesce(v_payment_method, ''),
    'operator_name',  v_operator_name,
    'items',          coalesce(v_items, '[]'::jsonb)
  );
end;
$$;


-- ============================================================
-- update_sale
-- ============================================================

create or replace function update_sale(
  p_sale_id       uuid,
  p_business_id   uuid,
  p_items         jsonb,
  p_payment_method text,
  p_status        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12,2);
begin
  if not exists (
    select 1 from sales where id = p_sale_id and business_id = p_business_id
  ) then
    return jsonb_build_object('success', false);
  end if;

  -- Restaurar stock de los items anteriores
  update products p
  set
    stock       = p.stock + si.quantity,
    sales_count = greatest(0, p.sales_count - si.quantity)
  from sale_items si
  where si.sale_id = p_sale_id and p.id = si.product_id;

  delete from sale_items where sale_id = p_sale_id;

  -- Deshabilitar trigger para evitar double-decrement
  alter table sale_items disable trigger on_sale_item_inserted;

  insert into sale_items (sale_id, product_id, quantity, unit_price, total)
  select
    p_sale_id,
    (item->>'product_id')::uuid,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric(12,2),
    (item->>'quantity')::int * (item->>'unit_price')::numeric(12,2)
  from jsonb_array_elements(p_items) as item;

  alter table sale_items enable trigger on_sale_item_inserted;

  -- Aplicar stock de los nuevos items
  update products p
  set
    stock       = p.stock - si.quantity,
    sales_count = p.sales_count + si.quantity
  from sale_items si
  where si.sale_id = p_sale_id and p.id = si.product_id;

  select coalesce(sum(total), 0) into v_total
  from sale_items
  where sale_id = p_sale_id;

  update sales
  set
    total    = v_total,
    subtotal = v_total,
    status   = coalesce(p_status, status)
  where id = p_sale_id and business_id = p_business_id;

  update payments
  set method = p_payment_method
  where sale_id = p_sale_id;

  return jsonb_build_object('success', true, 'total', v_total);
end;
$$;


-- ============================================================
-- delete_sale
-- ============================================================

create or replace function delete_sale(
  p_sale_id     uuid,
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from sales
  where id = p_sale_id and business_id = p_business_id;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  return jsonb_build_object('success', true);
end;
$$;


-- ============================================================
-- get_business_balance
-- Retorna balance general del negocio con breakdown por categoría
-- ============================================================

create or replace function get_business_balance(
  p_business_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_income     numeric(12,2);
  v_expenses   numeric(12,2);
  v_by_cat     jsonb;
begin
  select coalesce(sum(total), 0) into v_income
  from sales
  where business_id = p_business_id
    and status = 'completed'
    and (p_from is null or created_at::date >= p_from)
    and (p_to   is null or created_at::date <= p_to);

  select coalesce(sum(amount), 0) into v_expenses
  from expenses
  where business_id = p_business_id
    and (p_from is null or date >= p_from)
    and (p_to   is null or date <= p_to);

  select jsonb_agg(
    jsonb_build_object('category', category, 'total', total)
    order by total desc
  ) into v_by_cat
  from (
    select category::text, sum(amount) as total
    from expenses
    where business_id = p_business_id
      and (p_from is null or date >= p_from)
      and (p_to   is null or date <= p_to)
    group by category
  ) sub;

  return jsonb_build_object(
    'income',      v_income,
    'expenses',    v_expenses,
    'profit',      v_income - v_expenses,
    'margin',      case when v_income > 0 then round(((v_income - v_expenses) / v_income) * 100, 2) else 0 end,
    'by_category', coalesce(v_by_cat, '[]'::jsonb),
    'period_from', p_from,
    'period_to',   p_to
  );
end;
$$;


-- ============================================================
-- get_expenses_list
-- ============================================================

create or replace function get_expenses_list(
  p_business_id uuid,
  p_from        date    default null,
  p_to          date    default null,
  p_category    text    default null,
  p_limit       int     default 50,
  p_offset      int     default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data  jsonb;
  v_total int;
begin
  select count(*) into v_total
  from expenses
  where business_id = p_business_id
    and (p_from     is null or date >= p_from)
    and (p_to       is null or date <= p_to)
    and (p_category is null or category::text = p_category);

  select jsonb_agg(row_to_json(e.*) order by e.date desc, e.created_at desc)
  into v_data
  from (
    select * from expenses
    where business_id = p_business_id
      and (p_from     is null or date >= p_from)
      and (p_to       is null or date <= p_to)
      and (p_category is null or category::text = p_category)
    order by date desc, created_at desc
    limit p_limit offset p_offset
  ) e;

  return jsonb_build_object(
    'data',  coalesce(v_data, '[]'::jsonb),
    'total', v_total
  );
end;
$$;


-- ============================================================
-- create_expense
-- ============================================================

create or replace function create_expense(
  p_business_id   uuid,
  p_category      text,
  p_amount        numeric,
  p_description   text,
  p_date          date    default current_date,
  p_operator_id   uuid    default null,
  p_supplier_id   uuid    default null,
  p_attachment_url  text  default null,
  p_attachment_type text  default null,
  p_attachment_name text  default null,
  p_notes         text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
begin
  insert into expenses (
    business_id, operator_id, supplier_id, category, amount,
    description, date, attachment_url, attachment_type, attachment_name, notes
  )
  values (
    p_business_id, p_operator_id, p_supplier_id,
    p_category::expense_category, p_amount,
    p_description, p_date,
    p_attachment_url,
    case when p_attachment_type is not null then p_attachment_type::expense_attachment_type else null end,
    p_attachment_name, p_notes
  )
  returning id into v_new_id;

  return jsonb_build_object('success', true, 'id', v_new_id);
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;


-- ============================================================
-- delete_expense
-- ============================================================

create or replace function delete_expense(
  p_business_id uuid,
  p_expense_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from expenses
  where id = p_expense_id and business_id = p_business_id;

  if not found then
    return jsonb_build_object('success', false);
  end if;

  return jsonb_build_object('success', true);
end;
$$;


-- ============================================================
-- get_top_products_detail
-- Retorna { data: [...], total }
-- ============================================================

create or replace function get_top_products_detail(
  p_business_id uuid,
  p_from        date  default null,
  p_to          date  default null,
  p_limit       int   default 20,
  p_offset      int   default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data  jsonb;
  v_total int;
begin
  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and (p_from is null or s.created_at::date >= p_from)
    and (p_to   is null or s.created_at::date <= p_to);

  select jsonb_agg(row)
  into v_data
  from (
    select
      p.id,
      p.name,
      p.sku,
      sum(si.quantity)               as units_sold,
      sum(si.total)                  as total_revenue,
      sum(si.quantity * p.cost)      as total_cost,
      sum(si.total) - sum(si.quantity * p.cost) as gross_profit
    from sale_items si
    join sales s     on s.id = si.sale_id
    join products p  on p.id = si.product_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
    group by p.id, p.name, p.sku
    order by units_sold desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',  coalesce(v_data, '[]'::jsonb),
    'total', v_total
  );
end;
$$;


-- ============================================================
-- get_sales_by_category_detail
-- Retorna { data: [...], total }
-- ============================================================

create or replace function get_sales_by_category_detail(
  p_business_id uuid,
  p_from        date default null,
  p_to          date default null,
  p_limit       int  default 20,
  p_offset      int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data  jsonb;
  v_total int;
begin
  select count(distinct coalesce(p.category_id::text, 'sin-categoria')) into v_total
  from sale_items si
  join sales s    on s.id = si.sale_id
  join products p on p.id = si.product_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and (p_from is null or s.created_at::date >= p_from)
    and (p_to   is null or s.created_at::date <= p_to);

  select jsonb_agg(row)
  into v_data
  from (
    select
      coalesce(c.name, 'Sin categoría') as category_name,
      c.icon,
      sum(si.quantity)  as units_sold,
      sum(si.total)     as total_revenue
    from sale_items si
    join sales s         on s.id = si.sale_id
    join products p      on p.id = si.product_id
    left join categories c on c.id = p.category_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
    group by c.name, c.icon
    order by total_revenue desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',  coalesce(v_data, '[]'::jsonb),
    'total', v_total
  );
end;
$$;


-- ============================================================
-- get_sales_by_payment_detail
-- Retorna { data: [...] }
-- ============================================================

create or replace function get_sales_by_payment_detail(
  p_business_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  select jsonb_agg(row order by total_amount desc)
  into v_data
  from (
    select
      py.method,
      count(distinct py.sale_id) as transaction_count,
      sum(py.amount)             as total_amount
    from payments py
    join sales s on s.id = py.sale_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
    group by py.method
  ) row;

  return jsonb_build_object('data', coalesce(v_data, '[]'::jsonb));
end;
$$;


-- ============================================================
-- get_sales_by_operator_detail
-- Retorna { data: [...] }
-- ============================================================

create or replace function get_sales_by_operator_detail(
  p_business_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
begin
  select jsonb_agg(row order by total_sales desc)
  into v_data
  from (
    select
      coalesce(o.name, 'Administrador') as operator_name,
      coalesce(o.role, 'owner')         as operator_role,
      count(s.id)                       as total_sales,
      sum(s.total)                      as total_amount
    from sales s
    left join operators o on o.id = s.operator_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
    group by o.name, o.role
  ) row;

  return jsonb_build_object('data', coalesce(v_data, '[]'::jsonb));
end;
$$;
