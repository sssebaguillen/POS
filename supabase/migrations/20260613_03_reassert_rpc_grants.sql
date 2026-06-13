-- ============================================================
-- Re-asentar REVOKE/GRANT de RPCs SECURITY DEFINER reemplazadas sin
-- REVOKE/GRANT explícito en migraciones de junio 2026 (regla 34 de CLAUDE.md).
-- ============================================================
-- No cambia comportamiento: CREATE OR REPLACE preservó estos grants; esto los
-- hace explícitos y resistentes a un futuro DROP+CREATE (que abriría PUBLIC
-- EXECUTE en silencio). Las firmas se copiaron de supabase/schema.sql (dump
-- autoritativo); la migración de origen va anotada por función.
--
-- EXCLUIDAS deliberadamente:
--  - Las 16 funciones de stats que 20260613_01 (plan 009) ya re-asienta
--    (incluida get_sales_by_payment_detail, que estaba en el plan 004 original).
--  - normalize_permissions es LANGUAGE sql IMMUTABLE (no DEFINER); se incluye
--    igual por higiene de least-privilege (la invocan guardas DEFINER inline).
--
-- AUDIENCIAS:
--  - Catálogo público (anon): create_catalog_order, get_catalog_products,
--    get_catalog_product_with_variants → REVOKE FROM PUBLIC (NO anon) + anon.
--    create_catalog_order entra por /api/catalog/orders con el cliente ANON
--    (verificado en route.ts: usa NEXT_PUBLIC_SUPABASE_ANON_KEY).
--  - Resto: authenticated. service_role se conserva donde ya estaba.

