-- 20260529_01_rpc_tenant_guards
--
-- Cierra fuga/escritura cross-tenant en RPC SECURITY DEFINER que reciben
-- p_business_id sin verificar que el llamador sea dueño de ese negocio.
-- (Ver docs/tests/08-auditoria-seguridad.md — hallazgo crítico.)
--
-- Dos cambios por función de datos:
--   a) Guard de tenant al inicio: assert_tenant(p_business_id) lanza excepción
--      si get_business_id() (derivado de la sesión) no coincide con p_business_id.
--      Las llamadas legítimas siempre pasan el business_id de la propia sesión
--      (requireAuthenticatedBusinessId), así que nunca dispara para la app.
--   b) Lockdown de GRANTs: REVOKE de PUBLIC + anon, GRANT explícito a authenticated.
--      (Revocar solo de anon no alcanza cuando existe grant a PUBLIC.)

-- ───────────────────────────────────────────────────────────────────────────
-- Helper: guard de tenant reutilizable
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_tenant(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF public.get_business_id() IS NULL
     OR p_business_id IS DISTINCT FROM public.get_business_id() THEN
    RAISE EXCEPTION 'Contexto de negocio invalido' USING ERRCODE = '42501';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.assert_tenant(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.assert_tenant(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- get_business_balance
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_business_balance(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_from        date := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
  v_to          date := COALESCE(p_to, CURRENT_DATE);
  v_income      numeric := 0;
  v_expenses    numeric := 0;
  v_by_category jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  -- Ingresos: ventas completadas en el período
  SELECT COALESCE(SUM(total), 0)
  INTO v_income
  FROM public.sales
  WHERE business_id = p_business_id
    AND status = 'completed'
    AND created_at::date BETWEEN v_from AND v_to;

  -- Egresos totales en el período
  SELECT COALESCE(SUM(amount), 0)
  INTO v_expenses
  FROM public.expenses
  WHERE business_id = p_business_id
    AND date BETWEEN v_from AND v_to;

  -- Egresos agrupados por categoría
  SELECT COALESCE(jsonb_object_agg(category, total_amount), '{}'::jsonb)
  INTO v_by_category
  FROM (
    SELECT category::text, SUM(amount) AS total_amount
    FROM public.expenses
    WHERE business_id = p_business_id
      AND date BETWEEN v_from AND v_to
    GROUP BY category
  ) sub;

  RETURN jsonb_build_object(
    'income',       v_income,
    'expenses',     v_expenses,
    'profit',       v_income - v_expenses,
    'margin',       CASE WHEN v_income > 0 THEN ROUND(((v_income - v_expenses) / v_income) * 100, 2) ELSE 0 END,
    'by_category',  v_by_category,
    'period_from',  v_from,
    'period_to',    v_to
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_expenses_list
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_expenses_list(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_category text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_rows  jsonb;
  v_total bigint;
begin
  perform public.assert_tenant(p_business_id);

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
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_sale_detail
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sale_detail(p_sale_id uuid, p_business_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result json;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  IF NOT EXISTS (
    SELECT 1 FROM sales
    WHERE id = p_sale_id AND business_id = p_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Sale not found');
  END IF;

  SELECT json_build_object(
    'success',        true,
    'operator_name',  COALESCE(direct_op.name, session_op.name),
    'payment_method', pay.method,
    'items', (
      SELECT json_agg(json_build_object(
        'id',                    si.id,
        'product_id',            si.product_id,
        'variant_id',            si.variant_id,
        'variant_label',         (
          SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
          FROM public.product_variant_option_values pvov
          JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
          JOIN public.product_options po        ON po.id  = pov.option_id
          WHERE pvov.variant_id = si.variant_id
        ),
        'product_name',          COALESCE(p.name, si.free_line_description, 'Producto eliminado'),
        'product_icon',          cat.icon,
        'product_icon_color',    cat.icon_color,
        'quantity',              si.quantity,
        'unit_price',            si.unit_price,
        'free_line_description', si.free_line_description
      ) ORDER BY si.id)
      FROM sale_items si
      LEFT JOIN products p     ON p.id = si.product_id
      LEFT JOIN categories cat ON cat.id = p.category_id
      WHERE si.sale_id = p_sale_id
    )
  )
  INTO v_result
  FROM sales s
  LEFT JOIN operators direct_op  ON direct_op.id = s.operator_id
  LEFT JOIN cash_sessions cs     ON cs.id = s.session_id
  LEFT JOIN operators session_op ON session_op.id = cs.opened_by
  LEFT JOIN LATERAL (
    SELECT method FROM payments
    WHERE sale_id = p_sale_id
    ORDER BY created_at DESC
    LIMIT 1
  ) pay ON true
  WHERE s.id = p_sale_id;

  RETURN v_result;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- delete_sale
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id uuid, p_business_id uuid, p_operator_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_item record; v_actor_role text; v_stored_op_id uuid; v_old_data jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id) THEN
    RETURN json_build_object('success', false, 'error', 'Sale not found'); END IF;
  SELECT role INTO v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  IF NOT FOUND THEN v_actor_role := 'owner'; END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  SELECT jsonb_build_object(
    'total', s.total, 'subtotal', s.subtotal, 'status', s.status, 'customer_id', s.customer_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id, 'variant_id', si.variant_id,
        'quantity', si.quantity, 'unit_price', si.unit_price, 'total', si.total) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id), '[]'::jsonb)
  ) INTO v_old_data FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;
  FOR v_item IN SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id LOOP
    UPDATE products
    SET stock = stock + v_item.quantity, sales_count = GREATEST(0, sales_count - v_item.quantity)
    WHERE id = v_item.product_id AND business_id = p_business_id;
  END LOOP;
  DELETE FROM inventory_movements WHERE reference_id = p_sale_id;
  DELETE FROM payments WHERE sale_id = p_sale_id;
  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM sales WHERE id = p_sale_id AND business_id = p_business_id;
  PERFORM reconcile_sales_count(p_business_id);
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'sale_deleted', 'sale', p_sale_id, NULL, v_old_data, NULL);
  RETURN json_build_object('success', true);
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- update_sale
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_sale(p_sale_id uuid, p_business_id uuid, p_items jsonb, p_payment_method text, p_operator_id uuid, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_total numeric(12,2); v_actor_role text; v_stored_op_id uuid; v_old_data jsonb; v_new_data jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id AND business_id = p_business_id) THEN
    RETURN jsonb_build_object('success', false); END IF;
  SELECT role INTO v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  IF NOT FOUND THEN v_actor_role := 'owner'; END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  SELECT jsonb_build_object(
    'total', s.total, 'subtotal', s.subtotal, 'status', s.status, 'customer_id', s.customer_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id, 'variant_id', si.variant_id,
        'quantity', si.quantity, 'unit_price', si.unit_price, 'total', si.total) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id), '[]'::jsonb)
  ) INTO v_old_data FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;
  UPDATE products p
  SET stock = p.stock + si.quantity, sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id = p_sale_id AND p.id = si.product_id AND si.variant_id IS NULL;
  UPDATE product_variants pv
  SET stock = pv.stock + si.quantity
  FROM sale_items si
  WHERE si.sale_id = p_sale_id AND pv.id = si.variant_id AND si.variant_id IS NOT NULL;
  UPDATE products p
  SET sales_count = GREATEST(0, p.sales_count - si.quantity)
  FROM sale_items si
  WHERE si.sale_id = p_sale_id AND p.id = si.product_id AND si.variant_id IS NOT NULL;
  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  INSERT INTO sale_items (sale_id, product_id, variant_id, quantity, unit_price, total)
  SELECT p_sale_id, (item->>'product_id')::uuid, NULLIF(item->>'variant_id', '')::uuid,
    (item->>'quantity')::int, (item->>'unit_price')::numeric(12,2),
    (item->>'quantity')::int * (item->>'unit_price')::numeric(12,2)
  FROM jsonb_array_elements(p_items) AS item;
  SELECT COALESCE(SUM(total), 0) INTO v_total FROM sale_items WHERE sale_id = p_sale_id;
  UPDATE sales
  SET total = v_total, subtotal = v_total, status = COALESCE(p_status, status)
  WHERE id = p_sale_id AND business_id = p_business_id;
  UPDATE payments SET method = p_payment_method WHERE sale_id = p_sale_id;
  PERFORM reconcile_sales_count(p_business_id);
  SELECT jsonb_build_object(
    'total', s.total, 'subtotal', s.subtotal, 'status', s.status, 'customer_id', s.customer_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id, 'variant_id', si.variant_id,
        'quantity', si.quantity, 'unit_price', si.unit_price, 'total', si.total) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = p_sale_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = p_sale_id), '[]'::jsonb)
  ) INTO v_new_data FROM sales s WHERE s.id = p_sale_id AND s.business_id = p_business_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'sale_updated', 'sale', p_sale_id, NULL, v_old_data, v_new_data);
  RETURN jsonb_build_object('success', true, 'total', v_total);
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_top_products_detail
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_top_products_detail(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_data  jsonb;
  v_total int;
begin
  perform public.assert_tenant(p_business_id);

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

-- ───────────────────────────────────────────────────────────────────────────
-- get_sales_by_brand_detail
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_brand_detail(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rows  jsonb;
  v_total bigint;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT COUNT(DISTINCT COALESCE(b.id::text, 'sin-marca'))
  INTO v_total
  FROM public.sale_items si
  JOIN public.sales    s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.brands b ON b.id = p.brand_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR s.created_at::date >= p_from)
    AND (p_to   IS NULL OR s.created_at::date <= p_to);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      COALESCE(b.id::text, 'sin-marca') AS brand_id,
      COALESCE(b.name, 'Sin marca')     AS brand_name,
      COUNT(DISTINCT s.id)::int         AS transaction_count,
      SUM(si.quantity)::int             AS units_sold,
      SUM(si.total)                     AS revenue,
      COUNT(DISTINCT p.id)::int         AS product_count
    FROM public.sale_items si
    JOIN public.sales    s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    LEFT JOIN public.brands b ON b.id = p.brand_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY b.id, b.name
    ORDER BY revenue DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'data',  COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_sales_by_category_detail
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_category_detail(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rows  jsonb;
  v_total bigint;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT COUNT(DISTINCT COALESCE(c.id::text, 'sin-categoria'))
  INTO v_total
  FROM public.sale_items si
  JOIN public.sales s       ON s.id = si.sale_id
  JOIN public.products p    ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR s.created_at::date >= p_from)
    AND (p_to   IS NULL OR s.created_at::date <= p_to);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      COALESCE(c.id::text, 'sin-categoria')   AS category_id,
      COALESCE(c.name, 'Sin categoría')        AS category_name,
      COALESCE(c.icon, '📦')                   AS category_icon,
      COUNT(DISTINCT s.id)::int                AS transaction_count,
      SUM(si.quantity)::int                    AS units_sold,
      SUM(si.total)                            AS revenue,
      COUNT(DISTINCT p.id)::int                AS product_count
    FROM public.sale_items si
    JOIN public.sales s       ON s.id = si.sale_id
    JOIN public.products p    ON p.id = si.product_id
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY c.id, c.name, c.icon
    ORDER BY revenue DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'data',  COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_sales_by_operator_detail
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_operator_detail(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      COALESCE(op.id::text, 'unknown')       AS operator_id,
      COALESCE(op.name, 'Sin operador')      AS operator_name,
      COALESCE(op.role, 'unknown')           AS operator_role,
      COUNT(DISTINCT s.id)::int              AS transaction_count,
      SUM(s.total)                           AS revenue,
      AVG(s.total)                           AS avg_ticket,
      SUM(si.quantity)::int                  AS units_sold
    FROM public.sales s
    LEFT JOIN public.operators op ON op.id = s.operator_id
    LEFT JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY op.id, op.name, op.role
    ORDER BY revenue DESC
  ) r;

  RETURN jsonb_build_object(
    'data', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_sales_by_payment_detail
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_payment_detail(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      pay.method,
      COUNT(DISTINCT s.id)::int   AS transaction_count,
      SUM(pay.amount)             AS total_amount,
      AVG(pay.amount)             AS avg_amount,
      ROUND(
        SUM(pay.amount) * 100.0 /
        NULLIF(SUM(SUM(pay.amount)) OVER (), 0),
        2
      )                           AS percentage
    FROM public.payments pay
    JOIN public.sales s ON s.id = pay.sale_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND pay.status = 'completed'
      AND (p_from IS NULL OR s.created_at::date >= p_from)
      AND (p_to   IS NULL OR s.created_at::date <= p_to)
    GROUP BY pay.method
    ORDER BY total_amount DESC
  ) r;

  RETURN jsonb_build_object(
    'data', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_stats_kpis
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stats_kpis(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_from        date;
  v_to          date;
  v_prev_from   date;
  v_prev_to     date;
  v_days        int;

  v_total_sales     int;
  v_total_revenue   numeric;
  v_total_units     int;
  v_avg_ticket      numeric;

  v_prev_sales      int;
  v_prev_revenue    numeric;
  v_prev_units      int;

  v_peak_day        text;
  v_peak_revenue    numeric;
  v_day_of_week     jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  v_to   := COALESCE(p_to,   CURRENT_DATE);
  v_from := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);

  v_days      := (v_to - v_from) + 1;
  v_prev_to   := v_from - interval '1 day';
  v_prev_from := v_prev_to - (v_days - 1) * interval '1 day';

  -- KPIs período actual (incluye total_units)
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(s.total), 0),
    COALESCE(SUM(si_totals.units), 0)::int,
    CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(s.total) / COUNT(*), 2) ELSE 0 END
  INTO v_total_sales, v_total_revenue, v_total_units, v_avg_ticket
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(si.quantity), 0) AS units
    FROM sale_items si WHERE si.sale_id = s.id
  ) si_totals ON true
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_from AND v_to;

  -- KPIs período anterior
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(s.total), 0),
    COALESCE(SUM(si_totals.units), 0)::int
  INTO v_prev_sales, v_prev_revenue, v_prev_units
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(si.quantity), 0) AS units
    FROM sale_items si WHERE si.sale_id = s.id
  ) si_totals ON true
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_prev_from AND v_prev_to;

  -- Peak day (día con mayor revenue en el período)
  SELECT
    to_char(s.created_at::date, 'YYYY-MM-DD'),
    ROUND(SUM(s.total), 2)
  INTO v_peak_day, v_peak_revenue
  FROM sales s
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_from AND v_to
  GROUP BY s.created_at::date
  ORDER BY SUM(s.total) DESC
  LIMIT 1;

  -- Day of week (0=Sun..6=Sat → label ES)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'dow',     dow_num,
      'label',   CASE dow_num
                   WHEN 0 THEN 'Dom' WHEN 1 THEN 'Lun' WHEN 2 THEN 'Mar'
                   WHEN 3 THEN 'Mié' WHEN 4 THEN 'Jue' WHEN 5 THEN 'Vie'
                   ELSE 'Sáb' END,
      'revenue', ROUND(COALESCE(revenue, 0), 2),
      'count',   COALESCE(cnt, 0)::int
    )
    ORDER BY dow_num
  ), '[]'::jsonb)
  INTO v_day_of_week
  FROM (
    SELECT
      EXTRACT(DOW FROM s.created_at)::int AS dow_num,
      SUM(s.total)                         AS revenue,
      COUNT(*)                             AS cnt
    FROM sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND s.created_at::date BETWEEN v_from AND v_to
    GROUP BY EXTRACT(DOW FROM s.created_at)::int
  ) dow_data;

  RETURN jsonb_build_object(
    'total_sales',        v_total_sales,
    'total_revenue',      v_total_revenue,
    'total_units',        v_total_units,
    'avg_ticket',         v_avg_ticket,
    'prev_total_sales',   v_prev_sales,
    'prev_total_revenue', v_prev_revenue,
    'prev_total_units',   v_prev_units,
    'peak_day',           v_peak_day,
    'peak_revenue',       v_peak_revenue,
    'day_of_week',        v_day_of_week,
    'period_from',        v_from,
    'period_to',          v_to
  );
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_stats_breakdown
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stats_breakdown(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_from         date;
  v_to           date;
  v_by_category  jsonb;
  v_by_brand     jsonb;
  v_by_payment   jsonb;
  v_by_operator  jsonb;
begin
  perform public.assert_tenant(p_business_id);

  v_to   := coalesce(p_to,   current_date);
  v_from := coalesce(p_from, date_trunc('month', current_date)::date);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category_id',   sub.category_id,
      'category_name', sub.category_name,
      'revenue',       sub.revenue,
      'units',         sub.units
    )
    order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_category
  from (
    select
      c.id                                     as category_id,
      coalesce(c.name, 'Sin categoría')        as category_name,
      round(sum(si.total), 2)                  as revenue,
      sum(si.quantity)::int                    as units
    from sales s
    join sale_items si on si.sale_id = s.id
    join products p    on p.id = si.product_id
    left join categories c on c.id = p.category_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by c.id, c.name
  ) sub;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'brand_id',   sub.brand_id,
      'brand_name', sub.brand_name,
      'revenue',    sub.revenue,
      'units',      sub.units
    )
    order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_brand
  from (
    select
      b.id                                as brand_id,
      coalesce(b.name, 'Sin marca')       as brand_name,
      round(sum(si.total), 2)             as revenue,
      sum(si.quantity)::int               as units
    from sales s
    join sale_items si on si.sale_id = s.id
    join products p    on p.id = si.product_id
    left join brands b on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by b.id, b.name
  ) sub;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'method',  sub.method,
      'revenue', sub.revenue,
      'count',   sub.cnt
    )
    order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_payment
  from (
    select
      py.method,
      round(sum(py.amount), 2)      as revenue,
      count(distinct s.id)::int     as cnt
    from sales s
    join payments py on py.sale_id = s.id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by py.method
  ) sub;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'operator_id',   sub.operator_id,
      'operator_name', sub.operator_name,
      'revenue',       sub.revenue,
      'count',         sub.cnt
    )
    order by sub.revenue desc
  ), '[]'::jsonb)
  into v_by_operator
  from (
    select
      coalesce(o.id::text, 'unknown') as operator_id,
      coalesce(o.name, 'Sin operador') as operator_name,
      round(sum(s.total), 2)           as revenue,
      count(s.id)::int                 as cnt
    from sales s
    left join operators o on o.id = s.operator_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and s.created_at::date between v_from and v_to
    group by o.id, o.name
  ) sub;

  return jsonb_build_object(
    'by_category', v_by_category,
    'by_brand',    v_by_brand,
    'by_payment',  v_by_payment,
    'by_operator', v_by_operator
  );
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_stats_evolution  (interval '1 day' normalizado, sin newline embebido)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stats_evolution(p_business_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_from      date;
  v_to        date;
  v_days      int;
begin
  perform public.assert_tenant(p_business_id);

  v_to   := coalesce(p_to,   current_date);
  v_from := coalesce(p_from, date_trunc('month', current_date)::date);
  v_days := (v_to - v_from) + 1;

  if v_days <= 60 then
    return jsonb_build_object(
      'granularity', 'day',
      'data', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'date',         sub.d_str,
            'label',        sub.d_label,
            'revenue',      sub.revenue,
            'count',        sub.cnt,
            'prev_revenue', sub.prev_revenue,
            'prev_count',   sub.prev_cnt
          )
          order by sub.d
        ), '[]'::jsonb)
        from (
          select
            day_series.d,
            to_char(day_series.d, 'YYYY-MM-DD') as d_str,
            to_char(day_series.d, 'DD/MM')       as d_label,
            coalesce(sum(s.total) filter (
              where s.created_at::date = day_series.d::date
            ), 0) as revenue,
            count(s.id) filter (
              where s.created_at::date = day_series.d::date
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where s.created_at::date = (day_series.d - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where s.created_at::date = (day_series.d - v_days * interval '1 day')::date
            )::int as prev_cnt
          from generate_series(v_from, v_to, '1 day'::interval) as day_series(d)
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              s.created_at::date = day_series.d::date
              or s.created_at::date = (day_series.d - v_days * interval '1 day')::date
            )
          group by day_series.d
        ) sub
      )
    );
  else
    return jsonb_build_object(
      'granularity', 'week',
      'data', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'date',         sub.ws_str,
            'label',        sub.ws_label,
            'revenue',      sub.revenue,
            'count',        sub.cnt,
            'prev_revenue', sub.prev_revenue,
            'prev_count',   sub.prev_cnt
          )
          order by sub.week_start
        ), '[]'::jsonb)
        from (
          select
            weeks.week_start,
            to_char(weeks.week_start, 'YYYY-MM-DD') as ws_str,
            to_char(weeks.week_start, 'DD/MM')       as ws_label,
            coalesce(sum(s.total) filter (
              where date_trunc('week', s.created_at)::date = weeks.week_start
            ), 0) as revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at)::date = weeks.week_start
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where date_trunc('week', s.created_at)::date = (weeks.week_start - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at)::date = (weeks.week_start - v_days * interval '1 day')::date
            )::int as prev_cnt
          from (
            select distinct date_trunc('week', d)::date as week_start
            from generate_series(v_from, v_to, '1 day'::interval) as gs(d)
          ) weeks
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              date_trunc('week', s.created_at)::date = weeks.week_start
              or date_trunc('week', s.created_at)::date = (weeks.week_start - v_days * interval '1 day')::date
            )
          group by weeks.week_start
        ) sub
      )
    );
  end if;
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- search_expense_products  (SQL → plpgsql para poder guardar el tenant)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_expense_products(p_business_id uuid, p_term text, p_limit integer DEFAULT 20)
 RETURNS TABLE(product_id uuid, product_name text, variant_id uuid, variant_label text, stock integer, cost numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  RETURN QUERY
  SELECT * FROM (
    SELECT
      p.id            AS product_id,
      p.name          AS product_name,
      NULL::uuid      AS variant_id,
      NULL::text      AS variant_label,
      p.stock         AS stock,
      p.cost          AS cost
    FROM public.products p
    WHERE p.business_id = p_business_id
      AND p.is_active = true
      AND p.has_variants = false
      AND (p.name ILIKE '%' || p_term || '%' OR p.barcode = p_term)

    UNION ALL

    SELECT
      p.id            AS product_id,
      p.name          AS product_name,
      pv.id           AS variant_id,
      (
        SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
        FROM public.product_variant_option_values pvov
        JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
        JOIN public.product_options po        ON po.id  = pov.option_id
        WHERE pvov.variant_id = pv.id
      )               AS variant_label,
      pv.stock        AS stock,
      pv.cost         AS cost
    FROM public.products p
    JOIN public.product_variants pv
      ON pv.product_id = p.id
     AND pv.business_id = p_business_id
     AND pv.is_active = true
    WHERE p.business_id = p_business_id
      AND p.is_active = true
      AND p.has_variants = true
      AND (
        p.name ILIKE '%' || p_term || '%'
        OR p.barcode = p_term
        OR pv.barcode = p_term
        OR pv.sku = p_term
      )
  ) AS results
  ORDER BY results.product_name, results.variant_label
  LIMIT p_limit;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- get_mercaderia_expense_items  (SQL → plpgsql para poder guardar el tenant)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_mercaderia_expense_items(p_expense_id uuid, p_business_id uuid)
 RETURNS TABLE(id uuid, product_id uuid, product_name text, variant_id uuid, variant_label text, quantity integer, unit_cost numeric, update_cost boolean, stock integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  RETURN QUERY
  SELECT
    ei.id,
    ei.product_id,
    ei.product_name,
    ei.variant_id,
    CASE WHEN ei.variant_id IS NOT NULL THEN (
      SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
      FROM public.product_variant_option_values pvov
      JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
      JOIN public.product_options po        ON po.id  = pov.option_id
      WHERE pvov.variant_id = ei.variant_id
    ) END,
    ei.quantity,
    ei.unit_cost,
    ei.update_cost,
    COALESCE(
      CASE WHEN ei.variant_id IS NOT NULL
        THEN (SELECT pv.stock FROM public.product_variants pv WHERE pv.id = ei.variant_id)
        ELSE (SELECT p.stock  FROM public.products p          WHERE p.id  = ei.product_id)
      END,
      0
    ) AS stock
  FROM public.expense_items ei
  WHERE ei.expense_id = p_expense_id
    AND ei.business_id = p_business_id
  ORDER BY ei.id;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- Lockdown de GRANTs: quitar a PUBLIC + anon, asegurar authenticated.
-- (service_role conserva su grant; CREATE OR REPLACE no resetea privilegios.)
-- ───────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_business_balance(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_business_balance(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_expenses_list(uuid, date, date, text, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_expenses_list(uuid, date, date, text, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sale_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sale_detail(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_sale(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_sale(uuid, uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_sale(uuid, uuid, jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_sale(uuid, uuid, jsonb, text, uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_top_products_detail(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_top_products_detail(uuid, date, date, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_brand_detail(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_brand_detail(uuid, date, date, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_category_detail(uuid, date, date, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_category_detail(uuid, date, date, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_operator_detail(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_operator_detail(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_payment_detail(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_payment_detail(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_stats_kpis(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_stats_kpis(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_stats_breakdown(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_stats_breakdown(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_stats_evolution(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_stats_evolution(uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.search_expense_products(uuid, text, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_expense_products(uuid, text, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_mercaderia_expense_items(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_mercaderia_expense_items(uuid, uuid) TO authenticated;
