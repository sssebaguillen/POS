drop function if exists public.delete_expense(uuid, uuid);

create or replace function public.delete_expense(
  p_business_id uuid,
  p_expense_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category    text;
  v_item        record;
  v_current_cost numeric;
  v_warnings    jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and business_id = p_business_id
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  select category into v_category
  from public.expenses
  where id = p_expense_id and business_id = p_business_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  if v_category = 'mercaderia' then
    for v_item in
      select ei.product_id, ei.quantity, ei.unit_cost, ei.update_cost
      from public.expense_items ei
      where ei.expense_id = p_expense_id
        and ei.product_id is not null
    loop
      update public.products
      set stock = stock - v_item.quantity
      where id = v_item.product_id and business_id = p_business_id;

      if v_item.update_cost then
        select cost into v_current_cost
        from public.products
        where id = v_item.product_id and business_id = p_business_id;

        if v_current_cost is distinct from v_item.unit_cost then
          v_warnings := v_warnings || jsonb_build_array(
            jsonb_build_object('product_id', v_item.product_id, 'reason', 'cost_changed')
          );
        else
          update public.products
          set cost = null
          where id = v_item.product_id and business_id = p_business_id;
        end if;
      end if;
    end loop;

    delete from public.inventory_movements
    where reference_id = p_expense_id and business_id = p_business_id;

    delete from public.expense_items
    where expense_id = p_expense_id;
  end if;

  delete from public.expenses
  where id = p_expense_id and business_id = p_business_id;

  if jsonb_array_length(v_warnings) > 0 then
    return jsonb_build_object('success', true, 'warnings', v_warnings);
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.delete_expense(uuid, uuid) to authenticated;
