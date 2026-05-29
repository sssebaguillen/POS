-- 20260529_06_lockdown_anon_secdef_rpcs.sql
-- Hardening del advisor (frente pendiente seccion 5 del doc 08): revocar EXECUTE de PUBLIC/anon en
-- todas las RPC SECURITY DEFINER directamente invocables que NO son del catalogo publico.
--
-- Estas funciones ya eran seguras-por-guard (los mutadores comparan get_business_id() contra
-- p_business_id; los que derivan el negocio de la sesion devuelven NULL para anon), pero seguian
-- con EXECUTE a PUBLIC por el default de Supabase. Defensa en profundidad + limpieza del advisor.
--
-- Se MANTIENE anon a proposito en:
--   - Catalogo publico por slug: get_catalog_business/categories/products/product_with_variants/
--     variant_filters/default_variant_prices + create_catalog_order (reglas 29/33, re-precio server-side).
--   - bootstrap_new_user: el registro lo llama tras signUp y ANTES de iniciar sesion (el cliente puede
--     ser anon si la confirmacion de email esta activa). Revocar anon romperia el alta.
--   - get_business_id(): la evaluan las policies RLS como rol anon en tablas con lectura publica.
--   - Trigger fns (set_updated_at, update_stock_on_sale, rls_auto_enable): las dispara el motor de
--     triggers, no se invocan como RPC.
--   - verify_operator_pin: ya endurecida en 20260529_05.
--   - refresh_all_daily_snapshots / log_audit_event / upsert_daily_snapshot: ya bloqueadas en
--     20260529_02 (internas / cron via service_role).

