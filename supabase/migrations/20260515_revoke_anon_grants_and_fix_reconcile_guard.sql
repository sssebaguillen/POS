-- Audit: Database Security (2026-05-14) — Priority 1 + Priority 4
-- 1. Revoke anon EXECUTE from 38 non-public RPCs; re-grant to authenticated.
--    Catalog RPCs, bootstrap_new_user, verify_operator_pin, and trigger
--    functions retain their existing grants and are intentionally omitted.
-- 2. Fix reconcile_sales_count NULL guard: when get_business_id() returns
--    NULL (anon caller), `p_business_id != NULL` evaluates to NULL, not TRUE,
--    so the guard never fired. Add explicit NULL check.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Priority 1 — Revoke anon, grant authenticated (38 RPCs)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.bulk_delete_products(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_delete_products(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_set_product_status(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_is_active boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_set_product_status(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_is_active boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_update_product_brand(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_brand_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_update_product_brand(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_brand_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_update_product_category(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_category_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_update_product_category(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_category_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_brand_guarded(p_operator_id uuid, p_business_id uuid, p_name text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_brand_guarded(p_operator_id uuid, p_business_id uuid, p_name text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_category_guarded(p_operator_id uuid, p_business_id uuid, p_name text, p_icon text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_category_guarded(p_operator_id uuid, p_business_id uuid, p_name text, p_icon text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_expense(p_business_id uuid, p_category text, p_amount numeric, p_description text, p_date date, p_supplier_id uuid, p_operator_id uuid, p_attachment_url text, p_attachment_type text, p_attachment_name text, p_notes text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_expense(p_business_id uuid, p_category text, p_amount numeric, p_description text, p_date date, p_supplier_id uuid, p_operator_id uuid, p_attachment_url text, p_attachment_type text, p_attachment_name text, p_notes text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_mercaderia_expense(p_business_id uuid, p_description text, p_date date, p_supplier_id uuid, p_operator_id uuid, p_notes text, p_items jsonb, p_update_stock boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_mercaderia_expense(p_business_id uuid, p_description text, p_date date, p_supplier_id uuid, p_operator_id uuid, p_notes text, p_items jsonb, p_update_stock boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_operator(p_business_id uuid, p_name text, p_role text, p_pin text, p_permissions jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_operator(p_business_id uuid, p_name text, p_role text, p_pin text, p_permissions jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_product_with_variants(p_product jsonb, p_options jsonb, p_variants jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_product_with_variants(p_product jsonb, p_options jsonb, p_variants jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_sale_transaction(p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric, p_status text, p_price_list_id uuid, p_operator_id uuid, p_items jsonb, p_payments jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_sale_transaction(p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric, p_status text, p_price_list_id uuid, p_operator_id uuid, p_items jsonb, p_payments jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_expense(p_business_id uuid, p_expense_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_expense(p_business_id uuid, p_expense_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_sale(p_sale_id uuid, p_business_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_sale(p_sale_id uuid, p_business_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_attribute_types() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_attribute_types() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_business_balance(p_business_id uuid, p_from date, p_to date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_business_balance(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_expenses_list(p_business_id uuid, p_from date, p_to date, p_category text, p_limit integer, p_offset integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_expenses_list(p_business_id uuid, p_from date, p_to date, p_category text, p_limit integer, p_offset integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_operator_stats(p_operator_id uuid, p_date_from timestamptz, p_date_to timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_operator_stats(p_operator_id uuid, p_date_from timestamptz, p_date_to timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_owner_stats(p_date_from timestamptz, p_date_to timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_owner_stats(p_date_from timestamptz, p_date_to timestamptz) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_product_with_variants(p_product_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_product_with_variants(p_product_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sale_detail(p_sale_id uuid, p_business_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sale_detail(p_sale_id uuid, p_business_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_brand_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_brand_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_category_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_category_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_operator_detail(p_business_id uuid, p_from date, p_to date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_operator_detail(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_by_payment_detail(p_business_id uuid, p_from date, p_to date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_payment_detail(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_stats_breakdown(p_business_id uuid, p_from date, p_to date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stats_breakdown(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_stats_evolution(p_business_id uuid, p_from date, p_to date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stats_evolution(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_stats_kpis(p_business_id uuid, p_from date, p_to date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_stats_kpis(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_top_products_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_top_products_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reconcile_sales_count(p_business_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reconcile_sales_count(p_business_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.swap_default_price_list(p_price_list_id uuid, p_business_id uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.swap_default_price_list(p_price_list_id uuid, p_business_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid, p_name text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid, p_name text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_business_slug(p_slug text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_business_slug(p_slug text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid, p_name text, p_icon text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid, p_name text, p_icon text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_expense(p_business_id uuid, p_expense_id uuid, p_description text, p_date date, p_supplier_id uuid, p_notes text, p_amount numeric, p_attachment_url text, p_attachment_type text, p_attachment_name text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_expense(p_business_id uuid, p_expense_id uuid, p_description text, p_date date, p_supplier_id uuid, p_notes text, p_amount numeric, p_attachment_url text, p_attachment_type text, p_attachment_name text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_mercaderia_expense(p_business_id uuid, p_expense_id uuid, p_description text, p_date date, p_supplier_id uuid, p_notes text, p_items jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_mercaderia_expense(p_business_id uuid, p_expense_id uuid, p_description text, p_date date, p_supplier_id uuid, p_notes text, p_items jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_operator(p_operator_id uuid, p_name text, p_new_pin text, p_permissions jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_operator(p_operator_id uuid, p_name text, p_new_pin text, p_permissions jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_product_variants(p_product_id uuid, p_options jsonb, p_variants jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_product_variants(p_product_id uuid, p_options jsonb, p_variants jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_sale(p_sale_id uuid, p_business_id uuid, p_items jsonb, p_payment_method text, p_status text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_sale(p_sale_id uuid, p_business_id uuid, p_items jsonb, p_payment_method text, p_status text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Priority 4 — Fix reconcile_sales_count NULL guard
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reconcile_sales_count(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF get_business_id() IS NULL OR p_business_id != get_business_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE products
  SET sales_count = (
    SELECT COALESCE(SUM(si.quantity), 0)
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND si.product_id = products.id
  )
  WHERE business_id = p_business_id;
END;
$function$;

COMMIT;