-- ----- create_sale_transaction (20260601_02) -----
REVOKE ALL ON FUNCTION public.create_sale_transaction("p_business_id" uuid, "p_subtotal" numeric, "p_discount" numeric, "p_total" numeric, "p_status" text, "p_price_list_id" uuid, "p_operator_id" uuid, "p_items" jsonb, "p_payments" jsonb, "p_customer_id" uuid, "p_session_id" uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale_transaction("p_business_id" uuid, "p_subtotal" numeric, "p_discount" numeric, "p_total" numeric, "p_status" text, "p_price_list_id" uuid, "p_operator_id" uuid, "p_items" jsonb, "p_payments" jsonb, "p_customer_id" uuid, "p_session_id" uuid) TO authenticated, service_role;

-- ----- settle_customer_credit (20260601_02/03) -----
REVOKE ALL ON FUNCTION public.settle_customer_credit("p_customer_id" uuid, "p_amount" numeric, "p_method" text, "p_operator_id" uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_customer_credit("p_customer_id" uuid, "p_amount" numeric, "p_method" text, "p_operator_id" uuid) TO authenticated, service_role;

-- ----- close_cash_session (20260601_03) -----
REVOKE ALL ON FUNCTION public.close_cash_session("p_session_id" uuid, "p_closing_amount" numeric, "p_notes" text, "p_operator_id" uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_session("p_session_id" uuid, "p_closing_amount" numeric, "p_notes" text, "p_operator_id" uuid) TO authenticated, service_role;

-- ----- get_session_summary (20260601_03) -----
REVOKE ALL ON FUNCTION public.get_session_summary("p_session_id" uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_summary("p_session_id" uuid) TO authenticated, service_role;

-- ----- delete_price_list (20260602_02) -----
REVOKE ALL ON FUNCTION public.delete_price_list("p_operator_id" uuid, "p_business_id" uuid, "p_price_list_id" uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_price_list("p_operator_id" uuid, "p_business_id" uuid, "p_price_list_id" uuid) TO authenticated, service_role;

-- ----- normalize_permissions (20260609_01) — helper puro (sql immutable) -----
REVOKE ALL ON FUNCTION public.normalize_permissions("p" jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_permissions("p" jsonb) TO authenticated, service_role;

-- ----- create_operator (20260609_03) -----
REVOKE ALL ON FUNCTION public.create_operator("p_actor_operator_id" uuid, "p_business_id" uuid, "p_name" text, "p_role" text, "p_pin" text, "p_permissions" jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operator("p_actor_operator_id" uuid, "p_business_id" uuid, "p_name" text, "p_role" text, "p_pin" text, "p_permissions" jsonb) TO authenticated, service_role;

-- ----- update_operator (20260609_03) -----
REVOKE ALL ON FUNCTION public.update_operator("p_actor_operator_id" uuid, "p_business_id" uuid, "p_target_operator_id" uuid, "p_name" text, "p_new_pin" text, "p_permissions" jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_operator("p_actor_operator_id" uuid, "p_business_id" uuid, "p_target_operator_id" uuid, "p_name" text, "p_new_pin" text, "p_permissions" jsonb) TO authenticated, service_role;

-- ----- update_catalog_order_status (20260610_01) -----
REVOKE ALL ON FUNCTION public.update_catalog_order_status("p_operator_id" uuid, "p_order_id" uuid, "p_new_status" text, "p_blacklist" boolean, "p_payment_method" text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_catalog_order_status("p_operator_id" uuid, "p_order_id" uuid, "p_new_status" text, "p_blacklist" boolean, "p_payment_method" text) TO authenticated, service_role;

-- ----- get_sale_detail (20260612_03) -----
REVOKE ALL ON FUNCTION public.get_sale_detail("p_sale_id" uuid, "p_business_id" uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_detail("p_sale_id" uuid, "p_business_id" uuid) TO authenticated, service_role;

-- ----- create_promotion (20260612_04) -----
REVOKE ALL ON FUNCTION public.create_promotion("p_operator_id" uuid, "p_business_id" uuid, "p_name" text, "p_kind" text, "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" uuid, "p_category_id" uuid, "p_brand_id" uuid, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_promotion("p_operator_id" uuid, "p_business_id" uuid, "p_name" text, "p_kind" text, "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" uuid, "p_category_id" uuid, "p_brand_id" uuid, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean) TO authenticated, service_role;

-- ----- update_promotion (20260612_04) -----
REVOKE ALL ON FUNCTION public.update_promotion("p_operator_id" uuid, "p_business_id" uuid, "p_promotion_id" uuid, "p_name" text, "p_kind" text, "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" uuid, "p_category_id" uuid, "p_brand_id" uuid, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean, "p_is_active" boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_promotion("p_operator_id" uuid, "p_business_id" uuid, "p_promotion_id" uuid, "p_name" text, "p_kind" text, "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" uuid, "p_category_id" uuid, "p_brand_id" uuid, "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean, "p_is_active" boolean) TO authenticated, service_role;

-- ====== Catálogo público: anon SÍ (REVOKE solo de PUBLIC, no de anon) ======

-- ----- create_catalog_order (20260610_01) — cliente anon vía /api/catalog/orders -----
REVOKE ALL ON FUNCTION public.create_catalog_order("p_slug" text, "p_customer_name" text, "p_phone" text, "p_delivery_type" text, "p_address" text, "p_notes" text, "p_items" jsonb, "p_client_ip" inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_catalog_order("p_slug" text, "p_customer_name" text, "p_phone" text, "p_delivery_type" text, "p_address" text, "p_notes" text, "p_items" jsonb, "p_client_ip" inet) TO anon, authenticated, service_role;

-- ----- get_catalog_products (20260612_05) -----
REVOKE ALL ON FUNCTION public.get_catalog_products("p_slug" text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_products("p_slug" text) TO anon, authenticated, service_role;

-- ----- get_catalog_product_with_variants (20260612_05) -----
REVOKE ALL ON FUNCTION public.get_catalog_product_with_variants("p_slug" text, "p_product_id" uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_product_with_variants("p_slug" text, "p_product_id" uuid) TO anon, authenticated, service_role;
