-- ============================================================
-- Pulsar POS — Schema completo
-- Proyecto Supabase: zrnthcznbrplzpmxmkwk (sa-east-1)
-- Vercel: pulsarpos
-- Última actualización: refleja estado actual de producción
-- NOTA: Este es un snapshot — no aplicar como migración incremental
-- ============================================================

-- ============================================================
-- EXTENSIONES
-- ============================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto" schema extensions;

-- ============================================================
-- BUSINESSES (tenants)
-- ============================================================
create table businesses (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null unique,
  plan        text        not null default 'free',
  settings    jsonb       default '{}',
  whatsapp    text,
  logo_url    text,
  description text,
  created_at  timestamptz default now()
);

-- ============================================================
-- PROFILES (owner del negocio — 1 por business)
-- ============================================================
create table profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  business_id uuid        references businesses(id) on delete cascade,
  role        text        not null default 'owner',
  name        text        not null,
  pin         text,
  permissions jsonb       not null default '{
    "sales": true,
    "stock": true,
    "stock_write": true,
    "stats": true,
    "price_lists": true,
    "price_lists_write": true,
    "settings": true
  }'::jsonb,
  created_at  timestamptz default now()
);

-- ============================================================
-- OPERATORS (sub-usuarios con PIN — N por business)
-- Roles válidos: 'manager', 'cashier', 'custom'
-- ============================================================
create table operators (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references businesses(id) on delete cascade,
  name        text        not null,
  role        text        not null default 'cashier',
  pin         text        not null,
  permissions jsonb       not null default '{
    "sales": true,
    "stock": false,
    "stock_write": false,
    "stats": false,
    "price_lists": false,
    "price_lists_write": false,
    "settings": false
  }'::jsonb,
  is_active   bool        not null default true,
  created_at  timestamptz default now()
);

-- ============================================================
-- BRANDS
-- ============================================================
create table brands (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        not null references businesses(id) on delete cascade,
  name        text        not null,
  created_at  timestamptz not null default now(),
  constraint unique_brand_per_business unique (business_id, name)
);

-- ============================================================
-- CATEGORIES
-- ============================================================
create table categories (
  id          uuid        primary key default gen_random_uuid(),
  business_id uuid        references businesses(id) on delete cascade,
  name        text        not null,
  icon        text        default '📦',
  position    int         default 0,
  is_active   bool        default true,
  created_at  timestamptz default now()
);

-- ============================================================
-- PRODUCTS
-- ============================================================
create table products (
  id              uuid          primary key default gen_random_uuid(),
  business_id     uuid          references businesses(id) on delete cascade,
  category_id     uuid          references categories(id) on delete set null,
  brand_id        uuid          references brands(id) on delete set null,
  name            text          not null,
  sku             text,
  barcode         text,
  price           numeric(12,2) not null default 0,
  cost            numeric(12,2) default 0,
  stock           int           not null default 0,
  min_stock       int           default 0,
  image_url       text,
  is_active       bool          default true,
  show_in_catalog bool          default true,
  sales_count     int           default 0,
  created_at      timestamptz   default now()
);

-- Upsert por SKU (importacion masiva)
create unique index unique_sku_per_business
  on products (business_id, sku)
  where sku is not null;

-- Upsert por barcode (importacion masiva)
create unique index unique_barcode_per_business
  on products (business_id, barcode)
  where barcode is not null;

