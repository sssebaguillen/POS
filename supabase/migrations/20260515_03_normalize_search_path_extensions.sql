-- Audit: Database Security (2026-05-14) — Priority 6
-- Normalize search_path to `public, extensions` on every SECURITY DEFINER
-- function. The `extensions` schema hosts pgcrypto (`crypt`, `gen_salt`,
-- `gen_random_uuid`) — without it, future calls to those routines fail.
-- `rls_auto_enable` is intentionally excluded (uses pg_catalog).

BEGIN;

ALTER FUNCTION public.bootstrap_new_user(p_user_id uuid, p_business_name text, p_user_name text) SET search_path = public, extensions;
ALTER FUNCTION public.bulk_delete_products(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[]) SET search_path = public, extensions;
ALTER FUNCTION public.bulk_set_product_status(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_is_active boolean) SET search_path = public, extensions;
ALTER FUNCTION public.bulk_update_product_brand(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_brand_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.bulk_update_product_category(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_category_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.create_brand_guarded(p_operator_id uuid, p_business_id uuid, p_name text) SET search_path = public, extensions;
ALTER FUNCTION public.create_category_guarded(p_operator_id uuid, p_business_id uuid, p_name text, p_icon text) SET search_path = public, extensions;
ALTER FUNCTION public.create_expense(p_business_id uuid, p_category text, p_amount numeric, p_description text, p_date date, p_supplier_id uuid, p_operator_id uuid, p_attachment_url text, p_attachment_type text, p_attachment_name text, p_notes text) SET search_path = public, extensions;
ALTER FUNCTION public.create_mercaderia_expense(p_business_id uuid, p_description text, p_date date, p_supplier_id uuid, p_operator_id uuid, p_notes text, p_items jsonb, p_update_stock boolean) SET search_path = public, extensions;
ALTER FUNCTION public.create_operator(p_business_id uuid, p_name text, p_role text, p_pin text, p_permissions jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.create_product_with_variants(p_product jsonb, p_options jsonb, p_variants jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.create_sale_transaction(p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric, p_status text, p_price_list_id uuid, p_operator_id uuid, p_items jsonb, p_payments jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.delete_expense(p_business_id uuid, p_expense_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.delete_sale(p_sale_id uuid, p_business_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_attribute_types() SET search_path = public, extensions;
ALTER FUNCTION public.get_business_balance(p_business_id uuid, p_from date, p_to date) SET search_path = public, extensions;
ALTER FUNCTION public.get_business_id() SET search_path = public, extensions;
ALTER FUNCTION public.get_catalog_categories(p_slug text) SET search_path = public, extensions;
ALTER FUNCTION public.get_catalog_default_variant_prices(p_slug text) SET search_path = public, extensions;
ALTER FUNCTION public.get_catalog_product_with_variants(p_slug text, p_product_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_catalog_products(p_slug text) SET search_path = public, extensions;
ALTER FUNCTION public.get_catalog_variant_filters(p_slug text) SET search_path = public, extensions;
ALTER FUNCTION public.get_expenses_list(p_business_id uuid, p_from date, p_to date, p_category text, p_limit integer, p_offset integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_operator_stats(p_operator_id uuid, p_date_from timestamptz, p_date_to timestamptz) SET search_path = public, extensions;
ALTER FUNCTION public.get_owner_stats(p_date_from timestamptz, p_date_to timestamptz) SET search_path = public, extensions;
ALTER FUNCTION public.get_product_with_variants(p_product_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_sale_detail(p_sale_id uuid, p_business_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.get_sales_by_brand_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_sales_by_category_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) SET search_path = public, extensions;
ALTER FUNCTION public.get_sales_by_operator_detail(p_business_id uuid, p_from date, p_to date) SET search_path = public, extensions;
ALTER FUNCTION public.get_sales_by_payment_detail(p_business_id uuid, p_from date, p_to date) SET search_path = public, extensions;
ALTER FUNCTION public.get_stats_breakdown(p_business_id uuid, p_from date, p_to date) SET search_path = public, extensions;
ALTER FUNCTION public.get_stats_evolution(p_business_id uuid, p_from date, p_to date) SET search_path = public, extensions;
ALTER FUNCTION public.get_stats_kpis(p_business_id uuid, p_from date, p_to date) SET search_path = public, extensions;
ALTER FUNCTION public.get_top_products_detail(p_business_id uuid, p_from date, p_to date, p_limit integer, p_offset integer) SET search_path = public, extensions;
ALTER FUNCTION public.reconcile_sales_count(p_business_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.set_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.swap_default_price_list(p_price_list_id uuid, p_business_id uuid) SET search_path = public, extensions;
ALTER FUNCTION public.update_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid, p_name text) SET search_path = public, extensions;
ALTER FUNCTION public.update_business_slug(p_slug text) SET search_path = public, extensions;
ALTER FUNCTION public.update_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid, p_name text, p_icon text) SET search_path = public, extensions;
ALTER FUNCTION public.update_expense(p_business_id uuid, p_expense_id uuid, p_description text, p_date date, p_supplier_id uuid, p_notes text, p_amount numeric, p_attachment_url text, p_attachment_type text, p_attachment_name text) SET search_path = public, extensions;
ALTER FUNCTION public.update_mercaderia_expense(p_business_id uuid, p_expense_id uuid, p_description text, p_date date, p_supplier_id uuid, p_notes text, p_items jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.update_operator(p_operator_id uuid, p_name text, p_new_pin text, p_permissions jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.update_product_variants(p_product_id uuid, p_options jsonb, p_variants jsonb) SET search_path = public, extensions;
ALTER FUNCTION public.update_sale(p_sale_id uuid, p_business_id uuid, p_items jsonb, p_payment_method text, p_status text) SET search_path = public, extensions;
ALTER FUNCTION public.update_stock_on_sale() SET search_path = public, extensions;
ALTER FUNCTION public.verify_operator_pin(p_business_id uuid, p_operator_id uuid, p_pin text) SET search_path = public, extensions;

COMMIT;