REVOKE EXECUTE ON FUNCTION public.attach_feedback_links(p_id uuid, p_github_issue_url text, p_telegram_sent_at timestamp with time zone) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.attach_feedback_links(p_id uuid, p_github_issue_url text, p_telegram_sent_at timestamp with time zone) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.bulk_delete_products(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bulk_delete_products(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_set_product_status(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_is_active boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bulk_set_product_status(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_is_active boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_update_product_brand(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_brand_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bulk_update_product_brand(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_brand_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.bulk_update_product_category(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_category_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bulk_update_product_category(p_operator_id uuid, p_business_id uuid, p_product_ids uuid[], p_category_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.close_cash_session(p_session_id uuid, p_closing_amount numeric, p_notes text, p_operator_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_cash_session(p_session_id uuid, p_closing_amount numeric, p_notes text, p_operator_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_brand_guarded(p_operator_id uuid, p_business_id uuid, p_name text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_brand_guarded(p_operator_id uuid, p_business_id uuid, p_name text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_category_guarded(p_operator_id uuid, p_business_id uuid, p_name text, p_icon text, p_icon_color text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_category_guarded(p_operator_id uuid, p_business_id uuid, p_name text, p_icon text, p_icon_color text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_customer(p_operator_id uuid, p_business_id uuid, p_name text, p_phone text, p_email text, p_dni text, p_credit_limit numeric, p_is_credit_enabled boolean, p_notes text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_customer(p_operator_id uuid, p_business_id uuid, p_name text, p_phone text, p_email text, p_dni text, p_credit_limit numeric, p_is_credit_enabled boolean, p_notes text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_feedback(p_business_id uuid, p_operator_id uuid, p_type text, p_message text, p_contact_email text, p_route text, p_user_agent text, p_attachment_path text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_feedback(p_business_id uuid, p_operator_id uuid, p_type text, p_message text, p_contact_email text, p_route text, p_user_agent text, p_attachment_path text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_operator(p_actor_operator_id uuid, p_business_id uuid, p_name text, p_role text, p_pin text, p_permissions jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_operator(p_actor_operator_id uuid, p_business_id uuid, p_name text, p_role text, p_pin text, p_permissions jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_price_list(p_operator_id uuid, p_business_id uuid, p_name text, p_description text, p_multiplier numeric, p_is_default boolean, p_overrides jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_price_list(p_operator_id uuid, p_business_id uuid, p_name text, p_description text, p_multiplier numeric, p_is_default boolean, p_overrides jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_product(p_operator_id uuid, p_business_id uuid, p_data jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_product(p_operator_id uuid, p_business_id uuid, p_data jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_product_with_variants(p_operator_id uuid, p_business_id uuid, p_product jsonb, p_options jsonb, p_variants jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_product_with_variants(p_operator_id uuid, p_business_id uuid, p_product jsonb, p_options jsonb, p_variants jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_sale_transaction(p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric, p_status text, p_price_list_id uuid, p_operator_id uuid, p_items jsonb, p_payments jsonb, p_customer_id uuid, p_session_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_sale_transaction(p_business_id uuid, p_subtotal numeric, p_discount numeric, p_total numeric, p_status text, p_price_list_id uuid, p_operator_id uuid, p_items jsonb, p_payments jsonb, p_customer_id uuid, p_session_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_supplier(p_operator_id uuid, p_business_id uuid, p_name text, p_contact_name text, p_phone text, p_email text, p_address text, p_notes text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_supplier(p_operator_id uuid, p_business_id uuid, p_name text, p_contact_name text, p_phone text, p_email text, p_address text, p_notes text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.deactivate_supplier(p_operator_id uuid, p_business_id uuid, p_supplier_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.deactivate_supplier(p_operator_id uuid, p_business_id uuid, p_supplier_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_customer(p_customer_id uuid, p_operator_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_customer(p_customer_id uuid, p_operator_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_operator(p_operator_id uuid, p_business_id uuid, p_target_operator_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_operator(p_operator_id uuid, p_business_id uuid, p_target_operator_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_price_list(p_operator_id uuid, p_business_id uuid, p_price_list_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_price_list(p_operator_id uuid, p_business_id uuid, p_price_list_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_active_session() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_active_session() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_attribute_types() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_attribute_types() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_audit_log(p_business_id uuid, p_entity_type text, p_operator_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_audit_log(p_business_id uuid, p_entity_type text, p_operator_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_limit integer, p_offset integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_catalog_order(p_order_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_catalog_order(p_order_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_catalog_orders(p_status text[], p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_catalog_orders(p_status text[], p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_catalog_orders_unread_count() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_catalog_orders_unread_count() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_daily_snapshots(p_business_id uuid, p_from date, p_to date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_daily_snapshots(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_operator_sales_sparkline(p_business_id uuid, p_operator_id uuid, p_days integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_operator_sales_sparkline(p_business_id uuid, p_operator_id uuid, p_days integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_operator_stats(p_operator_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_operator_stats(p_operator_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_owner_stats(p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_owner_stats(p_date_from timestamp with time zone, p_date_to timestamp with time zone) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_period_comparison(p_business_id uuid, p_from date, p_to date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_period_comparison(p_business_id uuid, p_from date, p_to date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_plan_limits(p_business_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_plan_limits(p_business_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_product_with_variants(p_product_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_product_with_variants(p_product_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sales_heatmap(p_business_id uuid, p_from date, p_to date, p_operator_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_heatmap(p_business_id uuid, p_from date, p_to date, p_operator_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_session_summary(p_session_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_summary(p_session_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_sessions_list(p_limit integer, p_offset integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_sessions_list(p_limit integer, p_offset integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.mark_catalog_orders_read() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_catalog_orders_read() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.open_cash_session(p_opening_amount numeric, p_operator_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.open_cash_session(p_opening_amount numeric, p_operator_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reconcile_sales_count(p_business_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reconcile_sales_count(p_business_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.refresh_daily_snapshot(p_business_id uuid, p_snapshot_date date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refresh_daily_snapshot(p_business_id uuid, p_snapshot_date date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.settle_customer_credit(p_customer_id uuid, p_amount numeric, p_method text, p_operator_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.settle_customer_credit(p_customer_id uuid, p_amount numeric, p_method text, p_operator_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.swap_default_price_list(p_operator_id uuid, p_business_id uuid, p_price_list_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.swap_default_price_list(p_operator_id uuid, p_business_id uuid, p_price_list_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid, p_name text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_brand(p_operator_id uuid, p_business_id uuid, p_brand_id uuid, p_name text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_business_settings(p_operator_id uuid, p_business_id uuid, p_name text, p_description text, p_whatsapp text, p_logo_url text, p_settings_patch jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_business_settings(p_operator_id uuid, p_business_id uuid, p_name text, p_description text, p_whatsapp text, p_logo_url text, p_settings_patch jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_business_slug(p_operator_id uuid, p_business_id uuid, p_slug text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_business_slug(p_operator_id uuid, p_business_id uuid, p_slug text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_catalog_order_status(p_operator_id uuid, p_order_id uuid, p_new_status text, p_blacklist boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_catalog_order_status(p_operator_id uuid, p_order_id uuid, p_new_status text, p_blacklist boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid, p_name text, p_icon text, p_icon_color text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_category(p_operator_id uuid, p_business_id uuid, p_category_id uuid, p_name text, p_icon text, p_icon_color text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_customer(p_operator_id uuid, p_business_id uuid, p_customer_id uuid, p_name text, p_phone text, p_email text, p_dni text, p_credit_limit numeric, p_is_credit_enabled boolean, p_notes text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_customer(p_operator_id uuid, p_business_id uuid, p_customer_id uuid, p_name text, p_phone text, p_email text, p_dni text, p_credit_limit numeric, p_is_credit_enabled boolean, p_notes text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_operator(p_actor_operator_id uuid, p_business_id uuid, p_target_operator_id uuid, p_name text, p_new_pin text, p_permissions jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_operator(p_actor_operator_id uuid, p_business_id uuid, p_target_operator_id uuid, p_name text, p_new_pin text, p_permissions jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_price_list(p_operator_id uuid, p_business_id uuid, p_price_list_id uuid, p_name text, p_description text, p_multiplier numeric, p_overrides_upsert jsonb, p_overrides_delete_ids uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_price_list(p_operator_id uuid, p_business_id uuid, p_price_list_id uuid, p_name text, p_description text, p_multiplier numeric, p_overrides_upsert jsonb, p_overrides_delete_ids uuid[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid, p_changes jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid, p_changes jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_product_variants(p_operator_id uuid, p_business_id uuid, p_product_id uuid, p_options jsonb, p_variants jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_product_variants(p_operator_id uuid, p_business_id uuid, p_product_id uuid, p_options jsonb, p_variants jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_supplier(p_operator_id uuid, p_business_id uuid, p_supplier_id uuid, p_name text, p_contact_name text, p_phone text, p_email text, p_address text, p_notes text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_supplier(p_operator_id uuid, p_business_id uuid, p_supplier_id uuid, p_name text, p_contact_name text, p_phone text, p_email text, p_address text, p_notes text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_session_digital_balance(p_session_id uuid, p_method text, p_opening_balance numeric, p_closing_balance numeric, p_operator_id uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.upsert_session_digital_balance(p_session_id uuid, p_method text, p_opening_balance numeric, p_closing_balance numeric, p_operator_id uuid) TO authenticated;
