-- ============================================================
-- EXTENSIONES
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- BUSINESSES (tenants)
-- ============================================================
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  plan text not null default 'free',
  settings jsonb default '{}',
  created_at timestamptz default now()
);

-- ============================================================
-- PROFILES (usuarios del negocio)
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  role text not null default 'cashier',
  name text not null,
  pin text,
  created_at timestamptz default now()
);

-- ============================================================
-- CATEGORIES
-- ============================================================
create table categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  icon text default '📦',
  position int default 0,
  is_active bool default true,
  created_at timestamptz default now()
);

-- ============================================================
-- PRODUCTS
-- ============================================================
create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  sku text,
  barcode text,
  price numeric(12,2) not null default 0,
  cost numeric(12,2) default 0,
  stock int not null default 0,
  min_stock int default 0,
  image_url text,
  is_active bool default true,
  show_in_catalog bool default true,
  sales_count int default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- CUSTOMERS
-- ============================================================
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  dni text,
  credit_balance numeric(12,2) default 0,
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- CASH SESSIONS (turnos de caja)
-- ============================================================
create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  opened_by uuid references profiles(id),
  closed_by uuid references profiles(id),
  opening_amount numeric(12,2) default 0,
  closing_amount numeric(12,2),
  expected_amount numeric(12,2),
  opened_at timestamptz default now(),
  closed_at timestamptz,
  notes text
);

-- ============================================================
-- SALES
-- ============================================================
create table sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  session_id uuid references cash_sessions(id),
  customer_id uuid references customers(id) on delete set null,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) default 0,
  total numeric(12,2) not null default 0,
  status text default 'completed',
  notes text,
  created_at timestamptz default now()
);

-- ============================================================
-- SALE ITEMS
-- ============================================================
create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity int not null default 1,
  unit_price numeric(12,2) not null,
  total numeric(12,2) not null
);

-- ============================================================
-- PAYMENTS
-- ============================================================
create table payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  method text not null,
  amount numeric(12,2) not null,
  reference text,
  status text default 'completed',
  created_at timestamptz default now()
);

-- ============================================================
-- INVENTORY MOVEMENTS
-- ============================================================
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  type text not null,
  quantity int not null,
  reason text,
  reference_id uuid,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- ============================================================
-- TRIGGER: actualizar stock y sales_count al completar venta
-- ============================================================
create or replace function update_stock_on_sale()
returns trigger as $$
begin
  update products
  set
    stock = stock - new.quantity,
    sales_count = sales_count + new.quantity
  where id = new.product_id;

  insert into inventory_movements (business_id, product_id, type, quantity, reason, reference_id)
  select s.business_id, new.product_id, 'sale', -new.quantity, 'Venta', new.sale_id
  from sales s where s.id = new.sale_id;

  return new;
end;
$$ language plpgsql;

create trigger on_sale_item_inserted
  after insert on sale_items
  for each row execute function update_stock_on_sale();

-- ============================================================
-- RLS: activar en todas las tablas
-- ============================================================
alter table businesses enable row level security;
alter table profiles enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table cash_sessions enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table payments enable row level security;
alter table inventory_movements enable row level security;

-- ============================================================
-- RLS POLICIES
-- ============================================================
-- Profiles: cada usuario ve solo su perfil
create policy "own_profile" on profiles
  for all using (id = auth.uid());

-- Helper function para obtener business_id del usuario actual
create or replace function get_business_id()
returns uuid as $$
  select business_id from profiles where id = auth.uid()
$$ language sql security definer stable;

-- Política genérica para todas las tablas con business_id
create policy "tenant_isolation" on businesses
  for all using (id = get_business_id());

create policy "tenant_isolation" on categories
  for all using (business_id = get_business_id());

create policy "tenant_isolation" on products
  for all using (business_id = get_business_id());

create policy "tenant_isolation" on customers
  for all using (business_id = get_business_id());

create policy "tenant_isolation" on cash_sessions
  for all using (business_id = get_business_id());

create policy "tenant_isolation" on sales
  for all using (business_id = get_business_id());

create policy "tenant_isolation" on inventory_movements
  for all using (business_id = get_business_id());

-- Sale items y payments: acceso via join con sales
create policy "tenant_isolation" on sale_items
  for all using (
    sale_id in (select id from sales where business_id = get_business_id())
  );

create policy "tenant_isolation" on payments
  for all using (
    sale_id in (select id from sales where business_id = get_business_id())
  );