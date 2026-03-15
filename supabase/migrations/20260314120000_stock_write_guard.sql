-- Guarded insert function for categories.
-- Verifies that the calling operator has stock write permission before inserting.
-- If p_operator_id is the owner's profile ID (not in operators table), full access is granted.
create or replace function public.create_category_guarded(
  p_operator_id uuid,
  p_business_id uuid,
  p_name text,
  p_icon text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business_id uuid;
  v_stock_perm text;
  v_new_id uuid;
begin
  if p_operator_id is null then
    return jsonb_build_object('success', false, 'error', '403: Acceso denegado: Sesion de operador no encontrada');
  end if;

  v_caller_business_id := public.get_business_id();

  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    return jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  end if;

  -- Look up the operator's stock permission.
  select permissions->>'stock' into v_stock_perm
  from public.operators
  where id = p_operator_id
    and business_id = v_caller_business_id
    and is_active = true;

  if found then
    -- Operator found: require explicit stock = true (boolean).
    if v_stock_perm <> 'true' then
      return jsonb_build_object('success', false, 'error', '403: Acceso denegado: Permisos de inventario insuficientes');
    end if;
  else
    -- Not found as an operator — must be the owner's profile ID.
    if not exists (
      select 1 from public.profiles
      where id = p_operator_id
        and business_id = v_caller_business_id
    ) then
      return jsonb_build_object('success', false, 'error', '403: Acceso denegado: Sesion invalida');
    end if;
    -- Owners always have full stock write access.
  end if;

  insert into public.categories (business_id, name, icon, is_active)
  values (v_caller_business_id, btrim(p_name), btrim(p_icon), true)
  returning id into v_new_id;

  return jsonb_build_object('success', true, 'id', v_new_id);
end;
$$;


-- Guarded insert function for brands.
-- Same permission model as create_category_guarded.
create or replace function public.create_brand_guarded(
  p_operator_id uuid,
  p_business_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business_id uuid;
  v_stock_perm text;
  v_new_id uuid;
begin
  if p_operator_id is null then
    return jsonb_build_object('success', false, 'error', '403: Acceso denegado: Sesion de operador no encontrada');
  end if;

  v_caller_business_id := public.get_business_id();

  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    return jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  end if;

  -- Look up the operator's stock permission.
  select permissions->>'stock' into v_stock_perm
  from public.operators
  where id = p_operator_id
    and business_id = v_caller_business_id
    and is_active = true;

  if found then
    -- Operator found: require explicit stock = true (boolean).
    if v_stock_perm <> 'true' then
      return jsonb_build_object('success', false, 'error', '403: Acceso denegado: Permisos de inventario insuficientes');
    end if;
  else
    -- Not found as an operator — must be the owner's profile ID.
    if not exists (
      select 1 from public.profiles
      where id = p_operator_id
        and business_id = v_caller_business_id
    ) then
      return jsonb_build_object('success', false, 'error', '403: Acceso denegado: Sesion invalida');
    end if;
    -- Owners always have full stock write access.
  end if;

  insert into public.brands (business_id, name)
  values (v_caller_business_id, btrim(p_name))
  returning id into v_new_id;

  return jsonb_build_object('success', true, 'id', v_new_id);
end;
$$;
