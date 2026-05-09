CREATE OR REPLACE FUNCTION public.get_top_products_detail(
  p_business_id uuid,
  p_from        date    DEFAULT NULL,
  p_to          date    DEFAULT NULL,
  p_limit       integer DEFAULT 20,
  p_offset      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_data  jsonb;
  v_total int;
begin
  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and (p_from is null or s.created_at::date >= p_from)
    and (p_to   is null or s.created_at::date <= p_to);

  select jsonb_agg(row)
  into v_data
  from (
    select
      p.id,
      p.name,
      p.sku,
      c.name                                                    as category_name,
      b.name                                                    as brand_name,
      -- Display price/cost: use default variant if product has variants
      COALESCE(pv_def.price, p.price)                          as price,
      COALESCE(pv_def.cost,  p.cost)                           as cost,
      sum(si.quantity)                                          as units_sold,
      sum(si.total)                                             as revenue,
      -- Gross profit: use each sale item's specific variant cost
      sum(si.total) - sum(si.quantity * COALESCE(pv.cost, p.cost)) as gross_profit,
      count(distinct s.id)                                      as transaction_count
    from sale_items si
    join sales s           on s.id = si.sale_id
    join products p        on p.id = si.product_id
    -- JOIN for per-item variant cost (used in gross_profit calculation)
    left join product_variants pv     on pv.id = si.variant_id
    -- JOIN for display price/cost (default variant of the product)
    left join product_variants pv_def on pv_def.id = p.default_variant_id
    left join categories c on c.id = p.category_id
    left join brands b     on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or s.created_at::date >= p_from)
      and (p_to   is null or s.created_at::date <= p_to)
    group by p.id, p.name, p.sku, c.name, b.name, p.price, p.cost, pv_def.price, pv_def.cost
    order by units_sold desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',  coalesce(v_data, '[]'::jsonb),
    'total', v_total
  );
end;
$function$;
