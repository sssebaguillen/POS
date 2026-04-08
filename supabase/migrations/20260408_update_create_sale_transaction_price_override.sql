-- ============================================================
-- P7d: Add price override columns to sale_items
-- and update create_sale_transaction to persist them
-- ============================================================

-- 1. Add columns (idempotent with IF NOT EXISTS)
alter table sale_items
  add column if not exists unit_price_override numeric(12,2),
  add column if not exists override_reason     text;

-- 2. Replace RPC to map the new columns
create or replace function create_sale_transaction(
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
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
begin
  -- Verify caller belongs to this business
  v_caller_business_id := get_business_id();
  if v_caller_business_id is null or p_business_id is distinct from v_caller_business_id then
    return jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  end if;

  -- Validate items array
  if p_items is null or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un item');
  end if;

  -- 1. Insert sale
  insert into sales (business_id, subtotal, discount, total, status, price_list_id, operator_id)
  values (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id)
  returning id, created_at into v_sale_id, v_sale_created_at;

  -- 2. Insert sale items (triggers on_sale_item_inserted for stock + inventory_movements)
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

  -- 3. Insert payment
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
