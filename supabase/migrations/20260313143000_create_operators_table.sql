create extension if not exists pgcrypto;

create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade not null,
  name text not null,
  role text not null default 'cashier',
  pin text not null,
  permissions jsonb not null default '{"sales": true, "stock": false, "stats": false, "settings": false}'::jsonb,
  is_active bool not null default true,
  created_at timestamptz not null default now(),
  constraint operators_role_check check (role in ('manager', 'cashier'))
);

alter table public.operators enable row level security;

drop policy if exists operators_tenant_isolation on public.operators;
create policy operators_tenant_isolation
on public.operators
for all
using (business_id = public.get_business_id())
with check (business_id = public.get_business_id());

alter table public.inventory_movements drop constraint if exists inventory_movements_created_by_fkey;
alter table public.inventory_movements
  add constraint inventory_movements_created_by_fkey
  foreign key (created_by) references public.operators(id) on delete set null;

create or replace function public.create_operator(
  p_business_id uuid,
  p_name text,
  p_role text,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid;
  v_permissions jsonb;
  v_caller_business_id uuid;
begin
  v_caller_business_id := public.get_business_id();

  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    raise exception 'Invalid business context';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Operator name is required';
  end if;

  if p_role not in ('manager', 'cashier') then
    raise exception 'Invalid operator role';
  end if;

  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'PIN must contain exactly 4 digits';
  end if;

  v_permissions := case p_role
    when 'manager' then '{"sales": true, "stock": true, "stats": true, "settings": false}'::jsonb
    else '{"sales": true, "stock": "readonly", "stats": false, "settings": false}'::jsonb
  end;

  insert into public.operators (business_id, name, role, pin, permissions)
  values (
    p_business_id,
    btrim(p_name),
    p_role,
    crypt(p_pin, gen_salt('bf')),
    v_permissions
  )
  returning id into v_operator_id;

  return v_operator_id;
end;
$$;

create or replace function public.verify_operator_pin(
  p_business_id uuid,
  p_profile_id uuid,
  p_pin text
)
returns table (
  profile_id uuid,
  name text,
  role text,
  permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business_id uuid;
begin
  v_caller_business_id := public.get_business_id();

  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    raise exception 'Invalid business context';
  end if;

  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'PIN must contain exactly 4 digits';
  end if;

  return query
  select
    operators.id as profile_id,
    operators.name,
    operators.role,
    operators.permissions
  from public.operators
  where operators.business_id = p_business_id
    and operators.id = p_profile_id
    and operators.is_active = true
    and operators.pin = crypt(p_pin, operators.pin);

  if not found then
    raise exception 'PIN incorrecto';
  end if;
end;
$$;
