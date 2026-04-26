create or replace function public.create_mercaderia_expense(
  p_business_id    uuid,
  p_description    text,
  p_date           date default current_date,
  p_supplier_id    uuid default null,
  p_operator_id    uuid default null,
  p_notes          text default null,
  p_items          jsonb default '[]',
  p_update_stock   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_total      numeric := 0;
  v_item       jsonb;
  v_product_id uuid;
  v_qty        integer;
  v_cost       numeric;
  v_name       text;
  v_update     boolean;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and business_id = p_business_id
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'no_items');
  end if;

  select sum((item->>'unit_cost')::numeric * (item->>'quantity')::integer)
  into v_total
  from jsonb_array_elements(p_items) as item;

  insert into public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id, notes
  ) values (
    p_business_id, 'mercaderia', v_total, p_description, p_date,
    p_supplier_id, p_operator_id, p_notes
  )
  returning id into v_expense_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'quantity')::integer;
    v_cost       := (v_item->>'unit_cost')::numeric;
    v_name       := v_item->>'product_name';
    v_update     := coalesce((v_item->>'update_cost')::boolean, false);

    insert into public.expense_items (
      business_id, expense_id, product_id, product_name,
      quantity, unit_cost, update_cost
    ) values (
      p_business_id, v_expense_id, v_product_id, v_name,
      v_qty, v_cost, v_update
    );

    if p_update_stock and v_product_id is not null then
      update public.products
      set stock = stock + v_qty
      where id = v_product_id and business_id = p_business_id;

      if v_update then
        update public.products
        set cost = v_cost
        where id = v_product_id and business_id = p_business_id;
      end if;

      insert into public.inventory_movements (
        business_id, product_id, type, quantity,
        reason, reference_id, created_by_operator
      ) values (
        p_business_id, v_product_id, 'purchase', v_qty,
        'Compra de mercadería — gasto #' || v_expense_id::text,
        v_expense_id,
        p_operator_id
      );
    end if;
  end loop;

  return jsonb_build_object('success', true, 'id', v_expense_id, 'total', v_total);
end;
$$;

grant execute on function public.create_mercaderia_expense to authenticated;
