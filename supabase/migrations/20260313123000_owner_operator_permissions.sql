-- Ensure profiles has permissions for role-based operator session checks.
alter table public.profiles
  add column if not exists permissions jsonb;

-- Backfill owner permissions for existing rows.
update public.profiles
set permissions = '{"sales": true, "stock": true, "stats": true, "settings": true}'::jsonb
where role = 'owner'
  and (
    permissions is null
    or permissions <> '{"sales": true, "stock": true, "stats": true, "settings": true}'::jsonb
  );

create or replace function public.bootstrap_new_user(
  p_user_id uuid,
  p_business_name text,
  p_user_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_slug text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_business_name is null or btrim(p_business_name) = '' then
    raise exception 'p_business_name is required';
  end if;

  if p_user_name is null or btrim(p_user_name) = '' then
    raise exception 'p_user_name is required';
  end if;

  v_slug := lower(regexp_replace(btrim(p_business_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);

  if v_slug = '' then
    v_slug := 'negocio';
  end if;

  v_slug := v_slug || '-' || substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6);

  insert into public.businesses (name, slug)
  values (btrim(p_business_name), v_slug)
  returning id into v_business_id;

  insert into public.profiles (id, business_id, role, name, permissions)
  values (
    p_user_id,
    v_business_id,
    'owner',
    btrim(p_user_name),
    '{"sales": true, "stock": true, "stats": true, "settings": true}'::jsonb
  );

  return jsonb_build_object(
    'success', true,
    'business_id', v_business_id
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'error', sqlerrm
    );
end;
$$;