-- ============================================================
-- PRICE LISTS
-- UI muestra porcentaje (40%), DB guarda multiplier (1.40)
-- Conversión: multiplier = 1 + percentage / 100
-- ============================================================
create table price_lists (
  id          uuid          primary key default gen_random_uuid(),
  business_id uuid          not null references businesses(id) on delete cascade,
  name        text          not null,
  description text,
  multiplier  numeric(6,4)  not null default 1.0,
  is_default  bool          not null default false,
  created_at  timestamptz   not null default now()
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
  id            uuid          primary key default gen_random_uuid(),
  price_list_id uuid          not null references price_lists(id) on delete cascade,
  product_id    uuid          references products(id) on delete cascade,
  brand_id      uuid          references brands(id) on delete cascade,
  multiplier    numeric(6,4)  not null,
  created_at    timestamptz   not null default now(),
  constraint override_target check (
    (product_id is not null and brand_id is null) or
    (product_id is null and brand_id is not null)
  ),
  constraint unique_override_per_list_product  unique (price_list_id, product_id),
  constraint unique_override_per_list_brand_id unique (price_list_id, brand_id)
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
create table customers (
  id             uuid          primary key default gen_random_uuid(),
  business_id    uuid          references businesses(id) on delete cascade,
  name           text          not null,
  phone          text,
  email          text,
  dni            text,
  credit_balance numeric(12,2) default 0,
  notes          text,
  created_at     timestamptz   default now()
);

-- ============================================================
-- CASH SESSIONS
-- ============================================================
create table cash_sessions (
  id              uuid          primary key default gen_random_uuid(),
  business_id     uuid          references businesses(id) on delete cascade,
  opened_by       uuid          references profiles(id),
  closed_by       uuid          references profiles(id),
  opening_amount  numeric(12,2) default 0,
  closing_amount  numeric(12,2),
  expected_amount numeric(12,2),
  opened_at       timestamptz   default now(),
  closed_at       timestamptz,
  notes           text
);

-- ============================================================
-- SALES
-- price_list_id registra qué lista se usó en la venta
-- ============================================================
create table sales (
  id            uuid          primary key default gen_random_uuid(),
  business_id   uuid          references businesses(id) on delete cascade,
  session_id    uuid          references cash_sessions(id),
  customer_id   uuid          references customers(id) on delete set null,
  price_list_id uuid          references price_lists(id) on delete set null,
  operator_id   uuid          references operators(id) on delete set null,
  subtotal      numeric(12,2) not null default 0,
  discount      numeric(12,2) default 0,
  total         numeric(12,2) not null default 0,
  status        text          default 'completed',
  notes         text,
  created_at    timestamptz   default now()
);

-- ============================================================
-- SALE ITEMS
-- ============================================================
create table sale_items (
  id         uuid          primary key default gen_random_uuid(),
  sale_id    uuid          references sales(id) on delete cascade,
  product_id uuid          references products(id) on delete set null,
  quantity   int           not null default 1,
  unit_price numeric(12,2) not null,
  total      numeric(12,2) not null
);

-- ============================================================
-- PAYMENTS
-- ============================================================
create table payments (
  id         uuid          primary key default gen_random_uuid(),
  sale_id    uuid          references sales(id) on delete cascade,
  method     text          not null,
  amount     numeric(12,2) not null,
  reference  text,
  status     text          default 'completed',
  created_at timestamptz   default now()
);

-- ============================================================
-- INVENTORY MOVEMENTS
-- ============================================================
create table inventory_movements (
  id                  uuid        primary key default gen_random_uuid(),
  business_id         uuid        references businesses(id) on delete cascade,
  product_id          uuid        references products(id) on delete set null,
  type                text        not null,
  quantity            int         not null,
  reason              text,
  reference_id        uuid,
  created_by          uuid        references profiles(id),
  created_by_operator uuid        references operators(id) on delete set null,
  created_at          timestamptz default now()
);

-- ============================================================
-- RLS — habilitar en todas las tablas
-- ============================================================
alter table businesses           enable row level security;
alter table profiles             enable row level security;
alter table operators            enable row level security;
alter table brands               enable row level security;
alter table categories           enable row level security;
alter table products             enable row level security;
alter table price_lists          enable row level security;
alter table price_list_overrides enable row level security;
alter table customers            enable row level security;
alter table cash_sessions        enable row level security;
alter table sales                enable row level security;
alter table sale_items           enable row level security;
alter table payments             enable row level security;
alter table inventory_movements  enable row level security;

-- ============================================================
-- HELPER FUNCTION
-- ============================================================
create or replace function get_business_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select business_id from profiles where id = auth.uid()
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

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_brands_business_id                   on brands              (business_id);
create index idx_categories_business_id               on categories          (business_id);
create index idx_products_business_id                 on products            (business_id);
create index idx_products_business_active             on products            (business_id, is_active);
create index idx_products_category_id                 on products            (category_id);
create index idx_products_brand_id                    on products            (brand_id) where brand_id is not null;
create index idx_products_sku                         on products            (sku)      where sku is not null;
create index idx_products_barcode                     on products            (barcode)  where barcode is not null;
create index idx_price_lists_business_id              on price_lists         (business_id);
create index idx_price_list_overrides_price_list_id   on price_list_overrides(price_list_id);
create index idx_customers_business_id                on customers           (business_id);
create index idx_cash_sessions_business_id            on cash_sessions       (business_id);
create index idx_sales_business_id                    on sales               (business_id);
create index idx_sales_business_created               on sales               (business_id, created_at desc);
create index idx_sales_session_id                     on sales               (session_id);
create index idx_sales_customer_id                    on sales               (customer_id) where customer_id is not null;
create index idx_sale_items_sale_id                   on sale_items          (sale_id);
create index idx_sale_items_product_id                on sale_items          (product_id);
create index idx_payments_sale_id                     on payments            (sale_id);
create index idx_inventory_movements_business_id      on inventory_movements (business_id);
create index idx_inventory_movements_business_created on inventory_movements (business_id, created_at desc);
create index idx_inventory_movements_product_id       on inventory_movements (product_id);
create index idx_operators_business_id                on operators           (business_id);
create index idx_profiles_business_id                 on profiles            (business_id);

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
      "settings": true
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
      "settings": false
    }'::jsonb
    when 'cashier' then '{
      "sales": true,
      "stock": true,
      "stock_write": false,
      "stats": false,
      "price_lists": false,
      "price_lists_write": false,
      "settings": false
    }'::jsonb
    else '{
      "sales": true,
      "stock": false,
      "stock_write": false,
      "stats": false,
      "price_lists": false,
      "price_lists_write": false,
      "settings": false
    }'::jsonb
  end;

  v_final_permissions := coalesce(p_permissions, v_default_permissions);

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
-- Returns items, payment method, operator name and status for a sale
-- ============================================================
create or replace function get_sale_detail(
  p_sale_id      uuid,
  p_business_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status          text;
  v_operator_name   text;
  v_payment_method  text;
  v_items           jsonb;
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
      'product_icon', p.icon,
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
-- Replaces items, updates payment method and optionally status
-- ============================================================
create or replace function update_sale(
  p_sale_id        uuid,
  p_business_id    uuid,
  p_items          jsonb,
  p_payment_method text,
  p_status         text default null
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

  delete from sale_items where sale_id = p_sale_id;

  insert into sale_items (sale_id, product_id, quantity, unit_price, total)
  select
    p_sale_id,
    (item->>'product_id')::uuid,
    (item->>'quantity')::int,
    (item->>'unit_price')::numeric(12,2),
    (item->>'quantity')::int * (item->>'unit_price')::numeric(12,2)
  from jsonb_array_elements(p_items) as item;

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
-- Hard-deletes a sale; cascade removes sale_items and payments
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
