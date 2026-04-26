create or replace function public.get_expenses_list(
  p_business_id uuid,
  p_from        date    default null,
  p_to          date    default null,
  p_category    text    default null,
  p_limit       integer default 50,
  p_offset      integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows  jsonb;
  v_total bigint;
begin
  select count(*) into v_total
  from public.expenses e
  where e.business_id = p_business_id
    and (p_from is null     or e.date >= p_from)
    and (p_to is null       or e.date <= p_to)
    and (p_category is null or e.category::text = p_category);

  select jsonb_agg(row_to_json(r))
  into v_rows
  from (
    select
      e.id, e.category, e.amount, e.description, e.date,
      e.attachment_url, e.attachment_type, e.attachment_name,
      e.notes, e.created_at,
      s.id   as supplier_id,
      s.name as supplier_name,
      (select count(*) from public.expense_items ei where ei.expense_id = e.id) as item_count
    from public.expenses e
    left join public.suppliers s on s.id = e.supplier_id
    where e.business_id = p_business_id
      and (p_from is null     or e.date >= p_from)
      and (p_to is null       or e.date <= p_to)
      and (p_category is null or e.category::text = p_category)
    order by e.date desc, e.created_at desc
    limit p_limit offset p_offset
  ) r;

  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'total', v_total);
end;
$$;
