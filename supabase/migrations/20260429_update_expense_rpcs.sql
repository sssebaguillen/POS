-- update_expense: non-mercadería expenses only
drop function if exists public.update_expense(uuid, uuid, text, date, uuid, text, numeric, text, text, text);

create or replace function public.update_expense(
  p_business_id     uuid,
  p_expense_id      uuid,
  p_description     text,
  p_date            date,
  p_supplier_id     uuid    default null,
  p_notes           text    default null,
  p_amount          numeric default 0,
  p_attachment_url  text    default null,
  p_attachment_type text    default null,
  p_attachment_name text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and business_id = p_business_id
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  update public.expenses
  set
    description     = p_description,
    date            = p_date,
    supplier_id     = p_supplier_id,
    notes           = p_notes,
    amount          = p_amount,
    attachment_url  = p_attachment_url,
    attachment_type = p_attachment_type,
    attachment_name = p_attachment_name,
    updated_at      = now()
  where id = p_expense_id
    and business_id = p_business_id
    and category != 'mercaderia';

  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_expense(uuid, uuid, text, date, uuid, text, numeric, text, text, text) to authenticated;


-- update_mercaderia_expense: diffs items, adjusts stock/cost/movements
drop function if exists public.update_mercaderia_expense(uuid, uuid, text, date, uuid, text, jsonb);

create or replace function public.update_mercaderia_expense(
  p_business_id uuid,
  p_expense_id  uuid,
  p_description text,
  p_date        date,
  p_supplier_id uuid  default null,
  p_notes       text  default null,
  p_items       jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing       record;
  v_new_item       jsonb;
  v_new_product_id uuid;
  v_new_qty        integer;
  v_new_cost       numeric;
  v_new_update     boolean;
  v_new_name       text;
  v_qty_delta      integer;
  v_current_cost   numeric;
  v_old_qty        integer;
  v_old_cost       numeric;
  v_total          numeric := 0;
  v_warnings       jsonb   := '[]'::jsonb;
  v_new_ids        uuid[];
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and business_id = p_business_id
  ) then
    return jsonb_build_object('success', false, 'error', 'unauthorized');
  end if;

  if not exists (
    select 1 from public.expenses
    where id = p_expense_id and business_id = p_business_id and category = 'mercaderia'
  ) then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;

  -- Collect product_ids present in the new items array
  select array_agg((item->>'product_id')::uuid)
  into v_new_ids
  from jsonb_array_elements(p_items) as item
  where (item->>'product_id') is not null;

  -- Revert stock and movements for items being removed
  for v_existing in
    select ei.product_id, ei.quantity
    from public.expense_items ei
    where ei.expense_id = p_expense_id
      and ei.product_id is not null
      and (v_new_ids is null or ei.product_id != all(v_new_ids))
  loop
    update public.products
    set stock = stock - v_existing.quantity
    where id = v_existing.product_id and business_id = p_business_id;

    delete from public.inventory_movements
    where reference_id = p_expense_id
      and product_id = v_existing.product_id
      and business_id = p_business_id;
  end loop;

  -- Remove expense_items not in the new array (and all null-product_id items, re-inserted below)
  delete from public.expense_items
  where expense_id = p_expense_id
    and (product_id is null or v_new_ids is null or product_id != all(v_new_ids));

  -- Apply new items (add, update, or re-insert)
  for v_new_item in select * from jsonb_array_elements(p_items)
  loop
    v_new_product_id := (v_new_item->>'product_id')::uuid;
    v_new_qty        := (v_new_item->>'quantity')::integer;
    v_new_cost       := (v_new_item->>'unit_cost')::numeric;
    v_new_update     := coalesce((v_new_item->>'update_cost')::boolean, false);
    v_new_name       := v_new_item->>'product_name';

    -- No product link: just store the line, no stock/movement side effects
    if v_new_product_id is null then
      insert into public.expense_items (
        business_id, expense_id, product_id, product_name, quantity, unit_cost, update_cost
      ) values (
        p_business_id, p_expense_id, null, v_new_name, v_new_qty, v_new_cost, v_new_update
      );
      continue;
    end if;

    -- Look up old values for this product (if it survived the delete above)
    select quantity, unit_cost
    into v_old_qty, v_old_cost
    from public.expense_items
    where expense_id = p_expense_id and product_id = v_new_product_id;

    if found then
      -- Existing item: apply quantity delta
      v_qty_delta := v_new_qty - v_old_qty;

      if v_qty_delta != 0 then
        update public.products
        set stock = stock + v_qty_delta
        where id = v_new_product_id and business_id = p_business_id;

        update public.inventory_movements
        set quantity = v_new_qty
        where reference_id = p_expense_id
          and product_id = v_new_product_id
          and business_id = p_business_id;
      end if;

      -- Update product cost only if current cost still matches the old saved cost
      if v_new_update then
        select cost into v_current_cost
        from public.products
        where id = v_new_product_id and business_id = p_business_id;

        if v_current_cost is distinct from v_old_cost then
          v_warnings := v_warnings || jsonb_build_array(
            jsonb_build_object('product_id', v_new_product_id, 'reason', 'cost_changed')
          );
        else
          update public.products
          set cost = v_new_cost
          where id = v_new_product_id and business_id = p_business_id;
        end if;
      end if;

      update public.expense_items
      set quantity     = v_new_qty,
          unit_cost    = v_new_cost,
          update_cost  = v_new_update,
          product_name = v_new_name
      where expense_id = p_expense_id and product_id = v_new_product_id;

    else
      -- Brand-new item in this expense
      update public.products
      set stock = stock + v_new_qty
      where id = v_new_product_id and business_id = p_business_id;

      if v_new_update then
        update public.products
        set cost = v_new_cost
        where id = v_new_product_id and business_id = p_business_id;
      end if;

      insert into public.inventory_movements (
        business_id, product_id, type, quantity,
        reason, reference_id
      ) values (
        p_business_id, v_new_product_id, 'purchase', v_new_qty,
        'Compra de mercadería — gasto #' || p_expense_id::text,
        p_expense_id
      );

      insert into public.expense_items (
        business_id, expense_id, product_id, product_name, quantity, unit_cost, update_cost
      ) values (
        p_business_id, p_expense_id, v_new_product_id, v_new_name, v_new_qty, v_new_cost, v_new_update
      );
    end if;
  end loop;

  -- Recalculate total from the final set of items
  select coalesce(sum(quantity * unit_cost), 0)
  into v_total
  from public.expense_items
  where expense_id = p_expense_id;

  update public.expenses
  set
    description = p_description,
    date        = p_date,
    supplier_id = p_supplier_id,
    notes       = p_notes,
    amount      = v_total,
    updated_at  = now()
  where id = p_expense_id and business_id = p_business_id;

  return jsonb_build_object('success', true, 'warnings', v_warnings);
end;
$$;

grant execute on function public.update_mercaderia_expense(uuid, uuid, text, date, uuid, text, jsonb) to authenticated;
