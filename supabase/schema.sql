


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgtap" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."expense_attachment_type" AS ENUM (
    'image',
    'pdf',
    'spreadsheet',
    'other'
);


ALTER TYPE "public"."expense_attachment_type" OWNER TO "postgres";


CREATE TYPE "public"."expense_category" AS ENUM (
    'mercaderia',
    'alquiler',
    'servicios',
    'seguros',
    'proveedores',
    'sueldos',
    'otro'
);


ALTER TYPE "public"."expense_category" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_unit_promo"("p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_unit_price" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
-- Precio unitario con promo unitaria aplicada. Espejo TS: applyUnitPromo (src/lib/promotions.ts).
-- percent → precio × (1 − pct/100); offer_price → LEAST(oferta, precio): una oferta nunca
-- SUBE el precio. quantity (u otro) → el unitario no se toca.
  SELECT CASE
    WHEN p_kind = 'percent' AND p_percent IS NOT NULL AND p_percent > 0
      THEN ROUND(p_unit_price * (1 - p_percent / 100.0), 2)
    WHEN p_kind = 'offer_price' AND p_offer_price IS NOT NULL AND p_offer_price > 0
      THEN LEAST(ROUND(p_offer_price, 2), ROUND(p_unit_price, 2))
    ELSE ROUND(p_unit_price, 2)
  END;
$$;


ALTER FUNCTION "public"."apply_unit_promo"("p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_unit_price" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_old                public.promotions%ROWTYPE;
  v_row                public.promotions%ROWTYPE;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT * INTO v_old FROM promotions
  WHERE id = p_promotion_id AND business_id = v_caller_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promoción no encontrada');
  END IF;
  IF v_old.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'La promoción ya está archivada');
  END IF;

  UPDATE promotions SET
    is_active   = false,
    archived_at = now(),
    updated_at  = now()
  WHERE id = p_promotion_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'promotion_archived', 'promotion', v_row.id, v_row.name, to_jsonb(v_old), to_jsonb(v_row));

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."archive_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_tenant"("p_business_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  IF public.get_business_id() IS NULL
     OR p_business_id IS DISTINCT FROM public.get_business_id() THEN
    RAISE EXCEPTION 'Contexto de negocio invalido' USING ERRCODE = '42501';
  END IF;
END;
$$;


ALTER FUNCTION "public"."assert_tenant"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attach_feedback_links"("p_id" "uuid", "p_github_issue_url" "text", "p_telegram_sent_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_row                public.feedback%ROWTYPE;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  UPDATE public.feedback
  SET
    github_issue_url = COALESCE(p_github_issue_url, github_issue_url),
    telegram_sent_at = COALESCE(p_telegram_sent_at, telegram_sent_at)
  WHERE id = p_id
    AND business_id = v_caller_business_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Feedback no encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'data', to_jsonb(v_row));
END;
$$;


ALTER FUNCTION "public"."attach_feedback_links"("p_id" "uuid", "p_github_issue_url" "text", "p_telegram_sent_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_new_user"("p_user_id" "uuid", "p_business_name" "text", "p_user_name" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_slug        text;
BEGIN
  v_slug := lower(regexp_replace(p_business_name, '\s+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
  v_slug := v_slug || '-' || extract(epoch from now())::bigint;

  INSERT INTO public.businesses (name, slug)
  VALUES (p_business_name, v_slug)
  RETURNING id INTO v_business_id;

  INSERT INTO public.profiles (id, business_id, role, name)
  VALUES (p_user_id, v_business_id, 'owner', p_user_name);

  INSERT INTO public.subscriptions (business_id, plan, status)
  VALUES (v_business_id, 'free', 'active');

  RETURN json_build_object('business_id', v_business_id, 'success', true);
EXCEPTION WHEN others THEN
  RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;


ALTER FUNCTION "public"."bootstrap_new_user"("p_user_id" "uuid", "p_business_name" "text", "p_user_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_delete_products"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_deleted int := 0; v_discontinued int := 0; v_pid uuid; v_has_sales boolean;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  FOREACH v_pid IN ARRAY p_product_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM products WHERE id = v_pid AND business_id = p_business_id) THEN CONTINUE; END IF;
    SELECT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.product_id = v_pid AND s.business_id = p_business_id AND s.status = 'completed') INTO v_has_sales;
    IF v_has_sales THEN
      UPDATE products SET is_active = false WHERE id = v_pid AND business_id = p_business_id;
      v_discontinued := v_discontinued + 1;
    ELSE
      DELETE FROM price_list_overrides WHERE product_id = v_pid;
      DELETE FROM inventory_movements  WHERE product_id = v_pid;
      DELETE FROM products WHERE id = v_pid AND business_id = p_business_id;
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_deleted', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(p_product_ids), 'count', v_deleted + v_discontinued), NULL);
  RETURN jsonb_build_object('success', true, 'deleted', v_deleted, 'discontinued', v_discontinued);
END;
$$;


ALTER FUNCTION "public"."bulk_delete_products"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_set_product_status"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_is_active" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  WITH updated AS (
    UPDATE products SET is_active = p_is_active
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
      AND is_active IS DISTINCT FROM p_is_active
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_status', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('is_active', p_is_active));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;


ALTER FUNCTION "public"."bulk_set_product_status"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_set_product_catalog"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_show_in_catalog" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  WITH updated AS (
    UPDATE products SET show_in_catalog = p_show_in_catalog
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
      AND show_in_catalog IS DISTINCT FROM p_show_in_catalog
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_catalog', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('show_in_catalog', p_show_in_catalog));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;


ALTER FUNCTION "public"."bulk_set_product_catalog"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_show_in_catalog" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_update_product_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_brand_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = p_business_id
  ) THEN RAISE EXCEPTION 'brand_not_found'; END IF;
  WITH updated AS (
    UPDATE products SET brand_id = p_brand_id
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_brand', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('brand_id', p_brand_id));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;


ALTER FUNCTION "public"."bulk_update_product_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_update_product_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_category_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_count int; v_products jsonb; v_ids uuid[];
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = p_business_id
  ) THEN RAISE EXCEPTION 'category_not_found'; END IF;
  WITH updated AS (
    UPDATE products SET category_id = p_category_id
    WHERE id = ANY(p_product_ids) AND business_id = p_business_id
    RETURNING id, name
  )
  SELECT count(*)::int,
         COALESCE(array_agg(id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name)), '[]'::jsonb)
  INTO v_count, v_ids, v_products FROM updated;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_bulk_category', 'product', p_business_id, NULL,
    jsonb_build_object('product_ids', to_jsonb(v_ids), 'count', v_count, 'products', v_products),
    jsonb_build_object('category_id', p_category_id));
  RETURN jsonb_build_object('success', true, 'updated', v_count);
END;
$$;


ALTER FUNCTION "public"."bulk_update_product_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_closing_amount" numeric, "p_notes" "text", "p_operator_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id      uuid;
  v_cash_sales       numeric;
  v_cash_settlements numeric;
  v_expected         numeric;
  v_difference       numeric;
  v_row              cash_sessions;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT * INTO v_row
  FROM cash_sessions
  WHERE id = p_session_id AND business_id = v_business_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sesión no encontrada o ya cerrada');
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_cash_sales
  FROM payments p
  JOIN sales s ON s.id = p.sale_id
  WHERE s.session_id = p_session_id
    AND s.business_id = v_business_id
    AND p.method = 'cash';

  SELECT COALESCE(SUM(m.amount), 0) INTO v_cash_settlements
  FROM customer_account_movements m
  WHERE m.session_id = p_session_id
    AND m.business_id = v_business_id
    AND m.type = 'payment'
    AND m.method = 'cash';

  v_expected   := v_row.opening_amount + v_cash_sales + v_cash_settlements;
  v_difference := p_closing_amount - v_expected;

  UPDATE cash_sessions SET
    status          = 'closed',
    closing_amount  = p_closing_amount,
    expected_amount = v_expected,
    closed_at       = now(),
    closed_by       = p_operator_id,
    notes           = p_notes
  WHERE id = p_session_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(
    v_business_id,
    p_operator_id,
    CASE WHEN p_operator_id IS NULL THEN 'owner' ELSE 'operator' END,
    'cash_session_closed',
    'cash_session',
    p_session_id,
    NULL,
    jsonb_build_object(
      'closing_amount',  p_closing_amount,
      'expected_amount', v_expected,
      'difference',      v_difference,
      'notes',           p_notes
    )
  );

  RETURN jsonb_build_object(
    'success',           true,
    'session',           row_to_json(v_row),
    'cash_sales',        v_cash_sales,
    'cash_settlements',  v_cash_settlements,
    'expected_amount',   v_expected,
    'difference',        v_difference
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_closing_amount" numeric, "p_notes" "text", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_effective_price"("p_cost" numeric, "p_price" numeric, "p_variant_price" numeric, "p_list_id" "uuid", "p_list_multiplier" numeric, "p_product_id" "uuid", "p_brand_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
-- NOTA redondeo por lista: el redondeo configurable es una propiedad de la LISTA
-- (price_lists.rounding_step / rounding_up). Esta función es el espejo SQL de
-- calculateProductPrice (src/lib/price-lists.ts) y replica applyRounding en la rama de
-- lista. Hoy es inerte: todos los callers SQL pasan p_list_id = NULL (catálogo y
-- create_catalog_order = precio base), así que la rama de lista no corre. Queda listo
-- para cuando un caller pase una lista activa (ej. mostrar una lista en el catálogo),
-- evitando divergencia POS↔catálogo. Mig. 20260606_01.
DECLARE
  v_mult numeric;
  v_raw  numeric;
  v_step numeric;
  v_up   boolean;
BEGIN
  IF p_list_id IS NULL THEN
    IF p_variant_price IS NOT NULL AND p_variant_price > 0 THEN
      RETURN ROUND(p_variant_price, 2);
    END IF;
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  IF COALESCE(p_cost, 0) <= 0 THEN
    IF p_variant_price IS NOT NULL AND p_variant_price > 0 THEN
      RETURN ROUND(p_variant_price, 2);
    END IF;
    RETURN ROUND(COALESCE(p_price, 0), 2);
  END IF;

  SELECT plo.multiplier INTO v_mult
  FROM public.price_list_overrides plo
  WHERE plo.price_list_id = p_list_id
    AND plo.product_id = p_product_id
  LIMIT 1;

  IF v_mult IS NULL AND p_brand_id IS NOT NULL THEN
    SELECT plo.multiplier INTO v_mult
    FROM public.price_list_overrides plo
    WHERE plo.price_list_id = p_list_id
      AND plo.product_id IS NULL
      AND plo.brand_id = p_brand_id
    LIMIT 1;
  END IF;

  v_mult := COALESCE(v_mult, p_list_multiplier);
  v_raw  := p_cost * v_mult;

  SELECT pl.rounding_step, pl.rounding_up INTO v_step, v_up
  FROM public.price_lists pl
  WHERE pl.id = p_list_id;

  IF v_step IS NULL OR v_step <= 0 THEN
    RETURN ROUND(v_raw, 2);
  END IF;

  IF COALESCE(v_up, false) THEN
    RETURN ROUND(CEIL(v_raw / v_step) * v_step, 2);
  ELSE
    RETURN ROUND(ROUND(v_raw / v_step) * v_step, 2);
  END IF;
END;
$$;


ALTER FUNCTION "public"."compute_effective_price"("p_cost" numeric, "p_price" numeric, "p_variant_price" numeric, "p_list_id" "uuid", "p_list_multiplier" numeric, "p_product_id" "uuid", "p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_quantity_promo_discount"("p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_unit_price" numeric, "p_quantity" integer) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
-- Descuento de línea de una promo de cantidad: floor(qty / N) × K × unit_price × (1 − P/100).
-- 2x1 = (2,1,0) · 3x2 = (3,1,0) · 2da unidad al 50% = (2,1,50).
-- Espejo TS: computeQuantityDiscount (src/lib/promotions.ts).
  SELECT CASE
    WHEN p_group_size IS NULL OR p_group_size < 2
      OR p_affected_units IS NULL OR p_affected_units < 1
      OR COALESCE(p_quantity, 0) < p_group_size
      OR COALESCE(p_unit_price, 0) <= 0
      THEN 0::numeric
    ELSE GREATEST(
      ROUND(
        FLOOR(p_quantity::numeric / p_group_size) * p_affected_units
          * p_unit_price * (1 - COALESCE(p_pay_percent, 0) / 100.0),
        2
      ),
      0
    )
  END;
$$;


ALTER FUNCTION "public"."compute_quantity_promo_discount"("p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_unit_price" numeric, "p_quantity" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_brand_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid; v_new_id uuid;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  INSERT INTO brands (business_id, name)
  VALUES (v_caller_business_id, btrim(p_name)) RETURNING id INTO v_new_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'brand_created', 'brand', v_new_id, btrim(p_name), NULL,
    jsonb_build_object('name', btrim(p_name)));
  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;


ALTER FUNCTION "public"."create_brand_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_catalog_order"("p_slug" "text", "p_customer_name" "text", "p_phone" "text", "p_delivery_type" "text", "p_address" "text", "p_notes" "text", "p_items" "jsonb", "p_client_ip" "inet" DEFAULT NULL::"inet") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid; v_list_id uuid; v_list_mult numeric;
  v_normalized_phone text; v_order_number int; v_order_id uuid;
  v_subtotal numeric := 0; v_total numeric := 0;
  v_item jsonb; v_product record;
  v_variant_id uuid; v_variant_price numeric; v_variant_cost numeric;
  v_variant_image text; v_variant_active boolean;
  v_unit_price numeric; v_quantity int; v_line_total numeric;
  v_product_name text; v_variant_label text; v_image_url text;
  v_pending_count int;
  v_new_data jsonb;
  v_promo public.promotions;
  v_base_unit numeric;
  v_promo_id uuid;
  v_promo_discount numeric;
BEGIN
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_slug'); END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_name'); END IF;
  v_normalized_phone := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  IF length(v_normalized_phone) < 8 OR length(v_normalized_phone) > 20 THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_phone'); END IF;
  IF p_delivery_type NOT IN ('takeaway','delivery') THEN RETURN jsonb_build_object('success', false, 'error', 'invalid_delivery_type'); END IF;
  IF p_delivery_type = 'delivery' AND (p_address IS NULL OR btrim(p_address) = '') THEN RETURN jsonb_build_object('success', false, 'error', 'address_required'); END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RETURN jsonb_build_object('success', false, 'error', 'empty_cart'); END IF;
  IF jsonb_array_length(p_items) > 50 THEN RETURN jsonb_build_object('success', false, 'error', 'too_many_items'); END IF;

  SELECT b.id INTO v_business_id FROM businesses b WHERE b.slug = btrim(p_slug);
  IF v_business_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'business_not_found'); END IF;

  IF EXISTS (SELECT 1 FROM catalog_phone_blacklist WHERE business_id = v_business_id AND phone = v_normalized_phone) THEN
    RETURN jsonb_build_object('success', false, 'error', 'blacklisted');
  END IF;

  SELECT count(*) INTO v_pending_count FROM catalog_orders
   WHERE business_id = v_business_id AND customer_phone = v_normalized_phone
     AND status = 'recibido' AND created_at > now() - interval '1 hour';
  IF v_pending_count >= 3 THEN RETURN jsonb_build_object('success', false, 'error', 'too_many_pending'); END IF;

  v_list_id := NULL;
  v_list_mult := NULL;

  INSERT INTO catalog_order_counters (business_id, last_number) VALUES (v_business_id, 1)
   ON CONFLICT (business_id) DO UPDATE SET last_number = catalog_order_counters.last_number + 1
   RETURNING last_number INTO v_order_number;

  INSERT INTO catalog_orders (
    business_id, order_number, customer_name, customer_phone,
    delivery_type, address, notes, subtotal, total, client_ip
  ) VALUES (
    v_business_id, v_order_number, left(btrim(p_customer_name), 120), v_normalized_phone,
    p_delivery_type, NULLIF(left(btrim(p_address), 300), ''), NULLIF(left(btrim(p_notes), 1000), ''),
    0, 0, p_client_ip
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity := LEAST(GREATEST(FLOOR(COALESCE((v_item->>'quantity')::numeric, 0)), 0), 1000)::int;
    IF v_quantity <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_product FROM products
     WHERE id = NULLIF(v_item->>'product_id','')::uuid AND business_id = v_business_id
       AND is_active = true AND show_in_catalog = true;
    IF v_product.id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'product_not_available'); END IF;

    v_variant_id    := NULL;
    v_variant_label := NULL;
    v_image_url     := v_product.image_url;

    IF v_item ? 'variant_id' AND NULLIF(v_item->>'variant_id','') IS NOT NULL THEN
      SELECT id, price, cost, image_url, is_active
        INTO v_variant_id, v_variant_price, v_variant_cost, v_variant_image, v_variant_active
        FROM product_variants
       WHERE id = (v_item->>'variant_id')::uuid AND product_id = v_product.id
         AND business_id = v_business_id AND is_active = true;
      IF v_variant_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'variant_not_available'); END IF;
      IF v_variant_image IS NOT NULL THEN v_image_url := v_variant_image; END IF;

      SELECT string_agg(pov.value, ' / ' ORDER BY po.position) INTO v_variant_label
       FROM product_variant_option_values pvov
       JOIN product_option_values pov ON pov.id = pvov.option_value_id
       JOIN product_options po ON po.id = pov.option_id
      WHERE pvov.variant_id = v_variant_id;

      v_unit_price := compute_effective_price(
        v_variant_cost, v_variant_price, v_variant_price,
        v_list_id, v_list_mult, v_product.id, v_product.brand_id);
    ELSE
      v_unit_price := compute_effective_price(
        v_product.cost::numeric, v_product.price::numeric, NULL,
        v_list_id, v_list_mult, v_product.id, v_product.brand_id);
    END IF;

    -- Promo: el precio del catálogo es promesa — el checkout DEBE re-preciar igual.
    -- Unitaria baja el unitario; cantidad descuenta a nivel línea (2x1, 3x2, 2da al X%).
    v_promo_id := NULL;
    v_promo_discount := 0;
    v_promo := find_applicable_promotion(v_business_id, v_product.id, v_product.category_id, v_product.brand_id);
    IF v_promo.id IS NOT NULL THEN
      IF v_promo.kind = 'quantity' THEN
        v_promo_discount := compute_quantity_promo_discount(
          v_promo.group_size, v_promo.affected_units, v_promo.pay_percent, v_unit_price, v_quantity);
        IF v_promo_discount > 0 THEN v_promo_id := v_promo.id; END IF;
      ELSE
        v_base_unit := v_unit_price;
        v_unit_price := apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, v_unit_price);
        IF v_unit_price < v_base_unit THEN
          v_promo_id := v_promo.id;
          v_promo_discount := ROUND((v_base_unit - v_unit_price) * v_quantity, 2);
        END IF;
      END IF;
    END IF;

    v_product_name := v_product.name;
    v_line_total := ROUND(v_unit_price * v_quantity, 2)
      - CASE WHEN v_promo_id IS NOT NULL AND v_promo.kind = 'quantity' THEN v_promo_discount ELSE 0 END;
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO catalog_order_items (
      order_id, product_id, product_name, variant_id, variant_label,
      quantity, unit_price, line_total, image_url,
      promotion_id, promo_discount
    ) VALUES (
      v_order_id, v_product.id, v_product_name,
      v_variant_id, v_variant_label,
      v_quantity, v_unit_price, v_line_total, v_image_url,
      v_promo_id, v_promo_discount
    );
  END LOOP;

  IF v_subtotal <= 0 THEN
    DELETE FROM catalog_orders WHERE id = v_order_id;
    RETURN jsonb_build_object('success', false, 'error', 'empty_cart');
  END IF;
  v_total := v_subtotal;

  UPDATE catalog_orders SET subtotal = v_subtotal, total = v_total WHERE id = v_order_id;

  SELECT to_jsonb(o.*) INTO v_new_data FROM catalog_orders o WHERE o.id = v_order_id;

  PERFORM log_audit_event(
    v_business_id,
    NULL,
    'customer',
    'catalog_order_creado',
    'catalog_order',
    v_order_id,
    'Pedido #' || v_order_number,
    NULL,
    v_new_data
  );

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'order_number', v_order_number, 'total', v_total);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'create_catalog_order failed: %', SQLERRM;
  RETURN jsonb_build_object('success', false, 'error', 'unexpected_error');
END; $$;


ALTER FUNCTION "public"."create_catalog_order"("p_slug" "text", "p_customer_name" "text", "p_phone" "text", "p_delivery_type" "text", "p_address" "text", "p_notes" "text", "p_items" "jsonb", "p_client_ip" "inet") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_category_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_new_id uuid; v_icon_color text;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  INSERT INTO categories (business_id, name, icon, icon_color)
  VALUES (v_caller_business_id, btrim(p_name), btrim(p_icon), p_icon_color)
  RETURNING id, icon_color INTO v_new_id, v_icon_color;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'category_created', 'category', v_new_id, btrim(p_name), NULL,
    jsonb_build_object('name', btrim(p_name), 'icon', btrim(p_icon), 'icon_color', v_icon_color));
  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;


ALTER FUNCTION "public"."create_category_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_phone" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_dni" "text" DEFAULT NULL::"text", "p_credit_limit" numeric DEFAULT 0, "p_is_credit_enabled" boolean DEFAULT false, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_actor_role         text;
  v_customer_id        uuid;
  v_customer           jsonb;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  INSERT INTO customers (
    business_id, name, phone, email, dni,
    credit_limit, is_credit_enabled, notes
  ) VALUES (
    v_caller_business_id,
    btrim(p_name),
    NULLIF(btrim(p_phone), ''),
    NULLIF(btrim(p_email), ''),
    NULLIF(btrim(p_dni), ''),
    COALESCE(p_credit_limit, 0),
    COALESCE(p_is_credit_enabled, false),
    NULLIF(btrim(p_notes), '')
  )
  RETURNING id, to_jsonb(customers.*) INTO v_customer_id, v_customer;

  PERFORM log_audit_event(
    v_caller_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_created', 'customer', v_customer_id, btrim(p_name),
    NULL, v_customer
  );

  RETURN jsonb_build_object('success', true, 'customer', v_customer);
END;
$$;


ALTER FUNCTION "public"."create_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_expense"("p_business_id" "uuid", "p_category" "text", "p_amount" numeric, "p_description" "text", "p_date" "date" DEFAULT CURRENT_DATE, "p_supplier_id" "uuid" DEFAULT NULL::"uuid", "p_operator_id" "uuid" DEFAULT NULL::"uuid", "p_attachment_url" "text" DEFAULT NULL::"text", "p_attachment_type" "text" DEFAULT NULL::"text", "p_attachment_name" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_expense_id     uuid;
  v_actor_role     text;
  v_stored_op_id   uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  -- expenses.operator_id FKs to operators(id). Owners aren't in that table,
  -- so store NULL for the owner path.
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  INSERT INTO public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id,
    attachment_url, attachment_type, attachment_name,
    notes
  ) VALUES (
    p_business_id, p_category::public.expense_category, p_amount, p_description, p_date,
    p_supplier_id, v_stored_op_id,
    p_attachment_url, p_attachment_type::public.expense_attachment_type, p_attachment_name,
    p_notes
  )
  RETURNING id INTO v_expense_id;

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'expense_created', 'expense', v_expense_id, p_description,
    NULL,
    jsonb_build_object(
      'category',    p_category,
      'amount',      p_amount,
      'description', p_description,
      'date',        p_date,
      'supplier_id', p_supplier_id
    )
  );

  RETURN jsonb_build_object('success', true, 'id', v_expense_id);
END;
$$;


ALTER FUNCTION "public"."create_expense"("p_business_id" "uuid", "p_category" "text", "p_amount" numeric, "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_feedback"("p_business_id" "uuid", "p_operator_id" "uuid", "p_type" "text", "p_message" "text", "p_contact_email" "text" DEFAULT NULL::"text", "p_route" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text", "p_attachment_path" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_row                public.feedback%ROWTYPE;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('bug','sugerencia','otro') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tipo de feedback inválido');
  END IF;

  IF p_message IS NULL OR char_length(p_message) < 10 OR char_length(p_message) > 1000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El mensaje debe tener entre 10 y 1000 caracteres');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.operators
      WHERE id = p_operator_id
        AND business_id = v_caller_business_id
        AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Operador inválido');
    END IF;
  END IF;

  IF p_attachment_path IS NOT NULL
     AND p_attachment_path NOT LIKE (v_caller_business_id::text || '/%') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ruta de adjunto inválida');
  END IF;

  INSERT INTO public.feedback (
    business_id, operator_id, type, message, contact_email,
    route, user_agent, attachment_path
  ) VALUES (
    v_caller_business_id, p_operator_id, p_type, p_message, NULLIF(btrim(p_contact_email), ''),
    NULLIF(btrim(p_route), ''), NULLIF(btrim(p_user_agent), ''), p_attachment_path
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'success', true,
    'data', to_jsonb(v_row)
  );
END;
$$;


ALTER FUNCTION "public"."create_feedback"("p_business_id" "uuid", "p_operator_id" "uuid", "p_type" "text", "p_message" "text", "p_contact_email" "text", "p_route" "text", "p_user_agent" "text", "p_attachment_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_mercaderia_expense"("p_business_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_update_stock" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_expense_id   uuid;
  v_total        numeric := 0;
  v_item         jsonb;
  v_product_id   uuid;
  v_variant_id   uuid;
  v_qty          integer;
  v_cost         numeric;
  v_name         text;
  v_update       boolean;
  v_actor_role   text;
  v_stored_op_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_items');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT sum((item->>'unit_cost')::numeric * (item->>'quantity')::integer)
  INTO v_total
  FROM jsonb_array_elements(p_items) AS item;

  INSERT INTO public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id, notes
  ) VALUES (
    p_business_id, 'mercaderia', v_total, p_description, p_date,
    p_supplier_id, v_stored_op_id, p_notes
  )
  RETURNING id INTO v_expense_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_qty        := (v_item->>'quantity')::integer;
    v_cost       := (v_item->>'unit_cost')::numeric;
    v_name       := v_item->>'product_name';
    v_update     := COALESCE((v_item->>'update_cost')::boolean, false);

    INSERT INTO public.expense_items (
      business_id, expense_id, product_id, variant_id, product_name,
      quantity, unit_cost, update_cost
    ) VALUES (
      p_business_id, v_expense_id, v_product_id, v_variant_id, v_name,
      v_qty, v_cost, v_update
    );

    IF p_update_stock AND v_product_id IS NOT NULL THEN
      IF v_variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = stock + v_qty
        WHERE id = v_variant_id AND business_id = p_business_id;

        IF v_update THEN
          UPDATE public.product_variants
          SET cost = v_cost
          WHERE id = v_variant_id AND business_id = p_business_id;
        END IF;
      ELSE
        UPDATE public.products
        SET stock = stock + v_qty
        WHERE id = v_product_id AND business_id = p_business_id;

        IF v_update THEN
          UPDATE public.products
          SET cost = v_cost
          WHERE id = v_product_id AND business_id = p_business_id;
        END IF;
      END IF;

      INSERT INTO public.inventory_movements (
        business_id, product_id, variant_id, type, quantity,
        reason, reference_id, created_by_operator
      ) VALUES (
        p_business_id, v_product_id, v_variant_id, 'purchase', v_qty,
        'Compra de mercadería — gasto #' || v_expense_id::text,
        v_expense_id,
        v_stored_op_id
      );
    END IF;
  END LOOP;

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'expense_created', 'expense', v_expense_id, p_description,
    NULL,
    jsonb_build_object(
      'category',    'mercaderia',
      'amount',      v_total,
      'description', p_description,
      'date',        p_date,
      'supplier_id', p_supplier_id,
      'item_count',  jsonb_array_length(p_items),
      'items',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id',   ei.product_id,
          'product_name', ei.product_name,
          'variant_id',   ei.variant_id,
          'variant_label', CASE WHEN ei.variant_id IS NOT NULL THEN (
            SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
            FROM public.product_variant_option_values pvov
            JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
            JOIN public.product_options po        ON po.id  = pov.option_id
            WHERE pvov.variant_id = ei.variant_id
          ) END,
          'quantity',     ei.quantity,
          'unit_cost',    ei.unit_cost,
          'update_cost',  ei.update_cost
        ) ORDER BY ei.id)
        FROM public.expense_items ei WHERE ei.expense_id = v_expense_id
      ), '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object('success', true, 'id', v_expense_id, 'total', v_total);
END;
$$;


ALTER FUNCTION "public"."create_mercaderia_expense"("p_business_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_update_stock" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_permissions"("p" "jsonb") RETURNS "jsonb"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'online_orders',    COALESCE((p->>'online_orders')::boolean, false),
    'pos_pricing',      COALESCE((p->>'pos_pricing')::boolean, false),
    'inventory_read',   COALESCE((p->>'inventory_read')::boolean, false),
    'inventory_write',  COALESCE((p->>'inventory_write')::boolean, false),
    'reports',          COALESCE((p->>'reports')::boolean, false),
    'expenses',         COALESCE((p->>'expenses')::boolean, false),
    'settings',         COALESCE((p->>'settings')::boolean, false),
    'manage_operators', COALESCE((p->>'manage_operators')::boolean, false)
  );
$$;


ALTER FUNCTION "public"."normalize_permissions"("p" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_role" "text", "p_pin" "text", "p_permissions" "jsonb" DEFAULT NULL::"jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id  uuid;
  v_perm                text;
  v_actor_role          text;
  v_default_permissions jsonb;
  v_final_permissions   jsonb;
  v_operator_id         uuid;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_actor_operator_id IS NOT NULL THEN
    SELECT normalize_permissions(permissions)->>'manage_operators', role INTO v_perm, v_actor_role
    FROM operators
    WHERE id = p_actor_operator_id AND business_id = v_caller_business_id AND is_active = true;

    IF FOUND THEN
      IF v_perm <> 'true' THEN
        RETURN json_build_object('success', false, 'error', '403: Permisos de gestión de operadores insuficientes');
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_actor_operator_id AND business_id = v_caller_business_id) THEN
        RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
      END IF;
      v_actor_role := 'owner';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND business_id = v_caller_business_id) THEN
      RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_default_permissions := CASE p_role
    WHEN 'manager' THEN
      '{"online_orders": true, "pos_pricing": true, "inventory_read": true, "inventory_write": true, "reports": true, "expenses": true, "settings": false, "manage_operators": false}'::jsonb
    WHEN 'cashier' THEN
      '{"online_orders": true, "pos_pricing": false, "inventory_read": true, "inventory_write": false, "reports": false, "expenses": false, "settings": false, "manage_operators": false}'::jsonb
    ELSE
      '{"online_orders": true, "pos_pricing": false, "inventory_read": false, "inventory_write": false, "reports": false, "expenses": false, "settings": false, "manage_operators": false}'::jsonb
  END;

  v_final_permissions := normalize_permissions(COALESCE(p_permissions, v_default_permissions));

  INSERT INTO operators (business_id, name, role, pin, permissions)
  VALUES (
    p_business_id,
    p_name,
    p_role,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    v_final_permissions
  )
  RETURNING id INTO v_operator_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_actor_operator_id END,
    v_actor_role,
    'operator_created', 'operator', v_operator_id, p_name,
    NULL,
    jsonb_build_object(
      'name',        p_name,
      'role',        p_role,
      'permissions', v_final_permissions
    )
  );

  RETURN json_build_object('success', true, 'operator_id', v_operator_id);
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;


ALTER FUNCTION "public"."create_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_role" "text", "p_pin" "text", "p_permissions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides" "jsonb" DEFAULT NULL::"jsonb", "p_round_step" numeric DEFAULT NULL::numeric, "p_round_up" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_list_id            uuid;
  v_list               jsonb;
  v_overrides          jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  IF p_multiplier IS NULL OR p_multiplier <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El margen debe ser mayor a 0');
  END IF;

  IF p_round_step IS NOT NULL AND p_round_step <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El redondeo debe ser mayor a 0');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de listas de precios insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  INSERT INTO price_lists (business_id, name, description, multiplier, rounding_step, rounding_up)
  VALUES (
    v_caller_business_id,
    btrim(p_name),
    NULLIF(btrim(p_description), ''),
    p_multiplier,
    p_round_step,
    COALESCE(p_round_up, false)
  )
  RETURNING id, to_jsonb(price_lists.*) INTO v_list_id, v_list;

  IF p_overrides IS NOT NULL AND jsonb_typeof(p_overrides) = 'array' AND jsonb_array_length(p_overrides) > 0 THEN
    WITH inserted AS (
      INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
      SELECT
        v_list_id,
        (item->>'product_id')::uuid,
        NULL,
        (item->>'multiplier')::numeric
      FROM jsonb_array_elements(p_overrides) AS item
      WHERE item->>'product_id' IS NOT NULL
        AND item->>'multiplier' IS NOT NULL
      RETURNING id, price_list_id, product_id, brand_id, multiplier
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(inserted.*)), '[]'::jsonb) INTO v_overrides
    FROM inserted;
  ELSE
    v_overrides := '[]'::jsonb;
  END IF;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_created', 'price_list', v_list_id, btrim(p_name),
    NULL,
    jsonb_build_object(
      'list', v_list,
      'overrides_count', COALESCE(jsonb_array_length(v_overrides), 0)
    )
  );

  RETURN jsonb_build_object('success', true, 'list', v_list, 'overrides', v_overrides);
END;
$$;


ALTER FUNCTION "public"."create_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides" "jsonb", "p_round_step" numeric, "p_round_up" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_new_id             uuid;
  v_name               text;
  v_overrides          jsonb;
  v_audit_data         jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Datos inválidos');
  END IF;
  v_name := btrim(p_data->>'name');
  IF v_name IS NULL OR v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  INSERT INTO products (
    business_id, name, sku, brand_id, barcode, category_id,
    price, cost, stock, min_stock, is_active, image_url, image_source
  ) VALUES (
    v_caller_business_id, v_name,
    NULLIF(p_data->>'sku', ''),
    NULLIF(p_data->>'brand_id', '')::uuid,
    NULLIF(p_data->>'barcode', ''),
    NULLIF(p_data->>'category_id', '')::uuid,
    COALESCE((p_data->>'price')::numeric, 0),
    COALESCE((p_data->>'cost')::numeric, 0),
    COALESCE((p_data->>'stock')::int, 0),
    COALESCE((p_data->>'min_stock')::int, 0),
    COALESCE((p_data->>'is_active')::boolean, true),
    NULLIF(p_data->>'image_url', ''),
    NULLIF(p_data->>'image_source', '')
  ) RETURNING id INTO v_new_id;
  v_overrides := p_data->'price_list_overrides';
  IF v_overrides IS NOT NULL AND jsonb_typeof(v_overrides) = 'array' AND jsonb_array_length(v_overrides) > 0 THEN
    INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
    SELECT (item->>'price_list_id')::uuid, v_new_id, NULL, (item->>'multiplier')::numeric
    FROM jsonb_array_elements(v_overrides) AS item
    WHERE item->>'price_list_id' IS NOT NULL AND item->>'multiplier' IS NOT NULL;
  END IF;
  v_audit_data := p_data;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_created', 'product', v_new_id, v_name, NULL, v_audit_data);
  RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;


ALTER FUNCTION "public"."create_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_product_with_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product" "jsonb", "p_options" "jsonb", "p_variants" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_product_id         uuid;
  v_product_name       text;
  v_new_data           jsonb;
  v_option             jsonb;
  v_option_idx         int := 0;
  v_option_id          uuid;
  v_value              jsonb;
  v_value_idx          int;
  v_value_id           uuid;
  v_variant            jsonb;
  v_variant_id         uuid;
  v_ov_ref             jsonb;
  v_value_map          jsonb := '{}'::jsonb;
  v_key                text;
  v_default_variant_id uuid;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role
  INTO v_stock_write, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  v_product_name := p_product->>'name';

  INSERT INTO products (
    business_id, category_id, brand_id, name, sku, barcode,
    price, cost, stock, min_stock, image_url, image_source,
    is_active, show_in_catalog, has_variants
  )
  VALUES (
    v_caller_business_id,
    NULLIF(p_product->>'category_id', '')::uuid,
    NULLIF(p_product->>'brand_id', '')::uuid,
    v_product_name,
    NULLIF(p_product->>'sku', ''),
    NULLIF(p_product->>'barcode', ''),
    COALESCE((p_product->>'price')::numeric, 0),
    COALESCE((p_product->>'cost')::numeric, 0),
    0,
    COALESCE((p_product->>'min_stock')::int, 0),
    NULLIF(p_product->>'image_url', ''),
    NULLIF(p_product->>'image_source', ''),
    COALESCE((p_product->>'is_active')::boolean, true),
    COALESCE((p_product->>'show_in_catalog')::boolean, true),
    true
  )
  RETURNING id INTO v_product_id;

  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    INSERT INTO product_options (
      business_id, product_id, attribute_type_id, name, position
    )
    VALUES (
      v_caller_business_id,
      v_product_id,
      v_option->>'attribute_type_id',
      v_option->>'name',
      COALESCE((v_option->>'position')::int, v_option_idx)
    )
    RETURNING id INTO v_option_id;

    v_value_idx := 0;
    FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
    LOOP
      INSERT INTO product_option_values (option_id, value, position)
      VALUES (
        v_option_id,
        v_value->>'value',
        COALESCE((v_value->>'position')::int, v_value_idx)
      )
      RETURNING id INTO v_value_id;

      v_key := v_option_idx::text || ':' || v_value_idx::text;
      v_value_map := v_value_map || jsonb_build_object(v_key, v_value_id::text);
      v_value_idx := v_value_idx + 1;
    END LOOP;

    v_option_idx := v_option_idx + 1;
  END LOOP;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    INSERT INTO product_variants (
      business_id, product_id, sku, barcode, price, cost,
      stock, min_stock, image_url, image_source, is_active
    )
    VALUES (
      v_caller_business_id,
      v_product_id,
      NULLIF(v_variant->>'sku', ''),
      NULLIF(v_variant->>'barcode', ''),
      COALESCE((v_variant->>'price')::numeric, 0),
      COALESCE((v_variant->>'cost')::numeric, 0),
      COALESCE((v_variant->>'stock')::int, 0),
      COALESCE((v_variant->>'min_stock')::int, 0),
      NULLIF(v_variant->>'image_url', ''),
      NULLIF(v_variant->>'image_source', ''),
      COALESCE((v_variant->>'is_active')::boolean, true)
    )
    RETURNING id INTO v_variant_id;

    IF v_default_variant_id IS NULL THEN
      v_default_variant_id := v_variant_id;
    END IF;
    IF COALESCE((v_variant->>'is_default')::boolean, false) THEN
      v_default_variant_id := v_variant_id;
    END IF;

    FOR v_ov_ref IN SELECT * FROM jsonb_array_elements(v_variant->'option_value_indices')
    LOOP
      v_key := (v_ov_ref->0)::text || ':' || (v_ov_ref->1)::text;
      v_value_id := (v_value_map->>v_key)::uuid;
      IF v_value_id IS NOT NULL THEN
        INSERT INTO product_variant_option_values (variant_id, option_value_id)
        VALUES (v_variant_id, v_value_id);
      END IF;
    END LOOP;
  END LOOP;

  UPDATE products
  SET default_variant_id = v_default_variant_id
  WHERE id = v_product_id AND business_id = v_caller_business_id;

  v_new_data := product_variants_snapshot(v_caller_business_id, v_product_id);

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'product_variants_created',
    'product',
    v_product_id,
    v_product_name,
    NULL,
    v_new_data
  );

  RETURN jsonb_build_object('success', true, 'product_id', v_product_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."create_product_with_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product" "jsonb", "p_options" "jsonb", "p_variants" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric DEFAULT NULL::numeric, "p_offer_price" numeric DEFAULT NULL::numeric, "p_group_size" integer DEFAULT NULL::integer, "p_affected_units" integer DEFAULT NULL::integer, "p_pay_percent" numeric DEFAULT NULL::numeric, "p_product_id" "uuid" DEFAULT NULL::"uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_brand_id" "uuid" DEFAULT NULL::"uuid", "p_starts_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_ends_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_show_in_catalog" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_row                public.promotions%ROWTYPE;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  -- Validaciones de negocio (los CHECK de la tabla son la red de seguridad final)
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;
  IF p_kind NOT IN ('percent', 'offer_price', 'quantity') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tipo de promoción inválido');
  END IF;
  IF (p_product_id IS NOT NULL)::int + (p_category_id IS NOT NULL)::int + (p_brand_id IS NOT NULL)::int <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La promoción debe tener exactamente un alcance (producto, categoría o marca)');
  END IF;
  IF p_kind = 'percent' AND (p_percent IS NULL OR p_percent <= 0 OR p_percent > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 0 y 100');
  END IF;
  IF p_kind = 'offer_price' THEN
    IF p_offer_price IS NULL OR p_offer_price <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta debe ser mayor a 0');
    END IF;
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta requiere un producto específico');
    END IF;
  END IF;
  IF p_kind = 'quantity' THEN
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Las promos por cantidad requieren un producto específico');
    END IF;
    IF p_group_size IS NULL OR p_group_size < 2 OR p_group_size > 100
       OR p_affected_units IS NULL OR p_affected_units < 1 OR p_affected_units >= p_group_size
       OR p_pay_percent IS NULL OR p_pay_percent < 0 OR p_pay_percent >= 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Configuración de cantidad inválida');
    END IF;
  END IF;
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'La fecha de fin debe ser posterior a la de inicio');
  END IF;

  -- El target debe pertenecer al negocio
  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada');
  END IF;

  INSERT INTO promotions (
    business_id, name, kind, percent, offer_price,
    group_size, affected_units, pay_percent,
    product_id, category_id, brand_id,
    starts_at, ends_at, show_in_catalog
  ) VALUES (
    v_caller_business_id, btrim(p_name), p_kind,
    CASE WHEN p_kind = 'percent' THEN p_percent END,
    CASE WHEN p_kind = 'offer_price' THEN p_offer_price END,
    CASE WHEN p_kind = 'quantity' THEN p_group_size END,
    CASE WHEN p_kind = 'quantity' THEN p_affected_units END,
    CASE WHEN p_kind = 'quantity' THEN p_pay_percent END,
    p_product_id, p_category_id, p_brand_id,
    p_starts_at, p_ends_at, COALESCE(p_show_in_catalog, true)
  ) RETURNING * INTO v_row;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'promotion_created', 'promotion', v_row.id, v_row.name, NULL, to_jsonb(v_row));

  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;


ALTER FUNCTION "public"."create_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sale_transaction"("p_business_id" "uuid", "p_subtotal" numeric, "p_discount" numeric, "p_total" numeric, "p_status" "text", "p_price_list_id" "uuid", "p_operator_id" "uuid", "p_items" "jsonb", "p_payments" "jsonb", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_session_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_sale_id            uuid;
  v_sale_created_at    timestamptz;
  v_item               jsonb;
  v_payment            jsonb;
  v_payments_total     numeric := 0;
  v_credit_total       numeric := 0;
  v_actor_role         text;
  v_actor_permissions  jsonb;
  v_stored_op_id       uuid;
  v_new_data           jsonb;
  v_customer           customers%ROWTYPE;
  v_credit_available   numeric;
  v_has_price_override boolean := false;
  v_balance_after      numeric;
  v_item_promo_id      uuid;
  v_item_promo_disc    numeric;
BEGIN
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio invalido');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un item');
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La venta debe tener al menos un pago');
  END IF;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_payments_total := v_payments_total + (v_payment->>'amount')::numeric;
    IF (v_payment->>'method') = 'credit' THEN
      v_credit_total := v_credit_total + (v_payment->>'amount')::numeric;
    END IF;
  END LOOP;
  IF v_payments_total < p_total THEN
    RETURN jsonb_build_object('success', false, 'error', 'El monto de los pagos no cubre el total de la venta');
  END IF;

  SELECT role, permissions INTO v_actor_role, v_actor_permissions
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
    v_actor_permissions := NULL;
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'unit_price_override') IS NOT NULL THEN
      v_has_price_override := true;
      EXIT;
    END IF;
  END LOOP;
  IF v_has_price_override AND v_actor_role <> 'owner' THEN
    IF v_actor_permissions IS NULL OR (normalize_permissions(v_actor_permissions)->>'pos_pricing') <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permiso de override de precio requerido');
    END IF;
  END IF;

  IF v_credit_total > 0 THEN
    IF p_customer_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Pago con crédito requiere cliente');
    END IF;

    SELECT * INTO v_customer
    FROM customers
    WHERE id = p_customer_id AND business_id = v_caller_business_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio');
    END IF;

    IF NOT v_customer.is_credit_enabled THEN
      RETURN jsonb_build_object('success', false, 'error', 'El cliente no tiene crédito habilitado');
    END IF;

    v_credit_available := v_customer.credit_limit - COALESCE(v_customer.credit_balance, 0);
    IF v_credit_total > v_credit_available THEN
      RETURN jsonb_build_object('success', false, 'error', 'El monto supera el crédito disponible');
    END IF;
  ELSIF p_customer_id IS NOT NULL THEN
    PERFORM 1 FROM customers
    WHERE id = p_customer_id AND business_id = v_caller_business_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Cliente no pertenece al negocio');
    END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM cash_sessions
    WHERE id = p_session_id AND business_id = v_caller_business_id AND status = 'open';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Sesión de caja no válida');
    END IF;
  END IF;

  INSERT INTO sales (business_id, subtotal, discount, total, status, price_list_id, operator_id, customer_id, session_id)
  VALUES (p_business_id, p_subtotal, p_discount, p_total, p_status, p_price_list_id, p_operator_id, p_customer_id, p_session_id)
  RETURNING id, created_at INTO v_sale_id, v_sale_created_at;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- promotion_id / promo_discount son informativos (la línea ya viene neta).
    -- Si la promo no pertenece al negocio del llamador, se descartan sin bloquear la venta.
    v_item_promo_id   := NULLIF(v_item->>'promotion_id', '')::uuid;
    v_item_promo_disc := GREATEST(COALESCE((v_item->>'promo_discount')::numeric, 0), 0);
    IF v_item_promo_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM promotions WHERE id = v_item_promo_id AND business_id = v_caller_business_id
    ) THEN
      v_item_promo_id   := NULL;
      v_item_promo_disc := 0;
    END IF;
    IF v_item_promo_id IS NULL THEN
      v_item_promo_disc := 0;
    END IF;

    INSERT INTO sale_items (
      sale_id, product_id, variant_id, quantity, unit_price, total,
      unit_price_override, override_reason, free_line_description,
      promotion_id, promo_discount
    ) VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      (v_item->>'quantity')::int,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      (v_item->>'unit_price_override')::numeric,
      v_item->>'override_reason',
      v_item->>'free_line_description',
      v_item_promo_id,
      v_item_promo_disc
    );
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO payments (sale_id, method, amount, status)
    VALUES (v_sale_id, v_payment->>'method', (v_payment->>'amount')::numeric, 'completed');
  END LOOP;

  IF v_credit_total > 0 THEN
    UPDATE customers
    SET credit_balance = COALESCE(credit_balance, 0) + v_credit_total
    WHERE id = p_customer_id
    RETURNING credit_balance INTO v_balance_after;

    INSERT INTO customer_account_movements
      (business_id, customer_id, type, amount, sale_id, operator_id, balance_after)
    VALUES
      (p_business_id, p_customer_id, 'charge', v_credit_total, v_sale_id, v_stored_op_id, v_balance_after);
  END IF;

  SELECT jsonb_build_object(
    'total', s.total, 'subtotal', s.subtotal, 'discount', s.discount, 'status', s.status, 'customer_id', s.customer_id,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', si.product_id, 'variant_id', si.variant_id,
        'quantity', si.quantity, 'unit_price', si.unit_price, 'total', si.total,
        'promotion_id', si.promotion_id, 'promo_discount', si.promo_discount) ORDER BY si.id)
      FROM sale_items si WHERE si.sale_id = v_sale_id), '[]'::jsonb),
    'payments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('method', pa.method, 'amount', pa.amount) ORDER BY pa.id)
      FROM payments pa WHERE pa.sale_id = v_sale_id), '[]'::jsonb)
  ) INTO v_new_data FROM sales s WHERE s.id = v_sale_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'sale_created', 'sale', v_sale_id, NULL, NULL, v_new_data);

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'created_at', v_sale_created_at);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."create_sale_transaction"("p_business_id" "uuid", "p_subtotal" numeric, "p_discount" numeric, "p_total" numeric, "p_status" "text", "p_price_list_id" "uuid", "p_operator_id" "uuid", "p_items" "jsonb", "p_payments" "jsonb", "p_customer_id" "uuid", "p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_contact_name" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_expenses_perm      text;
  v_actor_role         text;
  v_supplier           jsonb;
  v_supplier_id        uuid;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT permissions->>'expenses', role INTO v_expenses_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_expenses_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gastos insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  INSERT INTO suppliers (
    business_id, name, contact_name, phone, email, address, notes, is_active
  ) VALUES (
    v_caller_business_id,
    btrim(p_name),
    NULLIF(btrim(p_contact_name), ''),
    NULLIF(btrim(p_phone), ''),
    NULLIF(btrim(p_email), ''),
    NULLIF(btrim(p_address), ''),
    NULLIF(btrim(p_notes), ''),
    true
  )
  RETURNING id, to_jsonb(suppliers.*) INTO v_supplier_id, v_supplier;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'supplier_created', 'supplier', v_supplier_id, btrim(p_name),
    NULL, v_supplier
  );

  RETURN jsonb_build_object('success', true, 'supplier', v_supplier);
END;
$$;


ALTER FUNCTION "public"."create_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deactivate_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_expenses_perm      text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_old_name           text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT permissions->>'expenses', role INTO v_expenses_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_expenses_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gastos insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(s.*), s.name INTO v_old_data, v_old_name
  FROM suppliers s
  WHERE s.id = p_supplier_id AND s.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proveedor no encontrado');
  END IF;

  UPDATE suppliers
  SET is_active = false
  WHERE id = p_supplier_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'supplier_deactivated', 'supplier', p_supplier_id, v_old_name,
    v_old_data, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."deactivate_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid; v_old_name text;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  SELECT name INTO v_old_name FROM brands
  WHERE id = p_brand_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada'); END IF;
  DELETE FROM brands WHERE id = p_brand_id AND business_id = v_caller_business_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'brand_deleted', 'brand', p_brand_id, v_old_name,
    jsonb_build_object('name', v_old_name), NULL);
  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_old_data jsonb; v_old_name text;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  SELECT jsonb_build_object('name', name, 'icon', icon, 'icon_color', icon_color), name
    INTO v_old_data, v_old_name
  FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada'); END IF;
  DELETE FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'category_deleted', 'category', p_category_id, v_old_name, v_old_data, NULL);
  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_customer"("p_customer_id" "uuid", "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_actor_role         text;
  v_customer           record;
  v_has_sales          boolean;
  v_mode               text;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id
    AND business_id = v_caller_business_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM sales WHERE customer_id = p_customer_id
  ) INTO v_has_sales;

  IF v_has_sales OR COALESCE(v_customer.credit_balance, 0) > 0 THEN
    UPDATE customers
    SET deleted_at = now()
    WHERE id = p_customer_id;
    v_mode := 'soft';
  ELSE
    DELETE FROM customers WHERE id = p_customer_id;
    v_mode := 'hard';
  END IF;

  PERFORM log_audit_event(
    v_caller_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_deleted', 'customer', p_customer_id, v_customer.name,
    to_jsonb(v_customer),
    jsonb_build_object('mode', v_mode, 'name', v_customer.name)
  );

  RETURN jsonb_build_object('success', true, 'mode', v_mode);
END;
$$;


ALTER FUNCTION "public"."delete_customer"("p_customer_id" "uuid", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_actor_role   text;
  v_old_data     jsonb;
  v_old_label    text;
  v_category     text;
  v_item         record;
  v_current_cost numeric;
  v_warnings     jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(e.*), e.description, e.category
    INTO v_old_data, v_old_label, v_category
  FROM public.expenses e
  WHERE e.id = p_expense_id AND e.business_id = p_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_category = 'mercaderia' THEN
    v_old_data := v_old_data || jsonb_build_object(
      'items',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id',   ei.product_id,
          'variant_id',   ei.variant_id,
          'variant_label', CASE WHEN ei.variant_id IS NOT NULL THEN (
            SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
            FROM public.product_variant_option_values pvov
            JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
            JOIN public.product_options po        ON po.id  = pov.option_id
            WHERE pvov.variant_id = ei.variant_id
          ) END,
          'product_name', ei.product_name,
          'quantity',     ei.quantity,
          'unit_cost',    ei.unit_cost,
          'update_cost',  ei.update_cost
        ) ORDER BY ei.id)
        FROM public.expense_items ei WHERE ei.expense_id = p_expense_id
      ), '[]'::jsonb)
    );

    FOR v_item IN
      SELECT ei.product_id, ei.variant_id, ei.quantity, ei.unit_cost, ei.update_cost
      FROM public.expense_items ei
      WHERE ei.expense_id = p_expense_id
        AND ei.product_id IS NOT NULL
    LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = stock - v_item.quantity
        WHERE id = v_item.variant_id AND business_id = p_business_id;

        IF v_item.update_cost THEN
          SELECT cost INTO v_current_cost
          FROM public.product_variants
          WHERE id = v_item.variant_id AND business_id = p_business_id;

          IF v_current_cost IS DISTINCT FROM v_item.unit_cost THEN
            v_warnings := v_warnings || jsonb_build_array(
              jsonb_build_object(
                'product_id', v_item.product_id,
                'variant_id', v_item.variant_id,
                'reason',     'cost_changed'
              )
            );
          ELSE
            UPDATE public.product_variants
            SET cost = NULL
            WHERE id = v_item.variant_id AND business_id = p_business_id;
          END IF;
        END IF;
      ELSE
        UPDATE public.products
        SET stock = stock - v_item.quantity
        WHERE id = v_item.product_id AND business_id = p_business_id;

        IF v_item.update_cost THEN
          SELECT cost INTO v_current_cost
          FROM public.products
          WHERE id = v_item.product_id AND business_id = p_business_id;

          IF v_current_cost IS DISTINCT FROM v_item.unit_cost THEN
            v_warnings := v_warnings || jsonb_build_array(
              jsonb_build_object('product_id', v_item.product_id, 'reason', 'cost_changed')
            );
          ELSE
            UPDATE public.products
            SET cost = NULL
            WHERE id = v_item.product_id AND business_id = p_business_id;
          END IF;
        END IF;
      END IF;
    END LOOP;

    DELETE FROM public.inventory_movements
    WHERE reference_id = p_expense_id AND business_id = p_business_id;

    DELETE FROM public.expense_items
    WHERE expense_id = p_expense_id;
  END IF;

  DELETE FROM public.expenses
  WHERE id = p_expense_id AND business_id = p_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'expense_deleted', 'expense', p_expense_id, v_old_label,
    v_old_data, NULL
  );

  IF jsonb_array_length(v_warnings) > 0 THEN
    RETURN jsonb_build_object('success', true, 'warnings', v_warnings);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_operator"("p_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_old_name           text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_target_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador no especificado');
  END IF;

  IF p_target_operator_id = p_operator_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'No podés eliminar tu propio operador');
  END IF;

  SELECT normalize_permissions(permissions)->>'manage_operators', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gestión de operadores insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'name',        o.name,
    'role',        o.role,
    'permissions', o.permissions,
    'is_active',   o.is_active
  ), o.name INTO v_old_data, v_old_name
  FROM operators o
  WHERE o.id = p_target_operator_id AND o.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Operador no encontrado');
  END IF;

  DELETE FROM operators
  WHERE id = p_target_operator_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'operator_deleted', 'operator', p_target_operator_id, v_old_name,
    v_old_data, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_operator"("p_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_old_name           text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de listas de precios insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(pl.*), pl.name
    INTO v_old_data, v_old_name
  FROM price_lists pl
  WHERE pl.id = p_price_list_id AND pl.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lista de precios no encontrada');
  END IF;

  DELETE FROM price_lists
  WHERE id = p_price_list_id AND business_id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_deleted', 'price_list', p_price_list_id, v_old_name,
    v_old_data, NULL
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."delete_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid;
  v_has_sales boolean; v_old_data jsonb; v_old_name text;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  SELECT to_jsonb(p), p.name INTO v_old_data, v_old_name
  FROM products p WHERE p.id = p_product_id AND p.business_id = v_caller_business_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado'); END IF;
  SELECT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.product_id = p_product_id AND s.business_id = v_caller_business_id AND s.status = 'completed') INTO v_has_sales;
  IF v_has_sales THEN
    UPDATE products SET is_active = false WHERE id = p_product_id AND business_id = v_caller_business_id;
    PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
      'product_deleted', 'product', p_product_id, v_old_name, v_old_data, NULL);
    RETURN jsonb_build_object('success', true, 'soft_deleted', true);
  END IF;
  DELETE FROM price_list_overrides WHERE product_id = p_product_id;
  DELETE FROM inventory_movements  WHERE product_id = p_product_id;
  DELETE FROM products WHERE id = p_product_id AND business_id = v_caller_business_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'product_deleted', 'product', p_product_id, v_old_name, v_old_data, NULL);
  RETURN jsonb_build_object('success', true, 'soft_deleted', false);
END;
$$;


ALTER FUNCTION "public"."delete_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_operator_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."delete_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_operator_id" "uuid") OWNER TO "postgres";


-- NOTA: find_applicable_promotion (RETURNS public.promotions) se define MÁS ABAJO,
-- después del CREATE TABLE promotions — su tipo de retorno exige la tabla creada.


CREATE OR REPLACE FUNCTION "public"."get_active_session"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_result      jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id',             cs.id,
    'opening_amount', cs.opening_amount,
    'opened_at',      cs.opened_at,
    'opened_by',      cs.opened_by,
    'opened_by_name', CASE
                        WHEN cs.opened_by IS NULL THEN 'Dueño'
                        ELSE o.name
                      END,
    'status',         cs.status,
    'sales_count',    COALESCE(agg.sales_count, 0),
    'sales_total',    COALESCE(agg.sales_total, 0)
  ) INTO v_result
  FROM cash_sessions cs
  LEFT JOIN operators o ON o.id = cs.opened_by AND o.business_id = v_business_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS sales_count, COALESCE(SUM(total), 0) AS sales_total
    FROM sales
    WHERE session_id = cs.id AND business_id = v_business_id
  ) agg ON true
  WHERE cs.business_id = v_business_id AND cs.status = 'open'
  LIMIT 1;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."get_active_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_attribute_types"() RETURNS TABLE("id" "text", "label" "text", "position" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT id, label, position
  FROM attribute_types
  ORDER BY position;
$$;


ALTER FUNCTION "public"."get_attribute_types"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_audit_log"("p_business_id" "uuid", "p_entity_type" "text" DEFAULT NULL::"text", "p_operator_id" "uuid" DEFAULT NULL::"uuid", "p_date_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_date_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business uuid;
  v_total           integer;
  v_rows            jsonb;
BEGIN
  v_caller_business := get_business_id();
  IF v_caller_business IS NULL OR v_caller_business <> p_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.audit_log al
  WHERE al.business_id = p_business_id
    AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (
      p_operator_id IS NULL
      OR (p_operator_id = '00000000-0000-0000-0000-000000000000'::uuid AND al.operator_id IS NULL AND al.actor_role <> 'customer')
      OR al.operator_id = p_operator_id
    )
    AND (p_date_from IS NULL OR al.created_at >= p_date_from)
    AND (p_date_to   IS NULL OR al.created_at <  p_date_to);

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      al.id,
      al.operator_id,
      al.actor_role,
      al.action,
      al.entity_type,
      al.entity_id,
      al.entity_label,
      al.old_data,
      al.new_data,
      al.created_at,
      CASE
        WHEN al.actor_role = 'customer' THEN 'Cliente'
        ELSE COALESCE(o.name, 'Dueño')
      END AS actor_name
    FROM public.audit_log al
    LEFT JOIN public.operators o ON o.id = al.operator_id
    WHERE al.business_id = p_business_id
      AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = '00000000-0000-0000-0000-000000000000'::uuid AND al.operator_id IS NULL AND al.actor_role <> 'customer')
        OR al.operator_id = p_operator_id
      )
      AND (p_date_from IS NULL OR al.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR al.created_at <  p_date_to)
    ORDER BY al.created_at DESC
    LIMIT  p_limit
    OFFSET p_offset
  ) r;

  RETURN jsonb_build_object('data', COALESCE(v_rows, '[]'::jsonb), 'total', v_total);
END;
$$;


ALTER FUNCTION "public"."get_audit_log"("p_business_id" "uuid", "p_entity_type" "text", "p_operator_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_business_balance"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone    text;
  v_from        date;
  v_to          date;
  v_income      numeric := 0;
  v_expenses    numeric := 0;
  v_by_category jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_from := COALESCE(p_from, date_trunc('month', (now() AT TIME ZONE v_timezone)::date)::date);
  v_to   := COALESCE(p_to, (now() AT TIME ZONE v_timezone)::date);

  SELECT COALESCE(SUM(total), 0)
  INTO v_income
  FROM public.sales
  WHERE business_id = p_business_id
    AND status = 'completed'
    AND (created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_expenses
  FROM public.expenses
  WHERE business_id = p_business_id
    AND date BETWEEN v_from AND v_to;

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
$$;


ALTER FUNCTION "public"."get_business_balance"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_business_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT business_id FROM profiles WHERE id = (SELECT auth.uid())
$$;


ALTER FUNCTION "public"."get_business_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_business"("p_slug" "text") RETURNS TABLE("id" "uuid", "name" "text", "description" "text", "logo_url" "text", "whatsapp" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT b.id, b.name, b.description, b.logo_url, b.whatsapp
  FROM public.businesses b
  WHERE b.slug = p_slug
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_catalog_business"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_categories"("p_slug" "text") RETURNS TABLE("id" "uuid", "name" "text", "sort_order" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT b.id INTO v_business_id
  FROM businesses b
  WHERE b.slug = p_slug;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.position AS sort_order
  FROM categories c
  WHERE c.business_id = v_business_id
  ORDER BY c.position ASC;
END;
$$;


ALTER FUNCTION "public"."get_catalog_categories"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_default_variant_prices"("p_slug" "text") RETURNS TABLE("product_id" "uuid", "price" numeric, "stock" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT id INTO v_business_id FROM businesses WHERE slug = p_slug LIMIT 1;
  IF v_business_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    p.id            AS product_id,
    pv.price        AS price,
    pv.stock        AS stock
  FROM products p
  JOIN product_variants pv ON pv.id = p.default_variant_id
  WHERE p.business_id    = v_business_id
    AND p.is_active      = true
    AND p.show_in_catalog = true
    AND p.has_variants   = true
    AND p.default_variant_id IS NOT NULL;
END;
$$;


ALTER FUNCTION "public"."get_catalog_default_variant_prices"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_order"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE v_business_id uuid; v_order jsonb; v_items jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthorized'); END IF;
  SELECT to_jsonb(o.*) INTO v_order FROM catalog_orders o WHERE o.id = p_order_id AND o.business_id = v_business_id;
  IF v_order IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(ci.*) ORDER BY ci.id), '[]'::jsonb) INTO v_items
   FROM catalog_order_items ci WHERE ci.order_id = p_order_id;
  RETURN jsonb_build_object('success', true, 'order', v_order, 'items', v_items);
END; $$;


ALTER FUNCTION "public"."get_catalog_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_orders"("p_status" "text"[] DEFAULT NULL::"text"[], "p_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_to" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("id" "uuid", "order_number" integer, "customer_name" "text", "customer_phone" "text", "delivery_type" "text", "status" "text", "subtotal" numeric, "total" numeric, "item_count" integer, "created_at" timestamp with time zone, "accepted_at" timestamp with time zone, "completed_at" timestamp with time zone, "sale_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE v_business_id uuid;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT o.id, o.order_number, o.customer_name, o.customer_phone, o.delivery_type,
    o.status, o.subtotal, o.total,
    (SELECT COUNT(*)::int FROM catalog_order_items ci WHERE ci.order_id = o.id) AS item_count,
    o.created_at, o.accepted_at, o.completed_at, o.sale_id
  FROM catalog_orders o
  WHERE o.business_id = v_business_id
    AND (p_status IS NULL OR o.status = ANY(p_status))
    AND (p_from IS NULL OR o.created_at >= p_from)
    AND (p_to IS NULL OR o.created_at < p_to)
  ORDER BY o.created_at DESC;
END; $$;


ALTER FUNCTION "public"."get_catalog_orders"("p_status" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_orders_unread_count"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_read_at     timestamptz;
  v_count       int;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT catalog_orders_read_at INTO v_read_at
    FROM businesses
   WHERE id = v_business_id;

  SELECT COUNT(*) INTO v_count
    FROM catalog_orders
   WHERE business_id = v_business_id
     AND status = 'recibido'
     AND created_at > COALESCE(v_read_at, '-infinity'::timestamptz);

  RETURN COALESCE(v_count, 0);
END;
$$;


ALTER FUNCTION "public"."get_catalog_orders_unread_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id     uuid;
  v_product         record;
  v_promo           public.promotions;
  v_promo_real      boolean;
  v_base_price      numeric;
  v_computed_price  numeric;
  v_options_json    json;
  v_variants_json   json;
  v_brand_name      text;
  v_category_name   text;
BEGIN
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Negocio no encontrado');
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
    AND business_id = v_business_id
    AND is_active = true
    AND show_in_catalog = true
  LIMIT 1;

  IF v_product IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  SELECT b.name INTO v_brand_name
  FROM public.brands b
  WHERE b.id = v_product.brand_id
    AND b.business_id = v_business_id;

  SELECT c.name INTO v_category_name
  FROM public.categories c
  WHERE c.id = v_product.category_id
    AND c.business_id = v_business_id;

  v_promo := public.find_applicable_promotion(v_business_id, v_product.id, v_product.category_id, v_product.brand_id);

  v_base_price := public.compute_effective_price(
    v_product.cost::numeric,
    v_product.price::numeric,
    NULL,
    NULL,
    NULL,
    v_product.id,
    v_product.brand_id
  );

  -- Promo real: offer_price solo cuenta si abarata algo (sin variantes: oferta
  -- < precio; con variantes: alguna variante activa cuesta más que la oferta).
  IF v_promo.id IS NOT NULL AND v_promo.kind = 'offer_price' THEN
    IF v_product.has_variants THEN
      SELECT EXISTS (
        SELECT 1 FROM public.product_variants pv
        WHERE pv.product_id = p_product_id
          AND pv.business_id = v_business_id
          AND pv.is_active = true
          AND public.compute_effective_price(
                pv.cost::numeric, pv.price::numeric, pv.price::numeric,
                NULL, NULL, v_product.id, v_product.brand_id) > v_promo.offer_price
      ) INTO v_promo_real;
    ELSE
      v_promo_real := v_promo.offer_price < v_base_price;
    END IF;
    IF NOT v_promo_real THEN
      v_promo := NULL;
    END IF;
  END IF;

  v_computed_price := public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, v_base_price);

  SELECT json_agg(
    json_build_object(
      'id',                opt.id,
      'attribute_type_id', opt.attribute_type_id,
      'name',              opt.name,
      'position',          opt.position,
      'values', (
        SELECT json_agg(
          json_build_object(
            'id',       pov.id,
            'value',    pov.value,
            'position', pov.position
          ) ORDER BY pov.position
        )
        FROM public.product_option_values pov
        WHERE pov.option_id = opt.id
      )
    ) ORDER BY opt.position
  )
  INTO v_options_json
  FROM public.product_options opt
  WHERE opt.product_id = p_product_id
    AND opt.business_id = v_business_id;

  SELECT json_agg(
    json_build_object(
      'id',          pv.id,
      'price',       public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, pv_base.price),
      'original_price', CASE
                          WHEN public.apply_unit_promo(v_promo.kind, v_promo.percent, v_promo.offer_price, pv_base.price) < pv_base.price
                          THEN pv_base.price
                        END,
      'stock',       pv.stock,
      'image_url',   pv.image_url,
      'is_active',   pv.is_active,
      'is_in_stock', pv.stock > 0,
      'option_values', (
        SELECT json_agg(
          json_build_object(
            'option_id',       po.id,
            'option_value_id', pov.id,
            'value',           pov.value
          ) ORDER BY po.position
        )
        FROM public.product_variant_option_values pvov
        JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
        JOIN public.product_options po ON po.id = pov.option_id
        WHERE pvov.variant_id = pv.id
      )
    ) ORDER BY pv.id
  )
  INTO v_variants_json
  FROM public.product_variants pv
  CROSS JOIN LATERAL (
    SELECT public.compute_effective_price(
      pv.cost::numeric,
      pv.price::numeric,
      pv.price::numeric,
      NULL,
      NULL,
      v_product.id,
      v_product.brand_id
    ) AS price
  ) pv_base
  WHERE pv.product_id = p_product_id
    AND pv.business_id = v_business_id
    AND pv.is_active = true;

  RETURN json_build_object(
    'success', true,
    'product', json_build_object(
      'id',             v_product.id,
      'name',           v_product.name,
      'stock',          v_product.stock,
      'image_url',      v_product.image_url,
      'has_variants',   v_product.has_variants,
      'computed_price', v_computed_price,
      'original_price', CASE WHEN v_computed_price < v_base_price THEN v_base_price END,
      'brand_name',     v_brand_name,
      'category_name',  v_category_name,
      'promo', CASE WHEN v_promo.id IS NOT NULL THEN json_build_object(
        'kind',           v_promo.kind,
        'percent',        v_promo.percent,
        'group_size',     v_promo.group_size,
        'affected_units', v_promo.affected_units,
        'pay_percent',    v_promo.pay_percent,
        'ends_at',        v_promo.ends_at,
        'featured',       v_promo.show_in_catalog
      ) END
    ),
    'options',  COALESCE(v_options_json, '[]'::json),
    'variants', COALESCE(v_variants_json, '[]'::json)
  );
END;
$$;


ALTER FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_products"("p_slug" "text") RETURNS TABLE("id" "uuid", "category_id" "uuid", "name" "text", "sale_price" numeric, "stock" integer, "image_url" "text", "has_variants" boolean, "brand_id" "uuid", "brand_name" "text", "variant_count" integer, "original_price" numeric, "promo_kind" "text", "promo_percent" numeric, "promo_group_size" integer, "promo_affected_units" integer, "promo_pay_percent" numeric, "promo_ends_at" timestamp with time zone, "promo_featured" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
-- sale_price ya viene con la promo unitaria aplicada (find_applicable_promotion +
-- apply_unit_promo); original_price trae el precio previo cuando difiere (tachado).
-- Los campos promo_* son crudos — el label lo arma el cliente (promoBadgeLabel).
DECLARE
  v_business_id uuid;
BEGIN
  SELECT b.id INTO v_business_id
  FROM businesses b
  WHERE b.slug = p_slug;

  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    base.id,
    base.category_id,
    base.name,
    public.apply_unit_promo(fp.kind, fp.percent, fp.offer_price, base.base_price) AS sale_price,
    base.stock,
    base.image_url,
    base.has_variants,
    base.brand_id,
    base.brand_name,
    base.variant_count,
    CASE
      WHEN fp.id IS NOT NULL
       AND public.apply_unit_promo(fp.kind, fp.percent, fp.offer_price, base.base_price) < base.base_price
      THEN base.base_price
    END AS original_price,
    fp.kind AS promo_kind,
    fp.percent AS promo_percent,
    fp.group_size AS promo_group_size,
    fp.affected_units AS promo_affected_units,
    fp.pay_percent AS promo_pay_percent,
    fp.ends_at AS promo_ends_at,
    CASE WHEN fp.id IS NOT NULL THEN fp.show_in_catalog END AS promo_featured
  FROM (
    SELECT
      p.id,
      p.category_id,
      p.name,
      CASE
        WHEN p.has_variants THEN
          COALESCE(
            (SELECT MIN(ep.price)
             FROM (
               SELECT public.compute_effective_price(
                 pv.cost::numeric, pv.price::numeric, pv.price::numeric,
                 NULL, NULL, p.id, p.brand_id) AS price
               FROM product_variants pv
               WHERE pv.product_id = p.id AND pv.is_active = true
             ) ep
             WHERE ep.price > 0),
            CASE
              WHEN pv_def.id IS NOT NULL THEN
                public.compute_effective_price(
                  pv_def.cost::numeric, pv_def.price::numeric, pv_def.price::numeric,
                  NULL, NULL, p.id, p.brand_id)
              ELSE
                public.compute_effective_price(
                  p.cost::numeric, p.price::numeric, NULL,
                  NULL, NULL, p.id, p.brand_id)
            END
          )
        ELSE
          public.compute_effective_price(
            p.cost::numeric, p.price::numeric, NULL,
            NULL, NULL, p.id, p.brand_id)
      END AS base_price,
      CASE
        WHEN p.has_variants AND pv_def.id IS NOT NULL THEN pv_def.stock
        ELSE p.stock::integer
      END AS stock,
      CASE
        WHEN p.has_variants AND pv_def.id IS NOT NULL THEN COALESCE(pv_def.image_url, p.image_url)
        ELSE p.image_url
      END AS image_url,
      p.has_variants,
      p.brand_id,
      b_brand.name AS brand_name,
      CASE
        WHEN p.has_variants THEN (
          SELECT count(*)::int FROM product_variants pv
          WHERE pv.product_id = p.id AND pv.is_active = true
        )
        ELSE 0
      END AS variant_count
    FROM products p
    LEFT JOIN product_variants pv_def ON pv_def.id = p.default_variant_id
    LEFT JOIN brands b_brand ON b_brand.id = p.brand_id
    WHERE p.business_id    = v_business_id
      AND p.is_active      = true
      AND p.show_in_catalog = true
  ) base
  LEFT JOIN LATERAL public.find_applicable_promotion(v_business_id, base.id, base.category_id, base.brand_id) fp0 ON true
  -- fp = fp0 solo si la promo es real (abarata algo); si no, todas sus columnas
  -- quedan NULL y el producto se proyecta sin promo.
  LEFT JOIN LATERAL (
    SELECT fp0.*
    WHERE fp0.id IS NOT NULL
      AND (
        fp0.kind <> 'offer_price'
        OR CASE
             WHEN base.has_variants THEN EXISTS (
               SELECT 1 FROM product_variants pv
               WHERE pv.product_id = base.id
                 AND pv.is_active = true
                 AND public.compute_effective_price(
                       pv.cost::numeric, pv.price::numeric, pv.price::numeric,
                       NULL, NULL, base.id, base.brand_id) > fp0.offer_price
             )
             ELSE fp0.offer_price < base.base_price
           END
      )
  ) fp ON true
  ORDER BY base.name ASC;
END;
$$;


ALTER FUNCTION "public"."get_catalog_products"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_variant_filters"("p_slug" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_result      json;
BEGIN
  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE slug = p_slug
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT json_agg(type_group ORDER BY type_position)
  INTO v_result
  FROM (
    SELECT
      at.id       AS type_id,
      at.label    AS type_name,
      at.position AS type_position,
      (
        SELECT json_agg(val_row ORDER BY val_row->>'value')
        FROM (
          SELECT
            pov.value,
            json_agg(DISTINCT pr2.id::text ORDER BY pr2.id::text) AS product_ids
          FROM public.product_option_values pov
          JOIN public.product_options po2 ON po2.id = pov.option_id
            AND po2.attribute_type_id = at.id
            AND po2.business_id = v_business_id
          JOIN public.products pr2 ON pr2.id = po2.product_id
            AND pr2.business_id = v_business_id
            AND pr2.is_active = true
            AND pr2.show_in_catalog = true
            AND pr2.has_variants = true
          JOIN public.product_variant_option_values pvov ON pvov.option_value_id = pov.id
          JOIN public.product_variants pv ON pv.id = pvov.variant_id
            AND pv.is_active = true
          GROUP BY pov.value
        ) val_data,
        json_build_object('value', val_data.value, 'product_ids', val_data.product_ids) AS val_row
      ) AS values
    FROM public.attribute_types at
    WHERE EXISTS (
      SELECT 1
      FROM public.product_options po
      JOIN public.products pr ON pr.id = po.product_id
        AND pr.business_id = v_business_id
        AND pr.is_active = true
        AND pr.show_in_catalog = true
        AND pr.has_variants = true
      WHERE po.attribute_type_id = at.id
        AND po.business_id = v_business_id
    )
  ) type_group;

  RETURN COALESCE(v_result, '[]'::json);
END;
$$;


ALTER FUNCTION "public"."get_catalog_variant_filters"("p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_snapshots"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE v_caller_business_id uuid; v_from date; v_to date; v_rows jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb);
  END IF;
  v_to := COALESCE(p_to, current_date);
  v_from := COALESCE(p_from, v_to - 29);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'snapshot_date', ds.snapshot_date, 'sales_count', ds.sales_count, 'items_sold', ds.items_sold,
    'gross_revenue', ds.gross_revenue, 'discounts_total', ds.discounts_total, 'net_revenue', ds.net_revenue,
    'avg_ticket', ds.avg_ticket, 'customers_count', ds.customers_count, 'expenses_total', ds.expenses_total,
    'operating_expenses_total', ds.operating_expenses_total, 'inventory_expenses_total', ds.inventory_expenses_total,
    'top_product_id', ds.top_product_id, 'top_product_name', ds.top_product_name,
    'top_product_units', ds.top_product_units, 'top_product_revenue', ds.top_product_revenue,
    'promo_discounts_total', ds.promo_discounts_total, 'promo_sales_count', ds.promo_sales_count
  ) ORDER BY ds.snapshot_date), '[]'::jsonb) INTO v_rows
  FROM public.daily_snapshots ds
  WHERE ds.business_id = p_business_id AND ds.snapshot_date BETWEEN v_from AND v_to;
  RETURN jsonb_build_object('data', v_rows);
END;
$$;


ALTER FUNCTION "public"."get_daily_snapshots"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dead_stock"("p_business_id" "uuid", "p_days_threshold" integer DEFAULT 90, "p_bucket" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_threshold integer := GREATEST(COALESCE(p_days_threshold, 90), 1);
  v_bucket    text    := CASE
                           WHEN p_bucket IN ('never_sold','dead') THEN p_bucket
                           ELSE NULL
                         END;
  v_limit     integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_offset    integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.assert_tenant(p_business_id); END IF;

  RETURN (
    WITH sales_agg AS (
      SELECT
        si.product_id,
        MAX(s.created_at) AS last_sold_at
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.business_id = p_business_id
        AND s.status = 'completed'
      GROUP BY si.product_id
    ),
    variant_agg AS (
      SELECT
        v.product_id,
        COALESCE(SUM(v.stock), 0)                            AS v_stock,
        COALESCE(SUM(v.stock * COALESCE(v.cost, 0)), 0)      AS v_capital
      FROM product_variants v
      WHERE v.business_id = p_business_id
      GROUP BY v.product_id
    ),
    base AS (
      SELECT
        p.id,
        p.name,
        p.sku,
        p.is_active,
        p.image_url,
        p.image_source,
        c.name AS category_name,
        b.name AS brand_name,
        (va.product_id IS NOT NULL)                                                  AS has_variants,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_stock   ELSE p.stock                       END AS effective_stock,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_capital ELSE p.stock * COALESCE(p.cost, 0) END AS frozen_capital,
        CASE WHEN va.product_id IS NOT NULL THEN NULL ELSE p.cost END                 AS unit_cost,
        sa.last_sold_at,
        (CURRENT_DATE - p.created_at::date)                                           AS age_days,
        CASE WHEN sa.last_sold_at IS NULL THEN NULL
             ELSE (CURRENT_DATE - sa.last_sold_at::date) END                          AS days_since_last_sale
      FROM products p
      LEFT JOIN variant_agg va ON va.product_id = p.id
      LEFT JOIN sales_agg   sa ON sa.product_id = p.id
      LEFT JOIN categories  c  ON c.id = p.category_id
      LEFT JOIN brands      b  ON b.id = p.brand_id
      WHERE p.business_id = p_business_id
    ),
    classified AS (
      SELECT
        *,
        CASE
          WHEN age_days < 14                        THEN NULL
          WHEN last_sold_at IS NULL                 THEN 'never_sold'
          WHEN days_since_last_sale >= v_threshold  THEN 'dead'
          ELSE NULL
        END AS bucket,
        (frozen_capital = 0) AS missing_cost
      FROM base
      WHERE effective_stock > 0
    ),
    filtered AS (
      SELECT *
      FROM classified
      WHERE bucket IS NOT NULL
        AND (v_bucket IS NULL OR bucket = v_bucket)
    )
    SELECT jsonb_build_object(
      'data', COALESCE((
        SELECT jsonb_agg(to_jsonb(d))
        FROM (
          SELECT
            id, name, sku, category_name, brand_name, is_active, image_url, image_source,
            has_variants, effective_stock, frozen_capital, unit_cost,
            last_sold_at, days_since_last_sale, age_days, bucket, missing_cost
          FROM filtered
          ORDER BY frozen_capital DESC, days_since_last_sale DESC NULLS LAST, name ASC
          LIMIT v_limit OFFSET v_offset
        ) d
      ), '[]'::jsonb),
      'total', (SELECT COUNT(*) FROM filtered),
      'summary', (
        SELECT jsonb_build_object(
          'total_frozen_capital',  COALESCE(SUM(frozen_capital) FILTER (WHERE bucket IS NOT NULL), 0),
          'products_with_stock',   COUNT(*),
          'products_flagged',      COUNT(*) FILTER (WHERE bucket IS NOT NULL),
          'products_missing_cost', COUNT(*) FILTER (WHERE bucket IS NOT NULL AND missing_cost),
          'count_by_bucket', jsonb_build_object(
            'never_sold', COUNT(*) FILTER (WHERE bucket = 'never_sold'),
            'dead',       COUNT(*) FILTER (WHERE bucket = 'dead')
          ),
          'capital_by_bucket', jsonb_build_object(
            'never_sold', COALESCE(SUM(frozen_capital) FILTER (WHERE bucket = 'never_sold'), 0),
            'dead',       COALESCE(SUM(frozen_capital) FILTER (WHERE bucket = 'dead'), 0)
          )
        )
        FROM classified
      )
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_dead_stock"("p_business_id" "uuid", "p_days_threshold" integer, "p_bucket" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_expenses_list"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date", "p_category" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_expenses_list"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_category" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_low_stock_summary"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_out_count int;
  v_low_count int;
  v_products  jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT
    COUNT(*) FILTER (WHERE stock <= 0),
    COUNT(*) FILTER (WHERE stock > 0)
  INTO v_out_count, v_low_count
  FROM products
  WHERE business_id = p_business_id
    AND is_active = true
    AND stock <= COALESCE(min_stock, 0);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', id, 'name', name, 'stock', stock, 'min_stock', COALESCE(min_stock, 0))
      ORDER BY (stock <= 0) DESC, stock ASC, name ASC
    ), '[]'::jsonb)
  INTO v_products
  FROM products
  WHERE business_id = p_business_id
    AND is_active = true
    AND stock <= COALESCE(min_stock, 0);

  RETURN jsonb_build_object(
    'out_count', v_out_count,
    'low_count', v_low_count,
    'products',  v_products
  );
END;
$$;


ALTER FUNCTION "public"."get_low_stock_summary"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_mercaderia_expense_items"("p_expense_id" "uuid", "p_business_id" "uuid") RETURNS TABLE("id" "uuid", "product_id" "uuid", "product_name" "text", "variant_id" "uuid", "variant_label" "text", "quantity" integer, "unit_cost" numeric, "update_cost" boolean, "stock" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_mercaderia_expense_items"("p_expense_id" "uuid", "p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_operator_sales_sparkline"("p_business_id" "uuid", "p_operator_id" "uuid" DEFAULT NULL::"uuid", "p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_timezone           text;
  v_owner_sentinel     constant uuid := '00000000-0000-0000-0000-000000000000';
  v_to                 date;
  v_from               date;
  v_rows               jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb);
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_to := (now() AT TIME ZONE v_timezone)::date;
  v_from := v_to - GREATEST(COALESCE(p_days, 30) - 1, 0);

  WITH days_series AS (
    SELECT generate_series(v_from, v_to, '1 day'::interval)::date AS day
  ),
  local_sales AS (
    SELECT
      (s.created_at AT TIME ZONE v_timezone)::date AS day,
      s.total
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = v_owner_sentinel AND s.operator_id IS NULL)
        OR s.operator_id = p_operator_id
      )
  ),
  agg AS (
    SELECT
      ds.day,
      COALESCE(SUM(ls.total), 0) AS total,
      COUNT(ls.total)::integer    AS sales_count
    FROM days_series ds
    LEFT JOIN local_sales ls ON ls.day = ds.day
    GROUP BY ds.day
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day',         day,
        'total',       total,
        'sales_count', sales_count
      )
      ORDER BY day
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM agg;

  RETURN jsonb_build_object('data', v_rows);
END;
$$;


ALTER FUNCTION "public"."get_operator_sales_sparkline"("p_business_id" "uuid", "p_operator_id" "uuid", "p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_operator_stats"("p_operator_id" "uuid", "p_date_from" "date" DEFAULT NULL::"date", "p_date_to" "date" DEFAULT NULL::"date") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_id uuid;
  v_business_id uuid;
  v_operator_business_id uuid;
  v_timezone text;
  v_total_sales int;
  v_total_revenue numeric;
  v_top_products json;
  v_sale_history json;
BEGIN
  v_caller_id := auth.uid();

  -- Obtener business_id del caller
  SELECT business_id INTO v_business_id
  FROM profiles
  WHERE id = v_caller_id;

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'caller_not_found');
  END IF;

  -- Verificar que el operario pertenece al mismo business
  SELECT business_id INTO v_operator_business_id
  FROM operators
  WHERE id = p_operator_id;

  IF v_operator_business_id <> v_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = v_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  -- Totales
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(total), 0)
  INTO v_total_sales, v_total_revenue
  FROM sales
  WHERE operator_id = p_operator_id
    AND business_id = v_business_id
    AND status = 'completed'
    AND (p_date_from IS NULL OR (created_at AT TIME ZONE v_timezone)::date >= p_date_from)
    AND (p_date_to   IS NULL OR (created_at AT TIME ZONE v_timezone)::date <= p_date_to);

  -- Top 5 productos vendidos por este operario
  SELECT json_agg(t) INTO v_top_products
  FROM (
    SELECT
      p.name AS product_name,
      SUM(si.quantity)::int AS total_quantity,
      SUM(si.quantity * si.unit_price) AS total_revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.operator_id = p_operator_id
      AND s.business_id = v_business_id
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
    GROUP BY p.id, p.name
    ORDER BY total_quantity DESC
    LIMIT 5
  ) t;

  -- Historial de ventas (últimas 50)
  SELECT json_agg(t) INTO v_sale_history
  FROM (
    SELECT
      s.id,
      s.total,
      s.created_at,
      s.status,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)::int AS items_count
    FROM sales s
    WHERE s.operator_id = p_operator_id
      AND s.business_id = v_business_id
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
    ORDER BY s.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'success',        true,
    'total_sales',    v_total_sales,
    'total_revenue',  v_total_revenue,
    'top_products',   COALESCE(v_top_products, '[]'::json),
    'sale_history',   COALESCE(v_sale_history, '[]'::json)
  );
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;


ALTER FUNCTION "public"."get_operator_stats"("p_operator_id" "uuid", "p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_overstock"("p_business_id" "uuid", "p_limit" integer DEFAULT 500, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_min_age    integer := 30;
  v_min_months numeric := 6;
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
  v_offset     integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF auth.uid() IS NOT NULL THEN PERFORM public.assert_tenant(p_business_id); END IF;

  RETURN (
    WITH sales_agg AS (
      SELECT
        si.product_id,
        COALESCE(SUM(si.quantity) FILTER (WHERE s.created_at >= now() - interval '90 days'), 0) AS units_90d
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.business_id = p_business_id
        AND s.status = 'completed'
      GROUP BY si.product_id
    ),
    variant_agg AS (
      SELECT
        v.product_id,
        COALESCE(SUM(v.stock), 0)                       AS v_stock,
        COALESCE(SUM(v.stock * COALESCE(v.cost, 0)), 0) AS v_capital
      FROM product_variants v
      WHERE v.business_id = p_business_id
      GROUP BY v.product_id
    ),
    base AS (
      SELECT
        p.id, p.name, p.sku, p.is_active, p.image_url, p.image_source,
        c.name AS category_name,
        b.name AS brand_name,
        (va.product_id IS NOT NULL)                                                  AS has_variants,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_stock   ELSE p.stock                       END AS effective_stock,
        CASE WHEN va.product_id IS NOT NULL THEN va.v_capital ELSE p.stock * COALESCE(p.cost, 0) END AS frozen_capital,
        COALESCE(sa.units_90d, 0)::numeric                                           AS units_90d,
        (CURRENT_DATE - p.created_at::date)                                          AS age_days
      FROM products p
      LEFT JOIN variant_agg va ON va.product_id = p.id
      LEFT JOIN sales_agg   sa ON sa.product_id = p.id
      LEFT JOIN categories  c  ON c.id = p.category_id
      LEFT JOIN brands      b  ON b.id = p.brand_id
      WHERE p.business_id = p_business_id
    ),
    calc AS (
      SELECT
        *,
        ROUND(units_90d / (LEAST(age_days, 90)::numeric / 30.0), 2) AS monthly_velocity
      FROM base
      WHERE effective_stock > 0
        AND age_days >= v_min_age
        AND units_90d > 0
    ),
    flagged AS (
      SELECT
        *,
        ROUND(effective_stock / monthly_velocity, 1)                                          AS months_of_stock,
        ROUND(frozen_capital * (effective_stock / monthly_velocity - v_min_months)
              / (effective_stock / monthly_velocity), 2)                                      AS excess_capital
      FROM calc
      WHERE effective_stock / monthly_velocity >= v_min_months
    )
    SELECT jsonb_build_object(
      'data', COALESCE((
        SELECT jsonb_agg(to_jsonb(d))
        FROM (
          SELECT
            id, name, sku, category_name, brand_name, is_active, image_url, image_source,
            has_variants, effective_stock, frozen_capital, monthly_velocity, months_of_stock,
            excess_capital, age_days
          FROM flagged
          ORDER BY excess_capital DESC, months_of_stock DESC, name ASC
          LIMIT v_limit OFFSET v_offset
        ) d
      ), '[]'::jsonb),
      'total', (SELECT COUNT(*) FROM flagged),
      'summary', jsonb_build_object(
        'total_excess_capital',    COALESCE((SELECT SUM(excess_capital) FROM flagged), 0),
        'total_overstock_capital', COALESCE((SELECT SUM(frozen_capital) FROM flagged), 0),
        'products_count',          (SELECT COUNT(*) FROM flagged)
      )
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_overstock"("p_business_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_owner_stats"("p_date_from" "date" DEFAULT NULL::"date", "p_date_to" "date" DEFAULT NULL::"date") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id   uuid;
  v_timezone      text;
  v_total_sales   int;
  v_total_revenue numeric;
  v_top_products  json;
  v_sale_history  json;
BEGIN
  SELECT business_id INTO v_business_id
  FROM profiles
  WHERE id = auth.uid();

  IF v_business_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'caller_not_found');
  END IF;

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = v_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  -- Totales: ventas sin operador asignado (hechas por el owner)
  SELECT
    COUNT(*)::int,
    COALESCE(SUM(total), 0)
  INTO v_total_sales, v_total_revenue
  FROM sales
  WHERE business_id = v_business_id
    AND operator_id IS NULL
    AND status = 'completed'
    AND (p_date_from IS NULL OR (created_at AT TIME ZONE v_timezone)::date >= p_date_from)
    AND (p_date_to   IS NULL OR (created_at AT TIME ZONE v_timezone)::date <= p_date_to);

  -- Top 5 productos
  SELECT json_agg(t) INTO v_top_products
  FROM (
    SELECT
      p.name AS product_name,
      SUM(si.quantity)::int AS total_quantity,
      SUM(si.quantity * si.unit_price) AS total_revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.business_id = v_business_id
      AND s.operator_id IS NULL
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
    GROUP BY p.id, p.name
    ORDER BY total_quantity DESC
    LIMIT 5
  ) t;

  -- Historial (últimas 50)
  SELECT json_agg(t) INTO v_sale_history
  FROM (
    SELECT
      s.id,
      s.total,
      s.created_at,
      s.status,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)::int AS items_count
    FROM sales s
    WHERE s.business_id = v_business_id
      AND s.operator_id IS NULL
      AND s.status = 'completed'
      AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
      AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
    ORDER BY s.created_at DESC
    LIMIT 50
  ) t;

  RETURN json_build_object(
    'success',       true,
    'total_sales',   v_total_sales,
    'total_revenue', v_total_revenue,
    'top_products',  COALESCE(v_top_products, '[]'::json),
    'sale_history',  COALESCE(v_sale_history, '[]'::json)
  );
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;


ALTER FUNCTION "public"."get_owner_stats"("p_date_from" "date", "p_date_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_period_comparison"("p_business_id" "uuid", "p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_length             integer;
  v_prev_from          date;
  v_prev_to            date;
  v_current            jsonb;
  v_previous           jsonb;
  v_days               jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object(
      'current',  jsonb_build_object('from', p_from, 'to', p_to),
      'previous', jsonb_build_object('from', p_from, 'to', p_to),
      'days', '[]'::jsonb
    );
  END IF;

  IF p_to < p_from THEN
    RAISE EXCEPTION 'p_to debe ser >= p_from';
  END IF;

  v_length    := (p_to - p_from) + 1;
  v_prev_to   := p_from - 1;
  v_prev_from := v_prev_to - (v_length - 1);

  SELECT jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'net_revenue',              COALESCE(SUM(ds.net_revenue), 0),
    'gross_revenue',            COALESCE(SUM(ds.gross_revenue), 0),
    'discounts_total',          COALESCE(SUM(ds.discounts_total), 0),
    'expenses_total',           COALESCE(SUM(ds.expenses_total), 0),
    'operating_expenses_total', COALESCE(SUM(ds.operating_expenses_total), 0),
    'inventory_expenses_total', COALESCE(SUM(ds.inventory_expenses_total), 0),
    'sales_count',              COALESCE(SUM(ds.sales_count), 0),
    'items_sold',               COALESCE(SUM(ds.items_sold), 0),
    'customers_count',          COALESCE(SUM(ds.customers_count), 0),
    'avg_ticket',
      CASE WHEN COALESCE(SUM(ds.sales_count), 0) = 0 THEN 0
           ELSE COALESCE(SUM(ds.net_revenue), 0) / NULLIF(SUM(ds.sales_count), 0)
      END
  )
  INTO v_current
  FROM public.daily_snapshots ds
  WHERE ds.business_id = p_business_id
    AND ds.snapshot_date BETWEEN p_from AND p_to;

  SELECT jsonb_build_object(
    'from', v_prev_from,
    'to',   v_prev_to,
    'net_revenue',              COALESCE(SUM(ds.net_revenue), 0),
    'gross_revenue',            COALESCE(SUM(ds.gross_revenue), 0),
    'discounts_total',          COALESCE(SUM(ds.discounts_total), 0),
    'expenses_total',           COALESCE(SUM(ds.expenses_total), 0),
    'operating_expenses_total', COALESCE(SUM(ds.operating_expenses_total), 0),
    'inventory_expenses_total', COALESCE(SUM(ds.inventory_expenses_total), 0),
    'sales_count',              COALESCE(SUM(ds.sales_count), 0),
    'items_sold',               COALESCE(SUM(ds.items_sold), 0),
    'customers_count',          COALESCE(SUM(ds.customers_count), 0),
    'avg_ticket',
      CASE WHEN COALESCE(SUM(ds.sales_count), 0) = 0 THEN 0
           ELSE COALESCE(SUM(ds.net_revenue), 0) / NULLIF(SUM(ds.sales_count), 0)
      END
  )
  INTO v_previous
  FROM public.daily_snapshots ds
  WHERE ds.business_id = p_business_id
    AND ds.snapshot_date BETWEEN v_prev_from AND v_prev_to;

  WITH offsets AS (
    SELECT generate_series(0, v_length - 1) AS day_offset
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day_offset',           o.day_offset,
      'current_date',         (p_from + o.day_offset)::date,
      'previous_date',        (v_prev_from + o.day_offset)::date,
      'current_net_revenue',  COALESCE(cds.net_revenue, 0),
      'current_expenses',     COALESCE(cds.expenses_total, 0),
      'current_sales_count',  COALESCE(cds.sales_count, 0),
      'current_avg_ticket',   COALESCE(cds.avg_ticket, 0),
      'previous_net_revenue', COALESCE(pds.net_revenue, 0),
      'previous_expenses',    COALESCE(pds.expenses_total, 0),
      'previous_sales_count', COALESCE(pds.sales_count, 0),
      'previous_avg_ticket',  COALESCE(pds.avg_ticket, 0)
    ) ORDER BY o.day_offset
  ), '[]'::jsonb)
  INTO v_days
  FROM offsets o
  LEFT JOIN public.daily_snapshots cds
    ON cds.business_id = p_business_id
   AND cds.snapshot_date = (p_from + o.day_offset)::date
  LEFT JOIN public.daily_snapshots pds
    ON pds.business_id = p_business_id
   AND pds.snapshot_date = (v_prev_from + o.day_offset)::date;

  RETURN jsonb_build_object(
    'current',  v_current,
    'previous', v_previous,
    'days',     v_days
  );
END;
$$;


ALTER FUNCTION "public"."get_period_comparison"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_demand_shifts"(
  "p_business_id" "uuid",
  "p_from" "date" DEFAULT NULL::"date",
  "p_to" "date" DEFAULT NULL::"date",
  "p_min_units_base" integer DEFAULT 5,
  "p_min_delta_pct" numeric DEFAULT 20,
  "p_limit" integer DEFAULT 50,
  "p_offset" integer DEFAULT 0
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_to        date;
  v_from      date;
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_base  int     := greatest(coalesce(p_min_units_base, 5), 0);
  v_min_pct   numeric := greatest(coalesce(p_min_delta_pct, 20), 0);
  v_limit     int     := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset    int     := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to, (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, coalesce(p_to, (now() at time zone v_timezone)::date) - 29);

  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with cur as (
      select si.product_id, sum(si.quantity)::numeric as units, sum(si.total) as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id is not null
        and (s.created_at at time zone v_timezone)::date between v_from and v_to
      group by si.product_id
    ),
    prev as (
      select si.product_id, sum(si.quantity)::numeric as units, sum(si.total) as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id is not null
        and (s.created_at at time zone v_timezone)::date between v_prev_from and v_prev_to
      group by si.product_id
    ),
    joined as (
      select
        coalesce(c.product_id, p.product_id) as product_id,
        coalesce(c.units, 0)   as units_cur,
        coalesce(p.units, 0)   as units_prev,
        coalesce(c.revenue, 0) as revenue_cur,
        coalesce(p.revenue, 0) as revenue_prev
      from cur c full outer join prev p on p.product_id = c.product_id
    ),
    computed as (
      select j.*,
        (units_cur - units_prev)     as units_delta,
        (revenue_cur - revenue_prev) as revenue_delta,
        greatest(units_cur, units_prev) as base_units,
        case when units_cur  > 0 then round(revenue_cur  / units_cur,  2) end as avg_price_cur,
        case when units_prev > 0 then round(revenue_prev / units_prev, 2) end as avg_price_prev,
        case when units_prev = 0 then null else round((units_cur - units_prev) / units_prev * 100, 2) end as units_delta_pct,
        case
          when units_prev = 0 and units_cur > 0 then 'new'
          when units_cur  = 0 and units_prev > 0 then 'stopped'
          when units_cur  > units_prev then 'up'
          when units_cur  < units_prev then 'down'
          else 'steady'
        end as direction
      from joined j
    ),
    enriched as (
      select cm.*,
        case when cm.avg_price_prev is null or cm.avg_price_prev = 0 then null
             else round((cm.avg_price_cur - cm.avg_price_prev) / cm.avg_price_prev * 100, 2) end as price_delta_pct,
        pr.name, pr.sku, cat.name as category_name, br.name as brand_name
      from computed cm
      join products pr on pr.id = cm.product_id
      left join categories cat on cat.id = pr.category_id
      left join brands br on br.id = pr.brand_id
    ),
    flagged as (
      select e.*,
        (e.price_delta_pct is not null and abs(e.price_delta_pct) >= v_min_pct) as price_shift
      from enriched e
      where e.base_units >= v_min_base
        and (
          e.units_delta_pct is null
          or abs(coalesce(e.units_delta_pct, 0)) >= v_min_pct
          or (e.price_delta_pct is not null and abs(e.price_delta_pct) >= v_min_pct)
        )
    )
    select jsonb_build_object(
      'window', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'length_days', v_len),
      'params', jsonb_build_object('min_units_base', v_min_base, 'min_delta_pct', v_min_pct),
      'total',  (select count(*) from flagged),
      'data', coalesce((
        select jsonb_agg(to_jsonb(d)) from (
          select
            product_id as id, name, sku, category_name, brand_name, direction, price_shift,
            units_cur, units_prev, units_delta, units_delta_pct,
            revenue_cur, revenue_prev, revenue_delta,
            avg_price_cur, avg_price_prev, price_delta_pct
          from flagged
          order by abs(revenue_delta) desc, abs(units_delta) desc, name asc
          limit v_limit offset v_offset
        ) d
      ), '[]'::jsonb),
      'summary', (
        select jsonb_build_object(
          'flagged',        count(*),
          'up',             count(*) filter (where direction = 'up'),
          'down',           count(*) filter (where direction = 'down'),
          'new',            count(*) filter (where direction = 'new'),
          'stopped',        count(*) filter (where direction = 'stopped'),
          'steady',         count(*) filter (where direction = 'steady'),
          'price_shifts',   count(*) filter (where price_shift),
          'revenue_gained', coalesce(sum(revenue_delta) filter (where revenue_delta > 0), 0),
          'revenue_lost',   coalesce(sum(revenue_delta) filter (where revenue_delta < 0), 0),
          'revenue_net',    coalesce(sum(revenue_delta), 0)
        ) from flagged
      )
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_payment_mix_shift"(
  "p_business_id" "uuid",
  "p_from" "date" DEFAULT NULL::"date",
  "p_to" "date" DEFAULT NULL::"date",
  "p_min_delta_pp" numeric DEFAULT 5
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_to        date;
  v_from      date;
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_pp    numeric := greatest(coalesce(p_min_delta_pp, 5), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to, (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, coalesce(p_to, (now() at time zone v_timezone)::date) - 29);

  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with cur as (
      select pay.method, sum(pay.amount) as amount, count(distinct s.id) as tx
      from payments pay join sales s on s.id = pay.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and pay.status = 'completed'
        and (s.created_at at time zone v_timezone)::date between v_from and v_to
      group by pay.method
    ),
    prev as (
      select pay.method, sum(pay.amount) as amount, count(distinct s.id) as tx
      from payments pay join sales s on s.id = pay.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and pay.status = 'completed'
        and (s.created_at at time zone v_timezone)::date between v_prev_from and v_prev_to
      group by pay.method
    ),
    tot as (
      select coalesce((select sum(amount) from cur), 0)  as total_cur,
             coalesce((select sum(amount) from prev), 0) as total_prev
    ),
    joined as (
      select
        coalesce(c.method, p.method) as method,
        coalesce(c.amount, 0) as amount_cur,
        coalesce(p.amount, 0) as amount_prev,
        coalesce(c.tx, 0)     as tx_cur,
        coalesce(p.tx, 0)     as tx_prev
      from cur c full outer join prev p on p.method = c.method
    ),
    final as (
      select j.*,
        case when t.total_cur  > 0 then round(j.amount_cur  / t.total_cur  * 100, 2) end as share_cur,
        case when t.total_prev > 0 then round(j.amount_prev / t.total_prev * 100, 2) end as share_prev,
        (j.amount_cur - j.amount_prev) as amount_delta,
        case when j.amount_prev = 0 then null else round((j.amount_cur - j.amount_prev) / j.amount_prev * 100, 2) end as amount_delta_pct,
        round(coalesce(case when t.total_cur  > 0 then j.amount_cur  / t.total_cur  * 100 end, 0)
            - coalesce(case when t.total_prev > 0 then j.amount_prev / t.total_prev * 100 end, 0), 2) as share_delta_pp,
        case
          when j.amount_prev = 0 and j.amount_cur > 0 then 'new'
          when j.amount_cur  = 0 and j.amount_prev > 0 then 'stopped'
          when j.amount_cur  > j.amount_prev then 'up'
          when j.amount_cur  < j.amount_prev then 'down'
          else 'steady'
        end as direction
      from joined j cross join tot t
    )
    select jsonb_build_object(
      'window', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'length_days', v_len),
      'params', jsonb_build_object('min_delta_pp', v_min_pp),
      'totals', jsonb_build_object(
        'total_cur',       (select total_cur from tot),
        'total_prev',      (select total_prev from tot),
        'total_delta_pct', case when (select total_prev from tot) = 0 then null
                                else round(((select total_cur from tot) - (select total_prev from tot)) / (select total_prev from tot) * 100, 2) end
      ),
      'data', coalesce((
        select jsonb_agg(to_jsonb(d) order by abs(d.share_delta_pp) desc, d.amount_cur desc) from (
          select method, amount_cur, amount_prev, amount_delta, amount_delta_pct,
                 tx_cur, tx_prev, share_cur, share_prev, share_delta_pp, direction,
                 (abs(share_delta_pp) >= v_min_pp) as flagged
          from final
        ) d
      ), '[]'::jsonb),
      'summary', (
        select jsonb_build_object(
          'methods',         count(*),
          'methods_flagged', count(*) filter (where abs(share_delta_pp) >= v_min_pp)
        ) from final
      )
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_channel_signals"(
  "p_business_id" "uuid",
  "p_from" "date" DEFAULT NULL::"date",
  "p_to" "date" DEFAULT NULL::"date",
  "p_min_delta_pp" numeric DEFAULT 5
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_to        date;
  v_from      date;
  v_len       int;
  v_prev_to   date;
  v_prev_from date;
  v_min_pp    numeric := greatest(coalesce(p_min_delta_pp, 5), 0);
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to, (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, coalesce(p_to, (now() at time zone v_timezone)::date) - 29);

  if v_to < v_from then raise exception 'p_to debe ser >= p_from'; end if;

  v_len       := (v_to - v_from) + 1;
  v_prev_to   := v_from - 1;
  v_prev_from := v_prev_to - (v_len - 1);

  return (
    with co as (
      select
        ((created_at at time zone v_timezone)::date between v_from and v_to)           as is_cur,
        ((created_at at time zone v_timezone)::date between v_prev_from and v_prev_to) as is_prev,
        status, total
      from catalog_orders
      where business_id = p_business_id
        and (created_at at time zone v_timezone)::date between v_prev_from and v_to
    ),
    funnel as (
      select
        count(*) filter (where is_cur)                                       as total_cur,
        count(*) filter (where is_cur and status = 'completado')             as completed_cur,
        count(*) filter (where is_cur and status = 'rechazado')              as rejected_cur,
        count(*) filter (where is_cur and status = 'cancelado')              as cancelled_cur,
        coalesce(sum(total) filter (where is_cur and status = 'completado'), 0)  as gmv_cur,
        count(*) filter (where is_prev)                                      as total_prev,
        count(*) filter (where is_prev and status = 'completado')            as completed_prev,
        count(*) filter (where is_prev and status = 'rechazado')             as rejected_prev,
        count(*) filter (where is_prev and status = 'cancelado')             as cancelled_prev,
        coalesce(sum(total) filter (where is_prev and status = 'completado'), 0) as gmv_prev
      from co
    ),
    sales_ch as (
      select
        coalesce(sum(total) filter (where source = 'catalog' and (created_at at time zone v_timezone)::date between v_from and v_to), 0)           as catalog_cur,
        coalesce(sum(total) filter (where source = 'pos'     and (created_at at time zone v_timezone)::date between v_from and v_to), 0)           as pos_cur,
        coalesce(sum(total) filter (where source = 'catalog' and (created_at at time zone v_timezone)::date between v_prev_from and v_prev_to), 0) as catalog_prev,
        coalesce(sum(total) filter (where source = 'pos'     and (created_at at time zone v_timezone)::date between v_prev_from and v_prev_to), 0) as pos_prev
      from sales
      where business_id = p_business_id and status = 'completed'
        and (created_at at time zone v_timezone)::date between v_prev_from and v_to
    ),
    calc as (
      select f.*, sc.*,
        case when f.total_cur  = 0 then null else round(f.completed_cur::numeric / f.total_cur  * 100, 2) end as conv_cur,
        case when f.total_prev = 0 then null else round(f.completed_prev::numeric / f.total_prev * 100, 2) end as conv_prev,
        case when f.total_cur  = 0 then null else round(f.rejected_cur::numeric  / f.total_cur  * 100, 2) end as rej_cur,
        case when f.total_prev = 0 then null else round(f.rejected_prev::numeric / f.total_prev * 100, 2) end as rej_prev,
        case when (sc.catalog_cur  + sc.pos_cur)  = 0 then null else round(sc.catalog_cur  / (sc.catalog_cur  + sc.pos_cur)  * 100, 2) end as cat_share_cur,
        case when (sc.catalog_prev + sc.pos_prev) = 0 then null else round(sc.catalog_prev / (sc.catalog_prev + sc.pos_prev) * 100, 2) end as cat_share_prev
      from funnel f cross join sales_ch sc
    )
    select jsonb_build_object(
      'window', jsonb_build_object('from', v_from, 'to', v_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to, 'length_days', v_len),
      'params', jsonb_build_object('min_delta_pp', v_min_pp),
      'funnel', jsonb_build_object(
        'current',  jsonb_build_object('orders', total_cur,  'completed', completed_cur,  'rejected', rejected_cur,  'cancelled', cancelled_cur,  'gmv', gmv_cur,  'conversion_rate', conv_cur,  'rejection_rate', rej_cur),
        'previous', jsonb_build_object('orders', total_prev, 'completed', completed_prev, 'rejected', rejected_prev, 'cancelled', cancelled_prev, 'gmv', gmv_prev, 'conversion_rate', conv_prev, 'rejection_rate', rej_prev),
        'delta', jsonb_build_object(
          'orders',             total_cur - total_prev,
          'gmv',                gmv_cur - gmv_prev,
          'conversion_rate_pp', round(coalesce(conv_cur, 0) - coalesce(conv_prev, 0), 2),
          'rejection_rate_pp',  round(coalesce(rej_cur, 0)  - coalesce(rej_prev, 0),  2)
        )
      ),
      'channel', jsonb_build_object(
        'current',  jsonb_build_object('catalog_revenue', catalog_cur,  'pos_revenue', pos_cur,  'catalog_share', cat_share_cur),
        'previous', jsonb_build_object('catalog_revenue', catalog_prev, 'pos_revenue', pos_prev, 'catalog_share', cat_share_prev),
        'delta', jsonb_build_object('catalog_share_pp', round(coalesce(cat_share_cur, 0) - coalesce(cat_share_prev, 0), 2))
      ),
      'flags', jsonb_build_object(
        'rejection_up',        (round(coalesce(rej_cur, 0)  - coalesce(rej_prev, 0),  2) >= v_min_pp),
        'conversion_down',     (round(coalesce(conv_cur, 0) - coalesce(conv_prev, 0), 2) <= -v_min_pp),
        'catalog_share_shift', (abs(round(coalesce(cat_share_cur, 0) - coalesce(cat_share_prev, 0), 2)) >= v_min_pp)
      )
    )
    from calc
  );
end;
$$;


ALTER FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_history"(
  "p_business_id" "uuid",
  "p_product_id" "uuid",
  "p_months" integer DEFAULT 12
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_months     int  := least(greatest(coalesce(p_months, 12), 1), 36);
  v_to_month   date := date_trunc('month', current_date)::date;
  v_from_month date;
begin
  if auth.uid() is not null then
    perform public.assert_tenant(p_business_id);
  end if;

  v_from_month := (v_to_month - ((v_months - 1) || ' months')::interval)::date;

  return (
    with months as (
      select generate_series(v_from_month, v_to_month, interval '1 month')::date as m
    ),
    sales_m as (
      select date_trunc('month', s.created_at)::date as m,
             sum(si.quantity)::numeric as units,
             sum(si.total)             as revenue
      from sale_items si join sales s on s.id = si.sale_id
      where s.business_id = p_business_id and s.status = 'completed' and si.product_id = p_product_id
        and s.created_at >= v_from_month
      group by 1
    ),
    purch_m as (
      select date_trunc('month', e.date)::date as m,
             sum(ei.quantity)::numeric            as pq,
             sum(ei.quantity * ei.unit_cost)      as cost_sum
      from expense_items ei join expenses e on e.id = ei.expense_id
      where ei.business_id = p_business_id and ei.product_id = p_product_id
        and e.date >= v_from_month
      group by 1
    ),
    variant_agg as (
      select coalesce(sum(v.stock), 0) as v_stock
      from product_variants v
      where v.business_id = p_business_id and v.product_id = p_product_id
    ),
    series as (
      select
        mo.m as month,
        coalesce(sm.units, 0)   as units_sold,
        coalesce(sm.revenue, 0) as revenue,
        case when coalesce(sm.units, 0) > 0 then round(sm.revenue / sm.units, 2) end as avg_price,
        coalesce(pm.pq, 0)      as purchase_qty,
        case when coalesce(pm.pq, 0) > 0 then round(pm.cost_sum / pm.pq, 2) end as avg_unit_cost
      from months mo
      left join sales_m sm on sm.m = mo.m
      left join purch_m pm on pm.m = mo.m
    ),
    series2 as (
      select s.*,
        case when s.avg_price is not null and s.avg_unit_cost is not null and s.avg_price <> 0
             then round((s.avg_price - s.avg_unit_cost) / s.avg_price * 100, 2) end as est_margin_pct
      from series s
    )
    select jsonb_build_object(
      'product', (
        select jsonb_build_object(
          'id', p.id, 'name', p.name, 'sku', p.sku,
          'category_name', c.name, 'brand_name', b.name,
          'has_variants', (va.v_stock > 0 or exists (select 1 from product_variants pv where pv.business_id = p_business_id and pv.product_id = p.id)),
          'current_cost', p.cost, 'current_price', p.price,
          'effective_stock', case when exists (select 1 from product_variants pv where pv.business_id = p_business_id and pv.product_id = p.id)
                                  then (select va.v_stock) else p.stock end
        )
        from products p
        left join categories c on c.id = p.category_id
        left join brands b on b.id = p.brand_id
        cross join variant_agg va
        where p.id = p_product_id and p.business_id = p_business_id
      ),
      'window', jsonb_build_object('from_month', v_from_month, 'to_month', v_to_month, 'months', v_months),
      'series', coalesce((
        select jsonb_agg(to_jsonb(d) order by d.month)
        from (select month, units_sold, revenue, avg_price, purchase_qty, avg_unit_cost, est_margin_pct from series2) d
      ), '[]'::jsonb),
      'summary', (
        select jsonb_build_object(
          'total_units',           coalesce(sum(units_sold), 0),
          'total_revenue',         coalesce(sum(revenue), 0),
          'overall_avg_price',     case when coalesce(sum(units_sold), 0) > 0 then round(sum(revenue) / sum(units_sold), 2) end,
          'months_with_sales',     count(*) filter (where units_sold > 0),
          'months_with_purchases', count(*) filter (where purchase_qty > 0),
          'first_sale_month',      min(month) filter (where units_sold > 0),
          'last_sale_month',       max(month) filter (where units_sold > 0),
          'latest_purchase_cost',  (select s3.avg_unit_cost from series2 s3 where s3.avg_unit_cost is not null order by s3.month desc limit 1)
        )
        from series2
      )
    )
  );
end;
$$;


ALTER FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_plan_limits"("p_business_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_plan               text;
  v_status             text;
  v_provider           text;
  v_current_period_end timestamptz;
BEGIN
  v_caller_business_id := public.get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  SELECT s.plan, s.status, s.provider, s.current_period_end
  INTO v_plan, v_status, v_provider, v_current_period_end
  FROM public.subscriptions s
  WHERE s.business_id = v_caller_business_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suscripción no encontrada para el negocio %', v_caller_business_id;
  END IF;

  RETURN CASE
    WHEN v_plan IN ('pro','enterprise') THEN
      jsonb_build_object('plan', v_plan, 'status', v_status, 'provider', v_provider,
        'current_period_end', v_current_period_end, 'max_sales_per_month', NULL,
        'invoicing', true, 'accounting', true, 'analytics_history_days', NULL, 'ai', true)
    ELSE
      jsonb_build_object('plan', 'free', 'status', v_status, 'provider', v_provider,
        'current_period_end', v_current_period_end, 'max_sales_per_month', 200,
        'invoicing', false, 'accounting', false, 'analytics_history_days', 30, 'ai', false)
  END;
END;
$$;


ALTER FUNCTION "public"."get_plan_limits"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_product_with_variants"("p_product_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_result      json;
BEGIN
  v_business_id := get_business_id();

  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND business_id = v_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Product not found');
  END IF;

  SELECT json_build_object(
    'success', true,
    'product', json_build_object(
      'id',              p.id,
      'business_id',     p.business_id,
      'category_id',     p.category_id,
      'brand_id',        p.brand_id,
      'name',            p.name,
      'sku',             p.sku,
      'barcode',         p.barcode,
      'price',           p.price,
      'cost',            p.cost,
      'stock',           p.stock,
      'min_stock',       p.min_stock,
      'image_url',       p.image_url,
      'image_source',    p.image_source,
      'is_active',       p.is_active,
      'show_in_catalog', p.show_in_catalog,
      'sales_count',     p.sales_count,
      'has_variants',    p.has_variants,
      'created_at',      p.created_at
    ),
    'options', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',                po.id,
          'attribute_type_id', po.attribute_type_id,
          'name',              po.name,
          'position',          po.position,
          'values', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'id',       pov.id,
                'value',    pov.value,
                'position', pov.position
              ) ORDER BY pov.position
            ), '[]'::json)
            FROM product_option_values pov
            WHERE pov.option_id = po.id
          )
        ) ORDER BY po.position
      ), '[]'::json)
      FROM product_options po
      WHERE po.product_id = p_product_id
        AND po.business_id = v_business_id
    ),
    'variants', (
      SELECT COALESCE(json_agg(
        json_build_object(
          'id',           pv.id,
          'sku',          pv.sku,
          'barcode',      pv.barcode,
          'price',        pv.price,
          'cost',         pv.cost,
          'stock',        pv.stock,
          'min_stock',    pv.min_stock,
          'image_url',    pv.image_url,
          'image_source', pv.image_source,
          'is_active',    pv.is_active,
          'created_at',   pv.created_at,
          'updated_at',   pv.updated_at,
          'is_in_stock',  pv.stock > 0,
          'option_values', (
            SELECT COALESCE(json_agg(
              json_build_object(
                'option_id',       po.id,
                'option_value_id', pov.id,
                'value',           pov.value
              )
            ), '[]'::json)
            FROM product_variant_option_values pvov
            JOIN product_option_values pov ON pov.id = pvov.option_value_id
            JOIN product_options po        ON po.id  = pov.option_id
            WHERE pvov.variant_id = pv.id
          )
        ) ORDER BY pv.created_at
      ), '[]'::json)
      FROM product_variants pv
      WHERE pv.product_id = p_product_id
        AND pv.business_id = v_business_id
        AND pv.is_active = true
    )
  )
  INTO v_result
  FROM products p
  WHERE p.id = p_product_id AND p.business_id = v_business_id;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_product_with_variants"("p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sale_detail"("p_sale_id" "uuid", "p_business_id" "uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
    'customer_name',  cust.name,
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
  LEFT JOIN customers cust       ON cust.id = s.customer_id
  LEFT JOIN LATERAL (
    SELECT method FROM payments
    WHERE sale_id = p_sale_id
    ORDER BY created_at DESC
    LIMIT 1
  ) pay ON true
  WHERE s.id = p_sale_id;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_sale_detail"("p_sale_id" "uuid", "p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_promo_impact"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_data   jsonb;
  v_totals jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  SELECT jsonb_agg(row) INTO v_data
  FROM (
    SELECT
      pr.id                              AS promotion_id,
      pr.name,
      pr.kind,
      pr.percent,
      pr.group_size,
      pr.affected_units,
      pr.pay_percent,
      (pr.archived_at IS NOT NULL)       AS archived,
      count(DISTINCT s.id)               AS sales_count,
      sum(si.quantity)                   AS units_sold,
      sum(si.total)                      AS revenue,
      sum(si.promo_discount)             AS discount_total
    FROM sale_items si
    JOIN sales s      ON s.id = si.sale_id
    JOIN promotions pr ON pr.id = si.promotion_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY pr.id
    ORDER BY sum(si.total) DESC
  ) row;

  SELECT jsonb_build_object(
    'promo_sales_count',    COALESCE(count(DISTINCT s.id) FILTER (WHERE si.promotion_id IS NOT NULL), 0),
    'total_sales_count',    COALESCE(count(DISTINCT s.id), 0),
    'promo_units',          COALESCE(sum(si.quantity)      FILTER (WHERE si.promotion_id IS NOT NULL), 0),
    'promo_revenue',        COALESCE(sum(si.total)         FILTER (WHERE si.promotion_id IS NOT NULL), 0),
    'promo_discount_total', COALESCE(sum(si.promo_discount) FILTER (WHERE si.promotion_id IS NOT NULL), 0)
  ) INTO v_totals
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
    AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to);

  RETURN jsonb_build_object(
    'totals', v_totals,
    'data',   COALESCE(v_data, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."get_promo_impact"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sales_by_brand_detail"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_rows  jsonb;
  v_total bigint;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  SELECT COUNT(DISTINCT COALESCE(b.id::text, 'sin-marca'))
  INTO v_total
  FROM public.sale_items si
  JOIN public.sales    s ON s.id = si.sale_id
  JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.brands b ON b.id = p.brand_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
    AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to);

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
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY b.id, b.name
    ORDER BY revenue DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'data',  COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$$;


ALTER FUNCTION "public"."get_sales_by_brand_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sales_by_category_detail"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_rows  jsonb;
  v_total bigint;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  SELECT COUNT(DISTINCT COALESCE(c.id::text, 'sin-categoria'))
  INTO v_total
  FROM public.sale_items si
  JOIN public.sales s       ON s.id = si.sale_id
  JOIN public.products p    ON p.id = si.product_id
  LEFT JOIN public.categories c ON c.id = p.category_id
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
    AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to);

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
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY c.id, c.name, c.icon
    ORDER BY revenue DESC
    LIMIT p_limit OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'data',  COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$$;


ALTER FUNCTION "public"."get_sales_by_category_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sales_by_operator_detail"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone text;
  v_rows jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

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
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY op.id, op.name, op.role
    ORDER BY revenue DESC
  ) r;

  RETURN jsonb_build_object(
    'data', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."get_sales_by_operator_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sales_by_payment_detail"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone    text;
  v_rows        jsonb;
  v_collections jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  SELECT jsonb_agg(row_to_json(r))
  INTO v_rows
  FROM (
    SELECT
      pay.method,
      COUNT(DISTINCT s.id)::int AS transactions,
      SUM(pay.amount)           AS total_amount,
      AVG(pay.amount)           AS avg_ticket
    FROM public.payments pay
    JOIN public.sales s ON s.id = pay.sale_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND pay.status = 'completed'
      AND (p_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY pay.method
    ORDER BY total_amount DESC
  ) r;

  SELECT jsonb_agg(row_to_json(c))
  INTO v_collections
  FROM (
    SELECT
      m.method,
      COUNT(*)::int   AS transactions,
      SUM(m.amount)   AS total_amount,
      AVG(m.amount)   AS avg_ticket
    FROM public.customer_account_movements m
    WHERE m.business_id = p_business_id
      AND m.type = 'payment'
      AND (p_from IS NULL OR (m.created_at AT TIME ZONE v_timezone)::date >= p_from)
      AND (p_to   IS NULL OR (m.created_at AT TIME ZONE v_timezone)::date <= p_to)
    GROUP BY m.method
    ORDER BY total_amount DESC
  ) c;

  RETURN jsonb_build_object(
    'data',        COALESCE(v_rows, '[]'::jsonb),
    'collections', COALESCE(v_collections, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."get_sales_by_payment_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sales_heatmap"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date", "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_timezone           text;
  v_from               date;
  v_to                 date;
  v_owner_sentinel     constant uuid := '00000000-0000-0000-0000-000000000000';
  v_rows               jsonb;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb);
  END IF;

  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_to := COALESCE(p_to, current_date);
  v_from := COALESCE(p_from, v_to - 29);

  WITH local_sales AS (
    SELECT
      EXTRACT(DOW  FROM (s.created_at AT TIME ZONE v_timezone))::smallint AS weekday,
      EXTRACT(HOUR FROM (s.created_at AT TIME ZONE v_timezone))::smallint AS hour,
      s.total
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = v_owner_sentinel AND s.operator_id IS NULL)
        OR s.operator_id = p_operator_id
      )
  ),
  agg AS (
    SELECT
      weekday,
      hour,
      COUNT(*)::integer       AS sales_count,
      COALESCE(SUM(total), 0) AS net_revenue
    FROM local_sales
    GROUP BY weekday, hour
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'weekday',     weekday,
        'hour',        hour,
        'sales_count', sales_count,
        'net_revenue', net_revenue
      )
      ORDER BY weekday, hour
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM agg;

  RETURN jsonb_build_object('data', v_rows);
END;
$$;


ALTER FUNCTION "public"."get_sales_heatmap"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sales_history"("p_business_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_method" "text" DEFAULT NULL::"text", "p_operator_id" "uuid" DEFAULT NULL::"uuid", "p_search" "text" DEFAULT NULL::"text", "p_before_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_before_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 50) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_owner   uuid    := '00000000-0000-0000-0000-000000000000';
  v_search  text    := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_first   boolean := (p_before_id IS NULL);
  v_data    jsonb;
  v_total   integer;
  v_summary jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC, d.id DESC), '[]'::jsonb)
  INTO v_data
  FROM (
    SELECT
      s.id, s.created_at, s.subtotal, s.discount, s.total, s.status,
      (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) AS method,
      o.name AS operator_name,
      (SELECT COALESCE(SUM(si.quantity), 0)::int
         FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
      (SELECT COALESCE(jsonb_agg(ic.obj ORDER BY ic.ord), '[]'::jsonb)
         FROM (
           SELECT jsonb_build_object('icon', cat.icon, 'color', cat.icon_color) AS obj, si.id AS ord
           FROM sale_items si
           LEFT JOIN products pr   ON pr.id  = si.product_id
           LEFT JOIN categories cat ON cat.id = pr.category_id
           WHERE si.sale_id = s.id
           ORDER BY si.id
           LIMIT 4
         ) ic) AS item_icons
    FROM sales s
    LEFT JOIN operators o ON o.id = s.operator_id
    WHERE s.business_id = p_business_id
      AND s.created_at >= p_from
      AND s.created_at <= p_to
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = v_owner AND s.operator_id IS NULL)
        OR s.operator_id = p_operator_id
      )
      AND (
        v_search IS NULL
        OR s.id::text ILIKE '%' || v_search || '%'
        OR s.total::text ILIKE '%' || v_search || '%'
        OR o.name ILIKE '%' || v_search || '%'
        OR EXISTS (
          SELECT 1 FROM sale_items si
          JOIN products pr ON pr.id = si.product_id
          WHERE si.sale_id = s.id AND pr.name ILIKE '%' || v_search || '%'
        )
      )
      AND (
        p_method IS NULL
        OR (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) = p_method
      )
      AND (
        p_before_id IS NULL
        OR (s.created_at, s.id) < (p_before_created_at, p_before_id)
      )
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT v_limit
  ) d;

  IF v_first THEN
    WITH base AS (
      SELECT
        s.total,
        (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) AS method
      FROM sales s
      LEFT JOIN operators o ON o.id = s.operator_id
      WHERE s.business_id = p_business_id
        AND s.created_at >= p_from
        AND s.created_at <= p_to
        AND (
          p_operator_id IS NULL
          OR (p_operator_id = v_owner AND s.operator_id IS NULL)
          OR s.operator_id = p_operator_id
        )
        AND (
          v_search IS NULL
          OR s.id::text ILIKE '%' || v_search || '%'
          OR s.total::text ILIKE '%' || v_search || '%'
          OR o.name ILIKE '%' || v_search || '%'
          OR EXISTS (
            SELECT 1 FROM sale_items si
            JOIN products pr ON pr.id = si.product_id
            WHERE si.sale_id = s.id AND pr.name ILIKE '%' || v_search || '%'
          )
        )
        AND (
          p_method IS NULL
          OR (SELECT p.method FROM payments p WHERE p.sale_id = s.id ORDER BY p.created_at ASC LIMIT 1) = p_method
        )
    )
    SELECT
      COUNT(*)::integer,
      jsonb_build_object(
        'count', COUNT(*),
        'total_revenue', COALESCE(SUM(total), 0),
        'top_method', (
          SELECT method FROM base
          WHERE method IS NOT NULL
          GROUP BY method ORDER BY COUNT(*) DESC LIMIT 1
        )
      )
    INTO v_total, v_summary
    FROM base;
  END IF;

  RETURN jsonb_build_object(
    'data', v_data,
    'total', v_total,
    'summary', v_summary
  );
END;
$$;


ALTER FUNCTION "public"."get_sales_history"("p_business_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_method" "text", "p_operator_id" "uuid", "p_search" "text", "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_session_summary"("p_session_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_result      jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id',              cs.id,
    'status',          cs.status,
    'opening_amount',  cs.opening_amount,
    'closing_amount',  cs.closing_amount,
    'expected_amount', cs.expected_amount,
    'difference',      CASE WHEN cs.status = 'closed' THEN cs.closing_amount - cs.expected_amount ELSE NULL END,
    'opened_at',       cs.opened_at,
    'closed_at',       cs.closed_at,
    'notes',           cs.notes,
    'opened_by',       cs.opened_by,
    'opened_by_name',  CASE WHEN cs.opened_by IS NULL THEN 'Dueño' ELSE op.name END,
    'closed_by',       cs.closed_by,
    'closed_by_name',  CASE WHEN cs.closed_by IS NULL THEN 'Dueño' ELSE cl.name END,
    'sales_count',     COALESCE(agg.sales_count, 0),
    'sales_total',     COALESCE(agg.sales_total, 0),
    'cash_settlements', COALESCE(settle_agg.cash_settlements, 0),
    'payments_by_method', COALESCE(pay_agg.breakdown, '[]'::jsonb),
    'digital_balances', COALESCE(dig_agg.balances, '[]'::jsonb)
  ) INTO v_result
  FROM cash_sessions cs
  LEFT JOIN operators op ON op.id = cs.opened_by AND op.business_id = v_business_id
  LEFT JOIN operators cl ON cl.id = cs.closed_by AND cl.business_id = v_business_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS sales_count, COALESCE(SUM(s.total), 0) AS sales_total
    FROM sales s
    WHERE s.session_id = cs.id AND s.business_id = v_business_id
  ) agg ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(m.amount), 0) AS cash_settlements
    FROM customer_account_movements m
    WHERE m.session_id = cs.id AND m.business_id = v_business_id
      AND m.type = 'payment' AND m.method = 'cash'
  ) settle_agg ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('method', p.method, 'total', p.method_total) ORDER BY p.method_total DESC) AS breakdown
    FROM (
      SELECT p2.method, SUM(p2.amount) AS method_total
      FROM payments p2
      JOIN sales s2 ON s2.id = p2.sale_id
      WHERE s2.session_id = cs.id AND s2.business_id = v_business_id
      GROUP BY p2.method
    ) p
  ) pay_agg ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'method',          sdb.method,
        'opening_balance', sdb.opening_balance,
        'closing_balance', sdb.closing_balance,
        'sales_total',     COALESCE(pm.total, 0),
        'expected',        CASE WHEN sdb.opening_balance IS NOT NULL
                           THEN sdb.opening_balance + COALESCE(pm.total, 0)
                           ELSE NULL END,
        'difference',      CASE
                             WHEN sdb.opening_balance IS NOT NULL AND sdb.closing_balance IS NOT NULL
                             THEN sdb.closing_balance - (sdb.opening_balance + COALESCE(pm.total, 0))
                             ELSE NULL
                           END
      )
      ORDER BY sdb.method
    ) AS balances
    FROM session_digital_balances sdb
    LEFT JOIN LATERAL (
      SELECT SUM(p.amount) AS total
      FROM payments p
      JOIN sales s ON s.id = p.sale_id
      WHERE s.session_id = cs.id AND s.business_id = v_business_id AND p.method = sdb.method
    ) pm ON true
    WHERE sdb.session_id = cs.id
  ) dig_agg ON true
  WHERE cs.id = p_session_id AND cs.business_id = v_business_id;

  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."get_session_summary"("p_session_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_sessions_list"("p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_rows        jsonb;
  v_total       int;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM cash_sessions
  WHERE business_id = v_business_id;

  SELECT COALESCE(jsonb_agg(row ORDER BY row.opened_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      cs.id,
      cs.status,
      cs.opening_amount,
      cs.closing_amount,
      cs.expected_amount,
      CASE WHEN cs.status = 'closed' THEN cs.closing_amount - cs.expected_amount ELSE NULL END AS difference,
      cs.opened_at,
      cs.closed_at,
      EXTRACT(EPOCH FROM (COALESCE(cs.closed_at, now()) - cs.opened_at))::int AS duration_seconds,
      cs.notes,
      CASE WHEN cs.opened_by IS NULL THEN 'Dueño' ELSE op.name END AS opened_by_name,
      CASE WHEN cs.closed_by IS NULL THEN 'Dueño' ELSE cl.name END AS closed_by_name,
      COALESCE(agg.sales_count, 0) AS sales_count,
      COALESCE(agg.sales_total, 0) AS sales_total
    FROM cash_sessions cs
    LEFT JOIN operators op ON op.id = cs.opened_by AND op.business_id = v_business_id
    LEFT JOIN operators cl ON cl.id = cs.closed_by AND cl.business_id = v_business_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS sales_count, COALESCE(SUM(total), 0) AS sales_total
      FROM sales
      WHERE session_id = cs.id AND business_id = v_business_id
    ) agg ON true
    WHERE cs.business_id = v_business_id
    ORDER BY cs.opened_at DESC
    LIMIT p_limit OFFSET p_offset
  ) row;

  RETURN jsonb_build_object(
    'success', true,
    'data',    v_rows,
    'total',   v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."get_sessions_list"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_breakdown"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_timezone     text;
  v_from         date;
  v_to           date;
  v_by_category  jsonb;
  v_by_brand     jsonb;
  v_by_payment   jsonb;
  v_by_operator  jsonb;
begin
  perform public.assert_tenant(p_business_id);

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to,   (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, date_trunc('month', (now() at time zone v_timezone)::date)::date);

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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
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
      and (s.created_at at time zone v_timezone)::date between v_from and v_to
    group by o.id, o.name
  ) sub;

  return jsonb_build_object(
    'by_category', v_by_category,
    'by_brand',    v_by_brand,
    'by_payment',  v_by_payment,
    'by_operator', v_by_operator
  );
end;
$$;


ALTER FUNCTION "public"."get_stats_breakdown"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_evolution"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_timezone  text;
  v_from      date;
  v_to        date;
  v_days      int;
begin
  perform public.assert_tenant(p_business_id);

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  v_to   := coalesce(p_to,   (now() at time zone v_timezone)::date);
  v_from := coalesce(p_from, date_trunc('month', (now() at time zone v_timezone)::date)::date);
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
              where (s.created_at at time zone v_timezone)::date = day_series.d::date
            ), 0) as revenue,
            count(s.id) filter (
              where (s.created_at at time zone v_timezone)::date = day_series.d::date
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where (s.created_at at time zone v_timezone)::date = (day_series.d - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where (s.created_at at time zone v_timezone)::date = (day_series.d - v_days * interval '1 day')::date
            )::int as prev_cnt
          from generate_series(v_from, v_to, '1 day'::interval) as day_series(d)
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              (s.created_at at time zone v_timezone)::date = day_series.d::date
              or (s.created_at at time zone v_timezone)::date = (day_series.d - v_days * interval '1 day')::date
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
              where date_trunc('week', s.created_at at time zone v_timezone)::date = weeks.week_start
            ), 0) as revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at at time zone v_timezone)::date = weeks.week_start
            )::int as cnt,
            coalesce(sum(s.total) filter (
              where date_trunc('week', s.created_at at time zone v_timezone)::date = (weeks.week_start - v_days * interval '1 day')::date
            ), 0) as prev_revenue,
            count(s.id) filter (
              where date_trunc('week', s.created_at at time zone v_timezone)::date = (weeks.week_start - v_days * interval '1 day')::date
            )::int as prev_cnt
          from (
            select distinct date_trunc('week', d)::date as week_start
            from generate_series(v_from, v_to, '1 day'::interval) as gs(d)
          ) weeks
          left join sales s
            on s.business_id = p_business_id
            and s.status = 'completed'
            and (
              date_trunc('week', s.created_at at time zone v_timezone)::date = weeks.week_start
              or date_trunc('week', s.created_at at time zone v_timezone)::date = (weeks.week_start - v_days * interval '1 day')::date
            )
          group by weeks.week_start
        ) sub
      )
    );
  end if;
end;
$$;


ALTER FUNCTION "public"."get_stats_evolution"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_kpis"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_timezone    text;
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

  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_to   := COALESCE(p_to,   (now() AT TIME ZONE v_timezone)::date);
  v_from := COALESCE(p_from, date_trunc('month', (now() AT TIME ZONE v_timezone)::date)::date);

  v_days      := (v_to - v_from) + 1;
  v_prev_to   := v_from - interval '1 day';
  v_prev_from := v_prev_to - (v_days - 1) * interval '1 day';

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
    AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to;

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
    AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_prev_from AND v_prev_to;

  SELECT
    to_char((s.created_at AT TIME ZONE v_timezone)::date, 'YYYY-MM-DD'),
    ROUND(SUM(s.total), 2)
  INTO v_peak_day, v_peak_revenue
  FROM sales s
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
  GROUP BY (s.created_at AT TIME ZONE v_timezone)::date
  ORDER BY SUM(s.total) DESC
  LIMIT 1;

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
      EXTRACT(DOW FROM (s.created_at AT TIME ZONE v_timezone))::int AS dow_num,
      SUM(s.total)                         AS revenue,
      COUNT(*)                             AS cnt
    FROM sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
    GROUP BY EXTRACT(DOW FROM (s.created_at AT TIME ZONE v_timezone))::int
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
$$;


ALTER FUNCTION "public"."get_stats_kpis"("p_business_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_products_detail"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date", "p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_timezone text;
  v_data  jsonb;
  v_total int;
begin
  perform public.assert_tenant(p_business_id);

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
    and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to);

  select jsonb_agg(row)
  into v_data
  from (
    select
      p.id,
      p.name,
      p.sku,
      c.name                                                    as category_name,
      b.name                                                    as brand_name,
      COALESCE(pv_def.price, p.price)                          as price,
      COALESCE(pv_def.cost,  p.cost)                           as cost,
      sum(si.quantity)                                          as units_sold,
      sum(si.total)                                             as revenue,
      sum(si.total) - sum(si.quantity * COALESCE(pv.cost, p.cost)) as gross_profit,
      count(distinct s.id)                                      as transaction_count
    from sale_items si
    join sales s           on s.id = si.sale_id
    join products p        on p.id = si.product_id
    left join product_variants pv     on pv.id = si.variant_id
    left join product_variants pv_def on pv_def.id = p.default_variant_id
    left join categories c on c.id = p.category_id
    left join brands b     on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
      and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to)
    group by p.id, p.name, p.sku, c.name, b.name, p.price, p.cost, pv_def.price, pv_def.cost
    order by units_sold desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',  coalesce(v_data, '[]'::jsonb),
    'total', v_total
  );
end;
$$;


ALTER FUNCTION "public"."get_top_products_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"("p_business_id" "uuid", "p_operator_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_label" "text" DEFAULT NULL::"text", "p_old_data" "jsonb" DEFAULT NULL::"jsonb", "p_new_data" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  INSERT INTO public.audit_log (
    business_id, operator_id, actor_role, action,
    entity_type, entity_id, entity_label, old_data, new_data
  )
  VALUES (
    p_business_id, p_operator_id, p_actor_role, p_action,
    p_entity_type, p_entity_id, p_entity_label, p_old_data, p_new_data
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;


ALTER FUNCTION "public"."log_audit_event"("p_business_id" "uuid", "p_operator_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_label" "text", "p_old_data" "jsonb", "p_new_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_catalog_orders_read"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE businesses
     SET catalog_orders_read_at = now()
   WHERE id = v_business_id;
END;
$$;


ALTER FUNCTION "public"."mark_catalog_orders_read"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_cash_session"("p_opening_amount" numeric, "p_operator_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
  v_row         cash_sessions;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF EXISTS (
    SELECT 1 FROM cash_sessions
    WHERE business_id = v_business_id AND status = 'open'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ya existe una sesión de caja abierta');
  END IF;

  INSERT INTO cash_sessions (business_id, opening_amount, opened_by, opened_at, status)
  VALUES (v_business_id, p_opening_amount, p_operator_id, now(), 'open')
  RETURNING * INTO v_row;

  PERFORM log_audit_event(
    v_business_id,
    p_operator_id,
    CASE WHEN p_operator_id IS NULL THEN 'owner' ELSE 'operator' END,
    'cash_session_opened',
    'cash_session',
    v_row.id,
    NULL,
    jsonb_build_object('opening_amount', p_opening_amount, 'opened_by', p_operator_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'session', row_to_json(v_row)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ya existe una sesión de caja abierta');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."open_cash_session"("p_opening_amount" numeric, "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."product_variants_snapshot"("p_business_id" "uuid", "p_product_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_product  jsonb;
  v_options  jsonb;
  v_variants jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id',           p.id,
    'name',         p.name,
    'has_variants', p.has_variants,
    'default_variant_id', p.default_variant_id
  )
  INTO v_product
  FROM public.products p
  WHERE p.id = p_product_id AND p.business_id = p_business_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                po.id,
      'attribute_type_id', po.attribute_type_id,
      'name',              po.name,
      'position',          po.position,
      'values', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object('id', pov.id, 'value', pov.value, 'position', pov.position)
          ORDER BY pov.position
        ), '[]'::jsonb)
        FROM public.product_option_values pov
        WHERE pov.option_id = po.id
      )
    ) ORDER BY po.position
  ), '[]'::jsonb)
  INTO v_options
  FROM public.product_options po
  WHERE po.product_id = p_product_id AND po.business_id = p_business_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',        pv.id,
      'sku',       pv.sku,
      'barcode',   pv.barcode,
      'price',     pv.price,
      'cost',      pv.cost,
      'stock',     pv.stock,
      'min_stock', pv.min_stock,
      'is_active', pv.is_active,
      'option_values', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'option_id',       po.id,
            'option_name',     po.name,
            'option_value_id', pov.id,
            'value',           pov.value
          ) ORDER BY po.position
        ), '[]'::jsonb)
        FROM public.product_variant_option_values pvov
        JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
        JOIN public.product_options po        ON po.id  = pov.option_id
        WHERE pvov.variant_id = pv.id
      )
    ) ORDER BY pv.created_at
  ), '[]'::jsonb)
  INTO v_variants
  FROM public.product_variants pv
  WHERE pv.product_id = p_product_id AND pv.business_id = p_business_id;

  RETURN jsonb_build_object(
    'product',  v_product,
    'options',  v_options,
    'variants', v_variants
  );
END;
$$;


ALTER FUNCTION "public"."product_variants_snapshot"("p_business_id" "uuid", "p_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_sales_count"("p_business_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."reconcile_sales_count"("p_business_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_all_daily_snapshots"("p_snapshot_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_business record;
  v_snapshot_date date;
  v_processed integer := 0;
BEGIN
  FOR v_business IN
    SELECT b.id, b.timezone
    FROM public.businesses b
  LOOP
    IF p_snapshot_date IS NULL THEN
      v_snapshot_date := (
        now() AT TIME ZONE COALESCE(NULLIF(v_business.timezone, ''), 'America/Argentina/Buenos_Aires')
      )::date - 1;
    ELSE
      v_snapshot_date := p_snapshot_date;
    END IF;

    PERFORM public.upsert_daily_snapshot(v_business.id, v_snapshot_date);
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'snapshot_date', p_snapshot_date,
    'processed_businesses', v_processed
  );
END;
$$;


ALTER FUNCTION "public"."refresh_all_daily_snapshots"("p_snapshot_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_timezone           text;
  v_snapshot_date      date;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  IF p_snapshot_date IS NULL THEN
    SELECT timezone INTO v_timezone
    FROM public.businesses
    WHERE id = p_business_id;

    IF v_timezone IS NULL OR v_timezone = '' THEN
      v_timezone := 'America/Argentina/Buenos_Aires';
    END IF;

    v_snapshot_date := (now() AT TIME ZONE v_timezone)::date - 1;
  ELSE
    v_snapshot_date := p_snapshot_date;
  END IF;

  RETURN public.upsert_daily_snapshot(p_business_id, v_snapshot_date);
END;
$$;


ALTER FUNCTION "public"."refresh_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_expense_products"("p_business_id" "uuid", "p_term" "text", "p_limit" integer DEFAULT 20) RETURNS TABLE("product_id" "uuid", "product_name" "text", "variant_id" "uuid", "variant_label" "text", "stock" integer, "cost" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."search_expense_products"("p_business_id" "uuid", "p_term" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_customer_credit"("p_customer_id" "uuid", "p_amount" numeric, "p_method" "text", "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id  uuid;
  v_customer     record;
  v_actor_role   text;
  v_prev_balance numeric;
  v_next_balance numeric;
  v_session_id   uuid;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de negocio invalido';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Monto invalido';
  END IF;

  IF p_method NOT IN ('cash', 'card', 'transfer') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  SELECT * INTO v_customer
  FROM customers
  WHERE id = p_customer_id AND business_id = v_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente no encontrado';
  END IF;

  v_prev_balance := COALESCE(v_customer.credit_balance, 0);
  IF p_amount > v_prev_balance THEN
    RAISE EXCEPTION 'El monto supera la deuda actual del cliente';
  END IF;

  UPDATE customers
  SET credit_balance = v_prev_balance - p_amount
  WHERE id = p_customer_id;

  v_next_balance := v_prev_balance - p_amount;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_business_id AND is_active = true;
  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  SELECT id INTO v_session_id
  FROM cash_sessions
  WHERE business_id = v_business_id AND status = 'open';

  INSERT INTO customer_account_movements
    (business_id, customer_id, type, amount, method, operator_id, balance_after, session_id)
  VALUES
    (v_business_id, p_customer_id, 'payment', p_amount, p_method,
     CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END, v_next_balance, v_session_id);

  PERFORM log_audit_event(
    v_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_credit_settled', 'customer', p_customer_id, v_customer.name,
    jsonb_build_object('credit_balance', v_prev_balance),
    jsonb_build_object(
      'credit_balance', v_next_balance,
      'amount',         p_amount,
      'method',         p_method
    )
  );

  RETURN v_next_balance;
END;
$$;


ALTER FUNCTION "public"."settle_customer_credit"("p_customer_id" "uuid", "p_amount" numeric, "p_method" "text", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid", "p_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid; v_old_name text;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  SELECT name INTO v_old_name FROM brands
  WHERE id = p_brand_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada'); END IF;
  UPDATE brands SET name = btrim(p_name)
  WHERE id = p_brand_id AND business_id = v_caller_business_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'brand_updated', 'brand', p_brand_id, btrim(p_name),
    jsonb_build_object('name', v_old_name),
    jsonb_build_object('name', btrim(p_name)));
  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_business_settings"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text" DEFAULT NULL::"text", "p_whatsapp" "text" DEFAULT NULL::"text", "p_logo_url" "text" DEFAULT NULL::"text", "p_settings_patch" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT permissions->>'settings', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de configuración insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'name',        b.name,
    'description', b.description,
    'whatsapp',    b.whatsapp,
    'logo_url',    b.logo_url,
    'settings',    b.settings
  ) INTO v_old_data
  FROM businesses b
  WHERE b.id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Negocio no encontrado');
  END IF;

  UPDATE businesses SET
    name        = btrim(p_name),
    description = NULLIF(btrim(p_description), ''),
    whatsapp    = NULLIF(btrim(p_whatsapp), ''),
    logo_url    = NULLIF(btrim(p_logo_url), ''),
    settings    = CASE
      WHEN p_settings_patch IS NULL OR jsonb_typeof(p_settings_patch) <> 'object' THEN settings
      ELSE COALESCE(settings, '{}'::jsonb) || p_settings_patch
    END
  WHERE id = v_caller_business_id
  RETURNING jsonb_build_object(
    'name',        name,
    'description', description,
    'whatsapp',    whatsapp,
    'logo_url',    logo_url,
    'settings',    settings
  ) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'settings_updated', 'setting', p_business_id, btrim(p_name),
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_business_settings"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_whatsapp" "text", "p_logo_url" "text", "p_settings_patch" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_business_slug"("p_operator_id" "uuid", "p_business_id" "uuid", "p_slug" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_slug           text;
BEGIN
  IF p_operator_id IS NULL THEN
    RAISE EXCEPTION '403: Sesión de operador no encontrada';
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  IF p_slug !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Formato inválido. Solo letras minúsculas, números y guiones. Mínimo 3 caracteres.';
  END IF;

  SELECT permissions->>'settings', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RAISE EXCEPTION '403: Permisos de configuración insuficientes';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RAISE EXCEPTION '403: Sesión inválida';
    END IF;
    v_actor_role := 'owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM businesses
    WHERE slug = p_slug AND id <> v_caller_business_id
  ) THEN
    RAISE EXCEPTION 'Ese nombre ya está en uso por otro negocio.';
  END IF;

  SELECT slug INTO v_old_slug
  FROM businesses
  WHERE id = v_caller_business_id;

  UPDATE businesses
  SET slug = p_slug
  WHERE id = v_caller_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'settings_slug_updated', 'setting', p_business_id, p_slug,
    jsonb_build_object('slug', v_old_slug),
    jsonb_build_object('slug', p_slug)
  );
END;
$_$;


ALTER FUNCTION "public"."update_business_slug"("p_operator_id" "uuid", "p_business_id" "uuid", "p_slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_catalog_order_status"("p_operator_id" "uuid", "p_order_id" "uuid", "p_new_status" "text", "p_blacklist" boolean DEFAULT false, "p_payment_method" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid; v_sales_perm text; v_actor_role text; v_actor_op_id uuid;
  v_order record; v_valid boolean := false;
  v_sale_items jsonb := '[]'::jsonb; v_sale_payments jsonb; v_sale_result jsonb;
  v_sale_id uuid; v_old_data jsonb; v_new_data jsonb;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'unauthorized'); END IF;

  SELECT normalize_permissions(permissions)->>'online_orders', role INTO v_sales_perm, v_actor_role
   FROM operators WHERE id = p_operator_id AND business_id = v_business_id AND is_active = true;
  IF FOUND THEN
    IF v_sales_perm <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de ventas insuficientes'); END IF;
    v_actor_op_id := p_operator_id;
  ELSE
    IF p_operator_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner'; v_actor_op_id := NULL;
  END IF;

  SELECT * INTO v_order FROM catalog_orders WHERE id = p_order_id AND business_id = v_business_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;

  IF v_order.status = 'recibido' AND p_new_status IN ('aceptado','rechazado','cancelado') THEN v_valid := true;
  ELSIF v_order.status = 'aceptado' AND (
      (p_new_status = 'en_camino' AND v_order.delivery_type = 'delivery') OR
      (p_new_status = 'listo_retiro' AND v_order.delivery_type = 'takeaway') OR
      p_new_status = 'cancelado'
  ) THEN v_valid := true;
  ELSIF v_order.status IN ('en_camino','listo_retiro') AND p_new_status IN ('completado','cancelado') THEN v_valid := true;
  END IF;
  IF NOT v_valid THEN
    RETURN jsonb_build_object('success', false, 'error', format('invalid_transition: %s -> %s', v_order.status, p_new_status));
  END IF;

  v_old_data := to_jsonb(v_order);

  IF p_new_status = 'completado' THEN
    IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash','card','transfer','mercadopago') THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_payment_method');
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'product_id', ci.product_id, 'variant_id', ci.variant_id,
      'quantity', ci.quantity, 'unit_price', ci.unit_price, 'total', ci.line_total,
      'promotion_id', ci.promotion_id, 'promo_discount', ci.promo_discount
    )), '[]'::jsonb) INTO v_sale_items
     FROM catalog_order_items ci WHERE ci.order_id = p_order_id;

    v_sale_payments := jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', v_order.total));

    SELECT public.create_sale_transaction(
      v_business_id, v_order.subtotal, 0::numeric, v_order.total,
      'completed', NULL, v_actor_op_id, v_sale_items, v_sale_payments
    ) INTO v_sale_result;

    IF NOT COALESCE((v_sale_result->>'success')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_sale_result->>'error', 'sale_creation_failed'));
    END IF;
    v_sale_id := (v_sale_result->>'sale_id')::uuid;

    UPDATE sales SET source = 'catalog' WHERE id = v_sale_id;
  END IF;

  UPDATE catalog_orders SET
    status = p_new_status, updated_at = now(),
    accepted_at  = CASE WHEN p_new_status = 'aceptado'   AND accepted_at  IS NULL THEN now() ELSE accepted_at  END,
    completed_at = CASE WHEN p_new_status = 'completado' AND completed_at IS NULL THEN now() ELSE completed_at END,
    rejected_at  = CASE WHEN p_new_status = 'rechazado'  AND rejected_at  IS NULL THEN now() ELSE rejected_at  END,
    cancelled_at = CASE WHEN p_new_status = 'cancelado'  AND cancelled_at IS NULL THEN now() ELSE cancelled_at END,
    sale_id      = COALESCE(v_sale_id, sale_id)
  WHERE id = p_order_id;

  IF p_new_status = 'rechazado' AND p_blacklist = true THEN
    INSERT INTO catalog_phone_blacklist (business_id, phone, reason)
    VALUES (v_business_id, v_order.customer_phone, 'rechazado desde pedido #' || v_order.order_number)
    ON CONFLICT (business_id, phone) DO NOTHING;
  END IF;

  SELECT to_jsonb(o.*) INTO v_new_data FROM catalog_orders o WHERE o.id = p_order_id;

  PERFORM log_audit_event(
    v_business_id, v_actor_op_id, v_actor_role,
    'catalog_order_' || p_new_status, 'catalog_order', p_order_id,
    'Pedido #' || v_order.order_number, v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'sale_id', v_sale_id, 'status', p_new_status);
END; $$;


ALTER FUNCTION "public"."update_catalog_order_status"("p_operator_id" "uuid", "p_order_id" "uuid", "p_new_status" "text", "p_blacklist" boolean, "p_payment_method" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid; v_stock_write text; v_actor_role text; v_stored_op_id uuid; v_old_data jsonb;
BEGIN
  IF p_operator_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada'); END IF;
  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido'); END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio'); END IF;
  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_stock_write, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_stock_write <> 'true' THEN RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes'); END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida'); END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;
  SELECT jsonb_build_object('name', name, 'icon', icon, 'icon_color', icon_color) INTO v_old_data
  FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada'); END IF;
  UPDATE categories SET name = btrim(p_name), icon = btrim(p_icon), icon_color = p_icon_color
  WHERE id = p_category_id AND business_id = v_caller_business_id;
  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'category_updated', 'category', p_category_id, btrim(p_name), v_old_data,
    jsonb_build_object('name', btrim(p_name), 'icon', btrim(p_icon), 'icon_color', p_icon_color));
  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_customer_id" "uuid", "p_name" "text", "p_phone" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_dni" "text" DEFAULT NULL::"text", "p_credit_limit" numeric DEFAULT 0, "p_is_credit_enabled" boolean DEFAULT false, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT role INTO v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF NOT FOUND THEN
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(c.*) INTO v_old_data
  FROM customers c
  WHERE c.id = p_customer_id AND c.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cliente no encontrado');
  END IF;

  UPDATE customers SET
    name              = btrim(p_name),
    phone             = NULLIF(btrim(p_phone), ''),
    email             = NULLIF(btrim(p_email), ''),
    dni               = NULLIF(btrim(p_dni), ''),
    credit_limit      = COALESCE(p_credit_limit, 0),
    is_credit_enabled = COALESCE(p_is_credit_enabled, false),
    notes             = NULLIF(btrim(p_notes), '')
  WHERE id = p_customer_id AND business_id = v_caller_business_id
  RETURNING to_jsonb(customers.*) INTO v_new_data;

  PERFORM log_audit_event(
    v_caller_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'customer_updated', 'customer', p_customer_id, btrim(p_name),
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'customer', v_new_data);
END;
$$;


ALTER FUNCTION "public"."update_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_customer_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid" DEFAULT NULL::"uuid", "p_notes" "text" DEFAULT NULL::"text", "p_amount" numeric DEFAULT 0, "p_attachment_url" "text" DEFAULT NULL::"text", "p_attachment_type" "text" DEFAULT NULL::"text", "p_attachment_name" "text" DEFAULT NULL::"text", "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_actor_role text;
  v_old_data   jsonb;
  v_new_data   jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(e.*) INTO v_old_data
  FROM public.expenses e
  WHERE e.id = p_expense_id
    AND e.business_id = p_business_id
    AND e.category <> 'mercaderia';

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  UPDATE public.expenses
  SET
    description     = p_description,
    date            = p_date,
    supplier_id     = p_supplier_id,
    notes           = p_notes,
    amount          = p_amount,
    attachment_url  = p_attachment_url,
    attachment_type = p_attachment_type::public.expense_attachment_type,
    attachment_name = p_attachment_name,
    updated_at      = now()
  WHERE id = p_expense_id
    AND business_id = p_business_id
    AND category <> 'mercaderia'
  RETURNING to_jsonb(expenses.*) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'expense_updated', 'expense', p_expense_id, p_description,
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_amount" numeric, "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_mercaderia_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid" DEFAULT NULL::"uuid", "p_notes" "text" DEFAULT NULL::"text", "p_items" "jsonb" DEFAULT '[]'::"jsonb", "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_existing       record;
  v_new_item       jsonb;
  v_new_product_id uuid;
  v_new_variant_id uuid;
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
  v_new_keys       text[];
  v_actor_role     text;
  v_old_data       jsonb;
  v_new_data       jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.expenses
    WHERE id = p_expense_id AND business_id = p_business_id AND category = 'mercaderia'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  -- Capture pre-edit state for audit
  SELECT to_jsonb(e.*) || jsonb_build_object(
    'items',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',   ei.product_id,
        'variant_id',   ei.variant_id,
        'variant_label', CASE WHEN ei.variant_id IS NOT NULL THEN (
          SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
          FROM public.product_variant_option_values pvov
          JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
          JOIN public.product_options po        ON po.id  = pov.option_id
          WHERE pvov.variant_id = ei.variant_id
        ) END,
        'product_name', ei.product_name,
        'quantity',     ei.quantity,
        'unit_cost',    ei.unit_cost,
        'update_cost',  ei.update_cost
      ) ORDER BY ei.id)
      FROM public.expense_items ei WHERE ei.expense_id = p_expense_id
    ), '[]'::jsonb)
  ) INTO v_old_data
  FROM public.expenses e
  WHERE e.id = p_expense_id AND e.business_id = p_business_id;

  -- Build composite key set from new items: "product_id:variant_id_or_null"
  SELECT array_agg(
    (item->>'product_id') || ':' || COALESCE(item->>'variant_id', 'null')
  )
  INTO v_new_keys
  FROM jsonb_array_elements(p_items) AS item
  WHERE (item->>'product_id') IS NOT NULL;

  -- Revert stock/movements for lines being removed
  FOR v_existing IN
    SELECT ei.product_id, ei.variant_id, ei.quantity
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
      AND ei.product_id IS NOT NULL
      AND (
        v_new_keys IS NULL
        OR (ei.product_id::text || ':' || COALESCE(ei.variant_id::text, 'null')) != ALL(v_new_keys)
      )
  LOOP
    IF v_existing.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock = stock - v_existing.quantity
      WHERE id = v_existing.variant_id AND business_id = p_business_id;
    ELSE
      UPDATE public.products
      SET stock = stock - v_existing.quantity
      WHERE id = v_existing.product_id AND business_id = p_business_id;
    END IF;

    DELETE FROM public.inventory_movements
    WHERE reference_id = p_expense_id
      AND product_id = v_existing.product_id
      AND COALESCE(variant_id::text, 'null') = COALESCE(v_existing.variant_id::text, 'null')
      AND business_id = p_business_id;
  END LOOP;

  -- Delete removed expense_items (including null-product_id ones, re-inserted below)
  DELETE FROM public.expense_items
  WHERE expense_id = p_expense_id
    AND (
      product_id IS NULL
      OR v_new_keys IS NULL
      OR (product_id::text || ':' || COALESCE(variant_id::text, 'null')) != ALL(v_new_keys)
    );

  -- Apply each new item
  FOR v_new_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_new_product_id := (v_new_item->>'product_id')::uuid;
    v_new_variant_id := (v_new_item->>'variant_id')::uuid;
    v_new_qty        := (v_new_item->>'quantity')::integer;
    v_new_cost       := (v_new_item->>'unit_cost')::numeric;
    v_new_update     := COALESCE((v_new_item->>'update_cost')::boolean, false);
    v_new_name       := v_new_item->>'product_name';

    IF v_new_product_id IS NULL THEN
      INSERT INTO public.expense_items (
        business_id, expense_id, product_id, variant_id, product_name, quantity, unit_cost, update_cost
      ) VALUES (
        p_business_id, p_expense_id, NULL, NULL, v_new_name, v_new_qty, v_new_cost, v_new_update
      );
      CONTINUE;
    END IF;

    -- Look up surviving row by composite key
    SELECT quantity, unit_cost
    INTO v_old_qty, v_old_cost
    FROM public.expense_items
    WHERE expense_id = p_expense_id
      AND product_id = v_new_product_id
      AND COALESCE(variant_id::text, 'null') = COALESCE(v_new_variant_id::text, 'null');

    IF FOUND THEN
      v_qty_delta := v_new_qty - v_old_qty;

      IF v_qty_delta <> 0 THEN
        IF v_new_variant_id IS NOT NULL THEN
          UPDATE public.product_variants
          SET stock = stock + v_qty_delta
          WHERE id = v_new_variant_id AND business_id = p_business_id;
        ELSE
          UPDATE public.products
          SET stock = stock + v_qty_delta
          WHERE id = v_new_product_id AND business_id = p_business_id;
        END IF;

        UPDATE public.inventory_movements
        SET quantity = v_new_qty
        WHERE reference_id = p_expense_id
          AND product_id = v_new_product_id
          AND COALESCE(variant_id::text, 'null') = COALESCE(v_new_variant_id::text, 'null')
          AND business_id = p_business_id;
      END IF;

      IF v_new_update THEN
        IF v_new_variant_id IS NOT NULL THEN
          SELECT cost INTO v_current_cost
          FROM public.product_variants
          WHERE id = v_new_variant_id AND business_id = p_business_id;
        ELSE
          SELECT cost INTO v_current_cost
          FROM public.products
          WHERE id = v_new_product_id AND business_id = p_business_id;
        END IF;

        IF v_current_cost IS DISTINCT FROM v_old_cost THEN
          v_warnings := v_warnings || jsonb_build_array(
            jsonb_build_object(
              'product_id', v_new_product_id,
              'variant_id', v_new_variant_id,
              'reason',     'cost_changed'
            )
          );
        ELSE
          IF v_new_variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET cost = v_new_cost
            WHERE id = v_new_variant_id AND business_id = p_business_id;
          ELSE
            UPDATE public.products
            SET cost = v_new_cost
            WHERE id = v_new_product_id AND business_id = p_business_id;
          END IF;
        END IF;
      END IF;

      UPDATE public.expense_items
      SET quantity     = v_new_qty,
          unit_cost    = v_new_cost,
          update_cost  = v_new_update,
          product_name = v_new_name
      WHERE expense_id = p_expense_id
        AND product_id = v_new_product_id
        AND COALESCE(variant_id::text, 'null') = COALESCE(v_new_variant_id::text, 'null');

    ELSE
      -- Brand-new item in this expense
      IF v_new_variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = stock + v_new_qty
        WHERE id = v_new_variant_id AND business_id = p_business_id;

        IF v_new_update THEN
          UPDATE public.product_variants
          SET cost = v_new_cost
          WHERE id = v_new_variant_id AND business_id = p_business_id;
        END IF;
      ELSE
        UPDATE public.products
        SET stock = stock + v_new_qty
        WHERE id = v_new_product_id AND business_id = p_business_id;

        IF v_new_update THEN
          UPDATE public.products
          SET cost = v_new_cost
          WHERE id = v_new_product_id AND business_id = p_business_id;
        END IF;
      END IF;

      INSERT INTO public.inventory_movements (
        business_id, product_id, variant_id, type, quantity,
        reason, reference_id
      ) VALUES (
        p_business_id, v_new_product_id, v_new_variant_id, 'purchase', v_new_qty,
        'Compra de mercadería — gasto #' || p_expense_id::text,
        p_expense_id
      );

      INSERT INTO public.expense_items (
        business_id, expense_id, product_id, variant_id, product_name, quantity, unit_cost, update_cost
      ) VALUES (
        p_business_id, p_expense_id, v_new_product_id, v_new_variant_id, v_new_name, v_new_qty, v_new_cost, v_new_update
      );
    END IF;
  END LOOP;

  SELECT COALESCE(sum(quantity * unit_cost), 0)
  INTO v_total
  FROM public.expense_items
  WHERE expense_id = p_expense_id;

  UPDATE public.expenses
  SET
    description = p_description,
    date        = p_date,
    supplier_id = p_supplier_id,
    notes       = p_notes,
    amount      = v_total,
    updated_at  = now()
  WHERE id = p_expense_id AND business_id = p_business_id;

  SELECT to_jsonb(e.*) || jsonb_build_object(
    'items',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',   ei.product_id,
        'variant_id',   ei.variant_id,
        'variant_label', CASE WHEN ei.variant_id IS NOT NULL THEN (
          SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
          FROM public.product_variant_option_values pvov
          JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
          JOIN public.product_options po        ON po.id  = pov.option_id
          WHERE pvov.variant_id = ei.variant_id
        ) END,
        'product_name', ei.product_name,
        'quantity',     ei.quantity,
        'unit_cost',    ei.unit_cost,
        'update_cost',  ei.update_cost
      ) ORDER BY ei.id)
      FROM public.expense_items ei WHERE ei.expense_id = p_expense_id
    ), '[]'::jsonb)
  ) INTO v_new_data
  FROM public.expenses e
  WHERE e.id = p_expense_id AND e.business_id = p_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'expense_updated', 'expense', p_expense_id, p_description,
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'warnings', v_warnings);
END;
$$;


ALTER FUNCTION "public"."update_mercaderia_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid", "p_name" "text" DEFAULT NULL::"text", "p_new_pin" "text" DEFAULT NULL::"text", "p_permissions" "jsonb" DEFAULT NULL::"jsonb") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
  v_old_name           text;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_actor_operator_id IS NOT NULL THEN
    SELECT normalize_permissions(permissions)->>'manage_operators', role INTO v_perm, v_actor_role
    FROM operators
    WHERE id = p_actor_operator_id AND business_id = v_caller_business_id AND is_active = true;

    IF FOUND THEN
      IF v_perm <> 'true' THEN
        RETURN json_build_object('success', false, 'error', '403: Permisos de gestión de operadores insuficientes');
      END IF;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_actor_operator_id AND business_id = v_caller_business_id) THEN
        RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
      END IF;
      v_actor_role := 'owner';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND business_id = v_caller_business_id) THEN
      RETURN json_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT jsonb_build_object(
    'name',        o.name,
    'role',        o.role,
    'permissions', o.permissions,
    'is_active',   o.is_active
  ), o.name INTO v_old_data, v_old_name
  FROM operators o
  WHERE o.id = p_target_operator_id AND o.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'operator_not_found');
  END IF;

  UPDATE operators
  SET
    name        = COALESCE(p_name, name),
    pin         = CASE
                    WHEN p_new_pin IS NOT NULL
                    THEN extensions.crypt(p_new_pin, extensions.gen_salt('bf'))
                    ELSE pin
                  END,
    permissions = CASE
                    WHEN p_permissions IS NOT NULL
                    THEN normalize_permissions(permissions || p_permissions)
                    ELSE permissions
                  END
  WHERE id = p_target_operator_id AND business_id = v_caller_business_id
  RETURNING jsonb_build_object(
    'name',        name,
    'role',        role,
    'permissions', permissions,
    'is_active',   is_active,
    'pin_changed', (p_new_pin IS NOT NULL)
  ) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_actor_operator_id END,
    v_actor_role,
    'operator_updated', 'operator', p_target_operator_id, v_old_name,
    v_old_data, v_new_data
  );

  RETURN json_build_object('success', true);
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$$;


ALTER FUNCTION "public"."update_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid", "p_name" "text", "p_new_pin" "text", "p_permissions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides_upsert" "jsonb" DEFAULT NULL::"jsonb", "p_overrides_delete_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_round_step" numeric DEFAULT NULL::numeric, "p_round_up" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
  v_old_name           text;
  v_upserted           jsonb;
  v_deleted            uuid[];
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  IF p_multiplier IS NULL OR p_multiplier <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El margen debe ser mayor a 0');
  END IF;

  IF p_round_step IS NOT NULL AND p_round_step <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'El redondeo debe ser mayor a 0');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de listas de precios insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(pl.*), pl.name INTO v_old_data, v_old_name
  FROM price_lists pl
  WHERE pl.id = p_price_list_id AND pl.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lista de precios no encontrada');
  END IF;

  UPDATE price_lists SET
    name          = btrim(p_name),
    description   = NULLIF(btrim(p_description), ''),
    multiplier    = p_multiplier,
    rounding_step = p_round_step,
    rounding_up   = COALESCE(p_round_up, false)
  WHERE id = p_price_list_id AND business_id = v_caller_business_id
  RETURNING to_jsonb(price_lists.*) INTO v_new_data;

  IF p_overrides_delete_ids IS NOT NULL AND array_length(p_overrides_delete_ids, 1) > 0 THEN
    WITH del AS (
      DELETE FROM price_list_overrides
      WHERE id = ANY(p_overrides_delete_ids)
        AND price_list_id = p_price_list_id
      RETURNING id
    )
    SELECT array_agg(id) INTO v_deleted FROM del;
  END IF;

  IF p_overrides_upsert IS NOT NULL
     AND jsonb_typeof(p_overrides_upsert) = 'array'
     AND jsonb_array_length(p_overrides_upsert) > 0
  THEN
    WITH ups AS (
      INSERT INTO price_list_overrides (price_list_id, product_id, brand_id, multiplier)
      SELECT
        p_price_list_id,
        (item->>'product_id')::uuid,
        NULL,
        (item->>'multiplier')::numeric
      FROM jsonb_array_elements(p_overrides_upsert) AS item
      WHERE item->>'product_id' IS NOT NULL
        AND item->>'multiplier' IS NOT NULL
      ON CONFLICT (price_list_id, product_id) DO UPDATE
        SET multiplier = EXCLUDED.multiplier
      RETURNING id, price_list_id, product_id, brand_id, multiplier
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(ups.*)), '[]'::jsonb) INTO v_upserted FROM ups;
  ELSE
    v_upserted := '[]'::jsonb;
  END IF;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'price_list_updated', 'price_list', p_price_list_id, btrim(p_name),
    v_old_data,
    jsonb_build_object(
      'list', v_new_data,
      'overrides_upserted', COALESCE(v_upserted, '[]'::jsonb),
      'overrides_deleted',  COALESCE(to_jsonb(v_deleted), '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'upserted_overrides', COALESCE(v_upserted, '[]'::jsonb),
    'deleted_ids', COALESCE(to_jsonb(v_deleted), '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."update_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides_upsert" "jsonb", "p_overrides_delete_ids" "uuid"[], "p_round_step" numeric, "p_round_up" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_old_data           jsonb;
  v_old_name           text;
  v_has_changes        boolean := false;
  v_key                text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin cambios');
  END IF;

  IF p_changes ? 'name' AND (p_changes->>'name' IS NULL OR btrim(p_changes->>'name') = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role
  INTO v_stock_write, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT to_jsonb(p), p.name INTO v_old_data, v_old_name
  FROM products p WHERE p.id = p_product_id AND p.business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_changes)
  LOOP
    IF v_old_data->v_key IS DISTINCT FROM p_changes->v_key THEN
      v_has_changes := true;
      EXIT;
    END IF;
  END LOOP;

  UPDATE products SET
    name            = CASE WHEN p_changes ? 'name'            THEN btrim(p_changes->>'name')                   ELSE name END,
    sku             = CASE WHEN p_changes ? 'sku'             THEN NULLIF(p_changes->>'sku', '')               ELSE sku END,
    barcode         = CASE WHEN p_changes ? 'barcode'         THEN NULLIF(p_changes->>'barcode', '')           ELSE barcode END,
    price           = CASE WHEN p_changes ? 'price'           THEN (p_changes->>'price')::numeric              ELSE price END,
    cost            = CASE WHEN p_changes ? 'cost'            THEN (p_changes->>'cost')::numeric               ELSE cost END,
    stock           = CASE WHEN p_changes ? 'stock'           THEN (p_changes->>'stock')::int                  ELSE stock END,
    min_stock       = CASE WHEN p_changes ? 'min_stock'       THEN (p_changes->>'min_stock')::int              ELSE min_stock END,
    category_id     = CASE WHEN p_changes ? 'category_id'     THEN NULLIF(p_changes->>'category_id', '')::uuid ELSE category_id END,
    brand_id        = CASE WHEN p_changes ? 'brand_id'        THEN NULLIF(p_changes->>'brand_id', '')::uuid    ELSE brand_id END,
    image_url       = CASE WHEN p_changes ? 'image_url'       THEN NULLIF(p_changes->>'image_url', '')         ELSE image_url END,
    image_source    = CASE WHEN p_changes ? 'image_source'    THEN NULLIF(p_changes->>'image_source', '')      ELSE image_source END,
    is_active       = CASE WHEN p_changes ? 'is_active'       THEN (p_changes->>'is_active')::boolean          ELSE is_active END,
    show_in_catalog = CASE WHEN p_changes ? 'show_in_catalog' THEN (p_changes->>'show_in_catalog')::boolean    ELSE show_in_catalog END,
    has_variants    = CASE WHEN p_changes ? 'has_variants'    THEN (p_changes->>'has_variants')::boolean       ELSE has_variants END
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  IF v_has_changes THEN
    PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
      'product_updated', 'product', p_product_id, v_old_name, v_old_data, p_changes);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_options" "jsonb", "p_variants" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_product_name       text;
  v_old_data           jsonb;
  v_new_data           jsonb;
  v_option             jsonb;
  v_option_id          uuid;
  v_value              jsonb;
  v_variant            jsonb;
  v_variant_id         uuid;
  v_ov_id              jsonb;
  v_active_ids         uuid[] := '{}';
  v_active_count       int;
  v_default_variant_id uuid;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role
  INTO v_stock_write, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT name INTO v_product_name
  FROM products
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  IF v_product_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  v_old_data := product_variants_snapshot(v_caller_business_id, p_product_id);

  FOR v_option IN SELECT * FROM jsonb_array_elements(p_options)
  LOOP
    IF (v_option->>'id') IS NOT NULL THEN
      UPDATE product_options
      SET
        attribute_type_id = COALESCE(v_option->>'attribute_type_id', attribute_type_id),
        name              = COALESCE(v_option->>'name', name),
        position          = COALESCE((v_option->>'position')::int, position)
      WHERE id = (v_option->>'id')::uuid AND business_id = v_caller_business_id;

      FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
      LOOP
        IF (v_value->>'id') IS NOT NULL THEN
          UPDATE product_option_values
          SET
            value    = COALESCE(v_value->>'value', value),
            position = COALESCE((v_value->>'position')::int, position)
          WHERE id = (v_value->>'id')::uuid
            AND option_id = (v_option->>'id')::uuid;
        ELSE
          INSERT INTO product_option_values (option_id, value, position)
          VALUES (
            (v_option->>'id')::uuid,
            v_value->>'value',
            COALESCE((v_value->>'position')::int, 0)
          );
        END IF;
      END LOOP;
    ELSE
      INSERT INTO product_options (
        business_id, product_id, attribute_type_id, name, position
      )
      VALUES (
        v_caller_business_id,
        p_product_id,
        v_option->>'attribute_type_id',
        v_option->>'name',
        COALESCE((v_option->>'position')::int, 0)
      )
      RETURNING id INTO v_option_id;

      FOR v_value IN SELECT * FROM jsonb_array_elements(v_option->'values')
      LOOP
        INSERT INTO product_option_values (option_id, value, position)
        VALUES (
          v_option_id,
          v_value->>'value',
          COALESCE((v_value->>'position')::int, 0)
        );
      END LOOP;
    END IF;
  END LOOP;

  FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
  LOOP
    IF (v_variant->>'id') IS NOT NULL THEN
      UPDATE product_variants
      SET
        sku          = NULLIF(v_variant->>'sku', ''),
        barcode      = NULLIF(v_variant->>'barcode', ''),
        price        = COALESCE((v_variant->>'price')::numeric, price),
        cost         = COALESCE((v_variant->>'cost')::numeric, cost),
        stock        = COALESCE((v_variant->>'stock')::int, stock),
        min_stock    = COALESCE((v_variant->>'min_stock')::int, min_stock),
        image_url    = NULLIF(v_variant->>'image_url', ''),
        image_source = NULLIF(v_variant->>'image_source', ''),
        is_active    = COALESCE((v_variant->>'is_active')::boolean, true)
      WHERE id = (v_variant->>'id')::uuid AND business_id = v_caller_business_id;

      v_variant_id := (v_variant->>'id')::uuid;
    ELSE
      INSERT INTO product_variants (
        business_id, product_id, sku, barcode, price, cost,
        stock, min_stock, image_url, image_source, is_active
      )
      VALUES (
        v_caller_business_id,
        p_product_id,
        NULLIF(v_variant->>'sku', ''),
        NULLIF(v_variant->>'barcode', ''),
        COALESCE((v_variant->>'price')::numeric, 0),
        COALESCE((v_variant->>'cost')::numeric, 0),
        COALESCE((v_variant->>'stock')::int, 0),
        COALESCE((v_variant->>'min_stock')::int, 0),
        NULLIF(v_variant->>'image_url', ''),
        NULLIF(v_variant->>'image_source', ''),
        COALESCE((v_variant->>'is_active')::boolean, true)
      )
      RETURNING id INTO v_variant_id;

      FOR v_ov_id IN SELECT * FROM jsonb_array_elements(v_variant->'option_value_ids')
      LOOP
        INSERT INTO product_variant_option_values (variant_id, option_value_id)
        VALUES (v_variant_id, (v_ov_id#>>'{}')::uuid)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;

    v_active_ids := array_append(v_active_ids, v_variant_id);

    IF COALESCE((v_variant->>'is_default')::boolean, false) THEN
      v_default_variant_id := v_variant_id;
    END IF;
  END LOOP;

  UPDATE product_variants
  SET is_active = false
  WHERE product_id   = p_product_id
    AND business_id  = v_caller_business_id
    AND is_active    = true
    AND id <> ALL(v_active_ids);

  SELECT COUNT(*)::int INTO v_active_count
  FROM product_variants
  WHERE product_id  = p_product_id
    AND business_id = v_caller_business_id
    AND is_active   = true;

  UPDATE products
  SET has_variants = (v_active_count > 0)
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  UPDATE products
  SET default_variant_id = COALESCE(
    v_default_variant_id,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM product_variants
        WHERE id = products.default_variant_id
          AND is_active = true
      ) THEN products.default_variant_id
      ELSE (
        SELECT id FROM product_variants
        WHERE product_id  = p_product_id
          AND business_id = v_caller_business_id
          AND is_active   = true
        ORDER BY created_at ASC LIMIT 1
      )
    END
  )
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  v_new_data := product_variants_snapshot(v_caller_business_id, p_product_id);

  IF v_old_data IS DISTINCT FROM v_new_data THEN
    PERFORM log_audit_event(
      p_business_id,
      v_stored_op_id,
      v_actor_role,
      'product_variants_updated',
      'product',
      p_product_id,
      v_product_name,
      v_old_data,
      v_new_data
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'active_variants', v_active_count);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."update_product_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_options" "jsonb", "p_variants" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric DEFAULT NULL::numeric, "p_offer_price" numeric DEFAULT NULL::numeric, "p_group_size" integer DEFAULT NULL::integer, "p_affected_units" integer DEFAULT NULL::integer, "p_pay_percent" numeric DEFAULT NULL::numeric, "p_product_id" "uuid" DEFAULT NULL::"uuid", "p_category_id" "uuid" DEFAULT NULL::"uuid", "p_brand_id" "uuid" DEFAULT NULL::"uuid", "p_starts_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_ends_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_show_in_catalog" boolean DEFAULT true, "p_is_active" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_perm               text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_old                public.promotions%ROWTYPE;
  v_row                public.promotions%ROWTYPE;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role INTO v_perm, v_actor_role
  FROM operators WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;
  IF FOUND THEN
    IF v_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT * INTO v_old FROM promotions
  WHERE id = p_promotion_id AND business_id = v_caller_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promoción no encontrada');
  END IF;
  IF v_old.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No se puede editar una promoción archivada');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;
  IF p_kind NOT IN ('percent', 'offer_price', 'quantity') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tipo de promoción inválido');
  END IF;
  IF (p_product_id IS NOT NULL)::int + (p_category_id IS NOT NULL)::int + (p_brand_id IS NOT NULL)::int <> 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'La promoción debe tener exactamente un alcance (producto, categoría o marca)');
  END IF;
  IF p_kind = 'percent' AND (p_percent IS NULL OR p_percent <= 0 OR p_percent > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'El porcentaje debe estar entre 0 y 100');
  END IF;
  IF p_kind = 'offer_price' THEN
    IF p_offer_price IS NULL OR p_offer_price <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta debe ser mayor a 0');
    END IF;
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'El precio de oferta requiere un producto específico');
    END IF;
  END IF;
  IF p_kind = 'quantity' THEN
    IF p_product_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Las promos por cantidad requieren un producto específico');
    END IF;
    IF p_group_size IS NULL OR p_group_size < 2 OR p_group_size > 100
       OR p_affected_units IS NULL OR p_affected_units < 1 OR p_affected_units >= p_group_size
       OR p_pay_percent IS NULL OR p_pay_percent < 0 OR p_pay_percent >= 100 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Configuración de cantidad inválida');
    END IF;
  END IF;
  IF p_starts_at IS NOT NULL AND p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'La fecha de fin debe ser posterior a la de inicio');
  END IF;

  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM products WHERE id = p_product_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = p_category_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Categoría no encontrada');
  END IF;
  IF p_brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands WHERE id = p_brand_id AND business_id = v_caller_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Marca no encontrada');
  END IF;

  UPDATE promotions SET
    name            = btrim(p_name),
    kind            = p_kind,
    percent         = CASE WHEN p_kind = 'percent' THEN p_percent END,
    offer_price     = CASE WHEN p_kind = 'offer_price' THEN p_offer_price END,
    group_size      = CASE WHEN p_kind = 'quantity' THEN p_group_size END,
    affected_units  = CASE WHEN p_kind = 'quantity' THEN p_affected_units END,
    pay_percent     = CASE WHEN p_kind = 'quantity' THEN p_pay_percent END,
    product_id      = p_product_id,
    category_id     = p_category_id,
    brand_id        = p_brand_id,
    starts_at       = p_starts_at,
    ends_at         = p_ends_at,
    show_in_catalog = COALESCE(p_show_in_catalog, true),
    is_active       = COALESCE(p_is_active, true),
    updated_at      = now()
  WHERE id = p_promotion_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
    'promotion_updated', 'promotion', v_row.id, v_row.name, to_jsonb(v_old), to_jsonb(v_row));

  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;


ALTER FUNCTION "public"."update_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean, "p_is_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_operator_id" "uuid", "p_status" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."update_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_operator_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_stock_on_sale"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.variant_id IS NOT NULL THEN
    UPDATE product_variants
    SET stock = stock - NEW.quantity
    WHERE id = NEW.variant_id;

    UPDATE products
    SET sales_count = sales_count + NEW.quantity
    WHERE id = NEW.product_id;
  ELSE
    UPDATE products
    SET
      stock       = stock - NEW.quantity,
      sales_count = sales_count + NEW.quantity
    WHERE id = NEW.product_id;
  END IF;

  INSERT INTO inventory_movements (
    business_id, product_id, variant_id, type, quantity, reason, reference_id
  )
  SELECT s.business_id, NEW.product_id, NEW.variant_id, 'sale', -NEW.quantity, 'Venta', NEW.sale_id
  FROM sales s
  WHERE s.id = NEW.sale_id;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_stock_on_sale"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid", "p_name" "text", "p_contact_name" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_address" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_caller_business_id uuid;
  v_expenses_perm      text;
  v_actor_role         text;
  v_old_data           jsonb;
  v_new_data           jsonb;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT permissions->>'expenses', role INTO v_expenses_perm, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_expenses_perm <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de gastos insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(s.*) INTO v_old_data
  FROM suppliers s
  WHERE s.id = p_supplier_id AND s.business_id = v_caller_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Proveedor no encontrado');
  END IF;

  UPDATE suppliers SET
    name         = btrim(p_name),
    contact_name = NULLIF(btrim(p_contact_name), ''),
    phone        = NULLIF(btrim(p_phone), ''),
    email        = NULLIF(btrim(p_email), ''),
    address      = NULLIF(btrim(p_address), ''),
    notes        = NULLIF(btrim(p_notes), '')
  WHERE id = p_supplier_id AND business_id = v_caller_business_id
  RETURNING to_jsonb(suppliers.*) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'supplier_updated', 'supplier', p_supplier_id, btrim(p_name),
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."update_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_snapshot_row public.daily_snapshots%ROWTYPE;
  v_timezone     text;
BEGIN
  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  WITH sales_base AS (
    SELECT
      COUNT(*)::integer AS sales_count,
      COALESCE(SUM(s.subtotal), 0) AS gross_revenue,
      COALESCE(SUM(s.discount), 0) AS discounts_total,
      COALESCE(SUM(s.total), 0) AS net_revenue,
      COALESCE(AVG(s.total), 0) AS avg_ticket,
      COUNT(DISTINCT s.customer_id) FILTER (WHERE s.customer_id IS NOT NULL)::integer AS customers_count
    FROM public.sales s
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
  ),
  item_stats AS (
    SELECT
      COALESCE(SUM(si.quantity), 0)::integer AS items_sold,
      COALESCE(SUM(si.promo_discount), 0) AS promo_discounts_total,
      COUNT(DISTINCT s.id) FILTER (WHERE si.promotion_id IS NOT NULL)::integer AS promo_sales_count
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
  ),
  expense_stats AS (
    SELECT
      COALESCE(SUM(e.amount), 0) AS expenses_total,
      COALESCE(SUM(e.amount) FILTER (WHERE e.category <> 'mercaderia'), 0) AS operating_expenses_total,
      COALESCE(SUM(e.amount) FILTER (WHERE e.category = 'mercaderia'), 0) AS inventory_expenses_total
    FROM public.expenses e
    WHERE e.business_id = p_business_id
      AND e.date = p_snapshot_date
  ),
  top_product AS (
    SELECT
      si.product_id AS top_product_id,
      MAX(p.name) AS top_product_name,
      SUM(si.quantity)::integer AS top_product_units,
      COALESCE(SUM(si.total), 0) AS top_product_revenue
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE s.business_id = p_business_id
      AND s.status = 'completed'
      AND (s.created_at AT TIME ZONE v_timezone)::date = p_snapshot_date
      AND si.product_id IS NOT NULL
    GROUP BY si.product_id
    ORDER BY SUM(si.quantity) DESC, SUM(si.total) DESC, si.product_id
    LIMIT 1
  )
  INSERT INTO public.daily_snapshots (
    business_id,
    snapshot_date,
    sales_count,
    items_sold,
    gross_revenue,
    discounts_total,
    net_revenue,
    avg_ticket,
    customers_count,
    expenses_total,
    operating_expenses_total,
    inventory_expenses_total,
    top_product_id,
    top_product_name,
    top_product_units,
    top_product_revenue,
    promo_discounts_total,
    promo_sales_count,
    updated_at
  )
  SELECT
    p_business_id,
    p_snapshot_date,
    sb.sales_count,
    ist.items_sold,
    sb.gross_revenue,
    sb.discounts_total,
    sb.net_revenue,
    sb.avg_ticket,
    sb.customers_count,
    es.expenses_total,
    es.operating_expenses_total,
    es.inventory_expenses_total,
    tp.top_product_id,
    tp.top_product_name,
    COALESCE(tp.top_product_units, 0),
    COALESCE(tp.top_product_revenue, 0),
    ist.promo_discounts_total,
    ist.promo_sales_count,
    now()
  FROM sales_base sb
  CROSS JOIN item_stats ist
  CROSS JOIN expense_stats es
  LEFT JOIN top_product tp ON true
  ON CONFLICT (business_id, snapshot_date) DO UPDATE
  SET
    sales_count              = EXCLUDED.sales_count,
    items_sold               = EXCLUDED.items_sold,
    gross_revenue            = EXCLUDED.gross_revenue,
    discounts_total          = EXCLUDED.discounts_total,
    net_revenue              = EXCLUDED.net_revenue,
    avg_ticket               = EXCLUDED.avg_ticket,
    customers_count          = EXCLUDED.customers_count,
    expenses_total           = EXCLUDED.expenses_total,
    operating_expenses_total = EXCLUDED.operating_expenses_total,
    inventory_expenses_total = EXCLUDED.inventory_expenses_total,
    top_product_id           = EXCLUDED.top_product_id,
    top_product_name         = EXCLUDED.top_product_name,
    top_product_units        = EXCLUDED.top_product_units,
    top_product_revenue      = EXCLUDED.top_product_revenue,
    promo_discounts_total    = EXCLUDED.promo_discounts_total,
    promo_sales_count        = EXCLUDED.promo_sales_count,
    updated_at               = now()
  RETURNING * INTO v_snapshot_row;

  RETURN jsonb_build_object(
    'success', true,
    'data', to_jsonb(v_snapshot_row)
  );
END;
$$;


ALTER FUNCTION "public"."upsert_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_session_digital_balance"("p_session_id" "uuid", "p_method" "text", "p_opening_balance" numeric DEFAULT NULL::numeric, "p_closing_balance" numeric DEFAULT NULL::numeric, "p_operator_id" "uuid" DEFAULT NULL::"uuid") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT cs.business_id INTO v_business_id
  FROM cash_sessions cs
  WHERE cs.id = p_session_id
    AND cs.business_id = get_business_id();

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Sesión no encontrada');
  END IF;

  INSERT INTO session_digital_balances (
    business_id, session_id, method, opening_balance, closing_balance, entered_by, updated_at
  )
  VALUES (
    v_business_id, p_session_id, p_method, p_opening_balance, p_closing_balance, p_operator_id, now()
  )
  ON CONFLICT (session_id, method) DO UPDATE SET
    opening_balance = COALESCE(EXCLUDED.opening_balance, session_digital_balances.opening_balance),
    closing_balance = COALESCE(EXCLUDED.closing_balance, session_digital_balances.closing_balance),
    entered_by      = COALESCE(EXCLUDED.entered_by, session_digital_balances.entered_by),
    updated_at      = now();

  RETURN json_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."upsert_session_digital_balance"("p_session_id" "uuid", "p_method" "text", "p_opening_balance" numeric, "p_closing_balance" numeric, "p_operator_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_operator_pin"("p_business_id" "uuid", "p_operator_id" "uuid", "p_pin" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_operator      operators%rowtype;
  v_max_attempts  constant integer := 5;
  v_lock_minutes  constant integer := 15;
  v_attempts      integer;
  v_locked_until  timestamptz;
begin
  perform public.assert_tenant(p_business_id);

  select * into v_operator
  from operators
  where id = p_operator_id
    and business_id = p_business_id
    and is_active = true;

  if not found then
    return json_build_object('success', false, 'error', 'Operador no encontrado');
  end if;

  if v_operator.pin_locked_until is not null and v_operator.pin_locked_until > now() then
    return json_build_object(
      'success', false,
      'locked', true,
      'locked_until', v_operator.pin_locked_until,
      'error', 'Demasiados intentos fallidos. Intenta nuevamente en unos minutos.'
    );
  end if;

  if v_operator.pin != extensions.crypt(p_pin, v_operator.pin) then
    v_attempts := coalesce(v_operator.failed_pin_attempts, 0) + 1;
    v_locked_until := case
      when v_attempts >= v_max_attempts then now() + make_interval(mins => v_lock_minutes)
      else null
    end;

    update operators
       set failed_pin_attempts = v_attempts,
           pin_locked_until    = v_locked_until
     where id = v_operator.id;

    if v_locked_until is not null then
      return json_build_object(
        'success', false,
        'locked', true,
        'locked_until', v_locked_until,
        'error', 'Demasiados intentos fallidos. Intenta nuevamente en unos minutos.'
      );
    end if;

    return json_build_object('success', false, 'error', 'PIN incorrecto');
  end if;

  if coalesce(v_operator.failed_pin_attempts, 0) <> 0 or v_operator.pin_locked_until is not null then
    update operators set failed_pin_attempts = 0, pin_locked_until = null where id = v_operator.id;
  end if;

  return json_build_object(
    'success', true,
    'profile_id', v_operator.id,
    'name', v_operator.name,
    'role', v_operator.role,
    'permissions', v_operator.permissions
  );
end;
$$;


ALTER FUNCTION "public"."verify_operator_pin"("p_business_id" "uuid", "p_operator_id" "uuid", "p_pin" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."attribute_types" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."attribute_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "operator_id" "uuid",
    "actor_role" "text" NOT NULL,
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "entity_label" "text",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_actor_role_check" CHECK (("actor_role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'cashier'::"text", 'custom'::"text", 'customer'::"text"]))),
    CONSTRAINT "audit_log_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['sale'::"text", 'product'::"text", 'category'::"text", 'brand'::"text", 'expense'::"text", 'supplier'::"text", 'price_list'::"text", 'setting'::"text", 'operator'::"text", 'customer'::"text", 'catalog_order'::"text", 'promotion'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_insights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "severity" "text" NOT NULL,
    "target_entity_type" "text" NOT NULL,
    "target_entity_id" "text",
    "surface" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "rationale" "jsonb" NOT NULL,
    "source_model" "text",
    CONSTRAINT "ai_insights_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'seen'::"text", 'dismissed'::"text", 'acted'::"text"]))),
    CONSTRAINT "ai_insights_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'opportunity'::"text", 'anomaly'::"text"]))),
    CONSTRAINT "ai_insights_target_entity_type_check" CHECK (("target_entity_type" = ANY (ARRAY['product'::"text", 'payment'::"text", 'customer'::"text", 'supplier'::"text", 'stock'::"text", 'channel'::"text", 'global'::"text"]))),
    CONSTRAINT "ai_insights_surface_check" CHECK (("surface" = ANY (ARRAY['inventory_row'::"text", 'inventory'::"text", 'stats'::"text", 'dashboard'::"text", 'cash_close'::"text", 'pos'::"text", 'customers'::"text", 'suppliers'::"text", 'expenses'::"text", 'orders'::"text", 'global'::"text"])))
);


ALTER TABLE "public"."ai_insights" OWNER TO "postgres";


COMMENT ON TABLE "public"."ai_insights" IS 'Sugerencias de la IA proactiva (P12). rationale jsonb es obligatorio (porque X,Y,Z con numeros). target_entity_id es polimorfico (uuid|codigo|null), sin FK. status alimenta anti-repeticion.';


CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."businesses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "settings" "jsonb" DEFAULT '{"currency": "ARS"}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "whatsapp" "text",
    "logo_url" "text",
    "description" "text",
    "country_code" "text",
    "tax_id" "text",
    "timezone" "text" DEFAULT 'America/Argentina/Buenos_Aires'::"text" NOT NULL,
    "catalog_orders_read_at" timestamp with time zone,
    CONSTRAINT "businesses_country_code_check" CHECK ((("country_code" IS NULL) OR ("country_code" = ANY (ARRAY['AR'::"text", 'MX'::"text", 'CO'::"text", 'UY'::"text"])))),
    CONSTRAINT "businesses_slug_format" CHECK (("slug" ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'::"text"))
);


ALTER TABLE "public"."businesses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."businesses"."settings" IS 'Configuración del negocio. Keys soportadas: currency (ISO 4217: ARS|USD|EUR|BRL|CLP|UYU|PEN|COP|MXN|PYG|BOB), logo_upload_path (path en storage para logo subido), ai_insights_enabled (boolean, opt-in de la IA proactiva P12 — feature de plan pago)';



CREATE TABLE IF NOT EXISTS "public"."cash_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "opened_by" "uuid",
    "closed_by" "uuid",
    "opening_amount" numeric(12,2) DEFAULT 0,
    "closing_amount" numeric(12,2),
    "expected_amount" numeric(12,2),
    "opened_at" timestamp with time zone DEFAULT "now"(),
    "closed_at" timestamp with time zone,
    "notes" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    CONSTRAINT "cash_sessions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."cash_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_order_counters" (
    "business_id" "uuid" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."catalog_order_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "product_name" "text" NOT NULL,
    "variant_id" "uuid",
    "variant_label" "text",
    "quantity" integer NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "line_total" numeric(12,2) NOT NULL,
    "image_url" "text",
    "promotion_id" "uuid",
    "promo_discount" numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT "catalog_order_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."catalog_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "order_number" integer NOT NULL,
    "customer_name" "text" NOT NULL,
    "customer_phone" "text" NOT NULL,
    "delivery_type" "text" NOT NULL,
    "address" "text",
    "notes" "text",
    "subtotal" numeric(12,2) NOT NULL,
    "total" numeric(12,2) NOT NULL,
    "status" "text" DEFAULT 'recibido'::"text" NOT NULL,
    "sale_id" "uuid",
    "client_ip" "inet",
    "accepted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "catalog_orders_address_required" CHECK ((("delivery_type" <> 'delivery'::"text") OR (("address" IS NOT NULL) AND ("btrim"("address") <> ''::"text")))),
    CONSTRAINT "catalog_orders_delivery_type_check" CHECK (("delivery_type" = ANY (ARRAY['takeaway'::"text", 'delivery'::"text"]))),
    CONSTRAINT "catalog_orders_status_check" CHECK (("status" = ANY (ARRAY['recibido'::"text", 'aceptado'::"text", 'en_camino'::"text", 'listo_retiro'::"text", 'completado'::"text", 'rechazado'::"text", 'cancelado'::"text"])))
);


ALTER TABLE "public"."catalog_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalog_phone_blacklist" (
    "business_id" "uuid" NOT NULL,
    "phone" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."catalog_phone_blacklist" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "name" "text" NOT NULL,
    "icon" "text" DEFAULT 'Tag'::"text",
    "position" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "icon_color" "text" DEFAULT '#7a3e10'::"text"
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


COMMENT ON COLUMN "public"."categories"."icon" IS 'Lucide icon name (PascalCase, e.g. "ShoppingCart"). Legacy emoji values are still supported by the UI.';



COMMENT ON COLUMN "public"."categories"."icon_color" IS 'Hex color applied to the Lucide icon. Defaults to Pulsar brand brown.';



CREATE TABLE IF NOT EXISTS "public"."customer_account_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "method" "text",
    "sale_id" "uuid",
    "operator_id" "uuid",
    "balance_after" numeric NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_id" "uuid",
    CONSTRAINT "customer_account_movements_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "customer_account_movements_method_check" CHECK (("method" = ANY (ARRAY['cash'::"text", 'card'::"text", 'transfer'::"text"]))),
    CONSTRAINT "customer_account_movements_type_check" CHECK (("type" = ANY (ARRAY['charge'::"text", 'payment'::"text", 'opening'::"text"])))
);


ALTER TABLE "public"."customer_account_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "dni" "text",
    "credit_balance" numeric(12,2) DEFAULT 0,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "credit_limit" numeric DEFAULT 0 NOT NULL,
    "is_credit_enabled" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "sales_count" integer DEFAULT 0 NOT NULL,
    "items_sold" integer DEFAULT 0 NOT NULL,
    "gross_revenue" numeric DEFAULT 0 NOT NULL,
    "discounts_total" numeric DEFAULT 0 NOT NULL,
    "net_revenue" numeric DEFAULT 0 NOT NULL,
    "avg_ticket" numeric DEFAULT 0 NOT NULL,
    "customers_count" integer DEFAULT 0 NOT NULL,
    "expenses_total" numeric DEFAULT 0 NOT NULL,
    "operating_expenses_total" numeric DEFAULT 0 NOT NULL,
    "inventory_expenses_total" numeric DEFAULT 0 NOT NULL,
    "top_product_id" "uuid",
    "top_product_name" "text",
    "top_product_units" integer DEFAULT 0 NOT NULL,
    "top_product_revenue" numeric DEFAULT 0 NOT NULL,
    "promo_discounts_total" numeric DEFAULT 0 NOT NULL,
    "promo_sales_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."daily_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expense_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "expense_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "product_name" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "unit_cost" numeric NOT NULL,
    "subtotal" numeric GENERATED ALWAYS AS ((("quantity")::numeric * "unit_cost")) STORED,
    "update_cost" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "variant_id" "uuid",
    CONSTRAINT "expense_items_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "expense_items_unit_cost_check" CHECK (("unit_cost" >= (0)::numeric))
);


ALTER TABLE "public"."expense_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "operator_id" "uuid",
    "supplier_id" "uuid",
    "category" "public"."expense_category" DEFAULT 'otro'::"public"."expense_category" NOT NULL,
    "amount" numeric NOT NULL,
    "description" "text" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "attachment_url" "text",
    "attachment_type" "public"."expense_attachment_type",
    "attachment_name" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expenses_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "operator_id" "uuid",
    "type" "text" NOT NULL,
    "message" "text" NOT NULL,
    "contact_email" "text",
    "route" "text",
    "user_agent" "text",
    "attachment_path" "text",
    "github_issue_url" "text",
    "telegram_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feedback_message_check" CHECK ((("char_length"("message") >= 10) AND ("char_length"("message") <= 1000))),
    CONSTRAINT "feedback_type_check" CHECK (("type" = ANY (ARRAY['bug'::"text", 'sugerencia'::"text", 'otro'::"text"])))
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "product_id" "uuid",
    "type" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "reason" "text",
    "reference_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by_operator" "uuid",
    "variant_id" "uuid",
    CONSTRAINT "inventory_movements_type_check" CHECK (("type" = ANY (ARRAY['sale'::"text", 'purchase'::"text", 'adjustment'::"text", 'return'::"text"])))
);


ALTER TABLE "public"."inventory_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" DEFAULT 'cashier'::"text" NOT NULL,
    "pin" "text" NOT NULL,
    "permissions" "jsonb" DEFAULT '{"online_orders": true, "pos_pricing": false, "inventory_read": false, "inventory_write": false, "reports": false, "expenses": false, "settings": false, "manage_operators": false}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "failed_pin_attempts" integer DEFAULT 0 NOT NULL,
    "pin_locked_until" timestamp with time zone,
    CONSTRAINT "operators_role_check" CHECK (("role" = ANY (ARRAY['cashier'::"text", 'manager'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."operators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "method" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "reference" "text",
    "status" "text" DEFAULT 'completed'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "payments_method_check" CHECK (("method" = ANY (ARRAY['cash'::"text", 'card'::"text", 'transfer'::"text", 'mercadopago'::"text", 'credit'::"text"]))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['completed'::"text", 'pending'::"text", 'refunded'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_list_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "price_list_id" "uuid" NOT NULL,
    "product_id" "uuid",
    "multiplier" numeric(6,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "brand_id" "uuid",
    CONSTRAINT "override_target" CHECK (((("product_id" IS NOT NULL) AND ("brand_id" IS NULL)) OR (("product_id" IS NULL) AND ("brand_id" IS NOT NULL))))
);


ALTER TABLE "public"."price_list_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "multiplier" numeric(6,4) DEFAULT 1.0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rounding_step" numeric,
    "rounding_up" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."price_lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_option_values" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "option_id" "uuid" NOT NULL,
    "value" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."product_option_values" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "attribute_type_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."product_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_variant_option_values" (
    "variant_id" "uuid" NOT NULL,
    "option_value_id" "uuid" NOT NULL
);


ALTER TABLE "public"."product_variant_option_values" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_variants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "sku" "text",
    "barcode" "text",
    "price" numeric DEFAULT 0 NOT NULL,
    "cost" numeric DEFAULT 0 NOT NULL,
    "stock" integer DEFAULT 0 NOT NULL,
    "min_stock" integer DEFAULT 0 NOT NULL,
    "image_url" "text",
    "image_source" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_variants_image_source_check" CHECK (("image_source" = ANY (ARRAY['upload'::"text", 'url'::"text"])))
);


ALTER TABLE "public"."product_variants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "category_id" "uuid",
    "name" "text" NOT NULL,
    "sku" "text",
    "barcode" "text",
    "price" numeric(12,2) DEFAULT 0 NOT NULL,
    "cost" numeric(12,2) DEFAULT 0,
    "stock" integer DEFAULT 0 NOT NULL,
    "min_stock" integer DEFAULT 0,
    "image_url" "text",
    "is_active" boolean DEFAULT true,
    "show_in_catalog" boolean DEFAULT true,
    "sales_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brand_id" "uuid",
    "image_source" "text",
    "has_variants" boolean DEFAULT false NOT NULL,
    "default_variant_id" "uuid",
    CONSTRAINT "products_image_consistency" CHECK (((("image_url" IS NULL) AND ("image_source" IS NULL)) OR (("image_url" IS NOT NULL) AND ("image_source" IS NOT NULL)))),
    CONSTRAINT "products_image_source_check" CHECK (("image_source" = ANY (ARRAY['upload'::"text", 'url'::"text"])))
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "business_id" "uuid",
    "role" "text" DEFAULT 'cashier'::"text" NOT NULL,
    "name" "text" NOT NULL,
    "pin" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "avatar_url" "text",
    "onboarding_state" "jsonb" DEFAULT '{"completed": false, "tour_done": false, "steps_done": [], "wizard_step": 0}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."onboarding_state" IS 'Estado del onboarding del owner. Keys: completed (bool), wizard_step (int 0-4), steps_done (array de strings: business_info|category|product|operator), tour_done (bool)';



CREATE TABLE IF NOT EXISTS "public"."promotions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "percent" numeric,
    "offer_price" numeric,
    "group_size" integer,
    "affected_units" integer,
    "pay_percent" numeric,
    "product_id" "uuid",
    "category_id" "uuid",
    "brand_id" "uuid",
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "show_in_catalog" boolean DEFAULT true NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "promotions_kind_check" CHECK (("kind" = ANY (ARRAY['percent'::"text", 'offer_price'::"text", 'quantity'::"text"]))),
    CONSTRAINT "promotions_scope_one" CHECK ((((("product_id" IS NOT NULL))::integer + (("category_id" IS NOT NULL))::integer + (("brand_id" IS NOT NULL))::integer) = 1)),
    CONSTRAINT "promotions_kind_fields" CHECK (
        ((("kind" = 'percent'::"text") AND ("percent" IS NOT NULL) AND ("percent" > (0)::numeric) AND ("percent" <= (100)::numeric))
        OR (("kind" = 'offer_price'::"text") AND ("offer_price" IS NOT NULL) AND ("offer_price" > (0)::numeric) AND ("product_id" IS NOT NULL))
        OR (("kind" = 'quantity'::"text") AND ("group_size" IS NOT NULL) AND ("group_size" >= 2) AND ("group_size" <= 100)
            AND ("affected_units" IS NOT NULL) AND ("affected_units" >= 1) AND ("affected_units" <= ("group_size" - 1))
            AND ("pay_percent" IS NOT NULL) AND ("pay_percent" >= (0)::numeric) AND ("pay_percent" < (100)::numeric)
            AND ("product_id" IS NOT NULL)))),
    CONSTRAINT "promotions_date_range" CHECK ((("starts_at" IS NULL) OR ("ends_at" IS NULL) OR ("ends_at" > "starts_at")))
);


ALTER TABLE "public"."promotions" OWNER TO "postgres";


COMMENT ON TABLE "public"."promotions" IS 'Promos/ofertas (plan: docs/todo/promotions.md). Una promo = un target (producto XOR categoría XOR marca). Vigente = is_active AND archived_at IS NULL AND now() en [starts_at, ends_at]. show_in_catalog solo controla la sección Ofertas del catálogo; el precio aplica siempre. Usadas en ventas se archivan, no se borran.';



CREATE TABLE IF NOT EXISTS "public"."sale_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid",
    "product_id" "uuid",
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "total" numeric(12,2) NOT NULL,
    "unit_price_override" numeric,
    "override_reason" "text",
    "free_line_description" "text",
    "variant_id" "uuid",
    "promotion_id" "uuid",
    "promo_discount" numeric(12,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."sale_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid",
    "session_id" "uuid",
    "customer_id" "uuid",
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount" numeric(12,2) DEFAULT 0,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'completed'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "price_list_id" "uuid",
    "operator_id" "uuid",
    "source" "text" DEFAULT 'pos'::"text" NOT NULL,
    CONSTRAINT "sales_source_check" CHECK (("source" = ANY (ARRAY['pos'::"text", 'catalog'::"text"]))),
    CONSTRAINT "sales_status_check" CHECK (("status" = ANY (ARRAY['completed'::"text", 'cancelled'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_digital_balances" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "method" "text" NOT NULL,
    "opening_balance" numeric(12,2),
    "closing_balance" numeric(12,2),
    "entered_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_digital_balances_method_check" CHECK (("method" = ANY (ARRAY['mercadopago'::"text", 'transfer'::"text"])))
);


ALTER TABLE "public"."session_digital_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "provider" "text",
    "external_id" "text",
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'enterprise'::"text"]))),
    CONSTRAINT "subscriptions_provider_check" CHECK ((("provider" IS NULL) OR ("provider" = ANY (ARRAY['stripe'::"text", 'mercadopago'::"text"])))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'cancelled'::"text", 'trialing'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "contact_name" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."attribute_types"
    ADD CONSTRAINT "attribute_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_insights"
    ADD CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."businesses"
    ADD CONSTRAINT "businesses_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_order_counters"
    ADD CONSTRAINT "catalog_order_counters_pkey" PRIMARY KEY ("business_id");



ALTER TABLE ONLY "public"."catalog_order_items"
    ADD CONSTRAINT "catalog_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_orders"
    ADD CONSTRAINT "catalog_orders_business_order_number_unique" UNIQUE ("business_id", "order_number");



ALTER TABLE ONLY "public"."catalog_orders"
    ADD CONSTRAINT "catalog_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalog_phone_blacklist"
    ADD CONSTRAINT "catalog_phone_blacklist_pkey" PRIMARY KEY ("business_id", "phone");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_account_movements"
    ADD CONSTRAINT "customer_account_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_snapshots"
    ADD CONSTRAINT "daily_snapshots_business_date_key" UNIQUE ("business_id", "snapshot_date");



ALTER TABLE ONLY "public"."daily_snapshots"
    ADD CONSTRAINT "daily_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_items"
    ADD CONSTRAINT "expense_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operators"
    ADD CONSTRAINT "operators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_list_overrides"
    ADD CONSTRAINT "price_list_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_lists"
    ADD CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_option_values"
    ADD CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_options"
    ADD CONSTRAINT "product_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_variant_option_values"
    ADD CONSTRAINT "product_variant_option_values_pkey" PRIMARY KEY ("variant_id", "option_value_id");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_pkey" PRIMARY KEY ("id");


-- Definida aquí (no en la sección de funciones) porque RETURNS public.promotions
-- exige que la tabla promotions ya exista. Espejo TS: findApplicablePromo (src/lib/promotions.ts).
CREATE OR REPLACE FUNCTION "public"."find_applicable_promotion"("p_business_id" "uuid", "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_at" timestamp with time zone DEFAULT "now"()) RETURNS "public"."promotions"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
-- Promo vigente más aplicable para un producto. Resolución determinística: más específica
-- gana (producto > categoría > marca); a igual especificidad, la más reciente. Sin stacking.
-- Sin guard de tenant: helper del path del catálogo público (como compute_effective_price).
  SELECT pr.*
  FROM public.promotions pr
  WHERE pr.business_id = p_business_id
    AND pr.is_active = true
    AND pr.archived_at IS NULL
    AND (pr.starts_at IS NULL OR pr.starts_at <= p_at)
    AND (pr.ends_at IS NULL OR pr.ends_at >= p_at)
    AND (
      (pr.product_id IS NOT NULL AND pr.product_id = p_product_id)
      OR (pr.category_id IS NOT NULL AND pr.category_id = p_category_id)
      OR (pr.brand_id IS NOT NULL AND pr.brand_id = p_brand_id)
    )
  ORDER BY
    CASE
      WHEN pr.product_id IS NOT NULL THEN 0
      WHEN pr.category_id IS NOT NULL THEN 1
      ELSE 2
    END,
    pr.created_at DESC
  LIMIT 1;
$$;


ALTER FUNCTION "public"."find_applicable_promotion"("p_business_id" "uuid", "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_at" timestamp with time zone) OWNER TO "postgres";



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_digital_balances"
    ADD CONSTRAINT "session_digital_balances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_digital_balances"
    ADD CONSTRAINT "session_digital_balances_session_id_method_key" UNIQUE ("session_id", "method");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_business_id_key" UNIQUE ("business_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "unique_barcode_per_business" UNIQUE ("business_id", "barcode");



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "unique_brand_per_business" UNIQUE ("business_id", "name");



ALTER TABLE ONLY "public"."price_list_overrides"
    ADD CONSTRAINT "unique_override_per_list_brand_id" UNIQUE ("price_list_id", "brand_id");



ALTER TABLE ONLY "public"."price_list_overrides"
    ADD CONSTRAINT "unique_override_per_list_product" UNIQUE ("price_list_id", "product_id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "unique_sku_per_business" UNIQUE ("business_id", "sku");



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "uq_variant_barcode" UNIQUE ("business_id", "barcode") DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "uq_variant_sku" UNIQUE ("business_id", "sku") DEFERRABLE INITIALLY DEFERRED;



CREATE INDEX "audit_log_business_created_idx" ON "public"."audit_log" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "audit_log_business_entity_created_idx" ON "public"."audit_log" USING "btree" ("business_id", "entity_type", "created_at" DESC);



CREATE INDEX "ai_insights_business_status_created_idx" ON "public"."ai_insights" USING "btree" ("business_id", "status", "created_at" DESC);



CREATE INDEX "ai_insights_business_surface_status_idx" ON "public"."ai_insights" USING "btree" ("business_id", "surface", "status");



CREATE INDEX "ai_insights_business_target_idx" ON "public"."ai_insights" USING "btree" ("business_id", "target_entity_type", "target_entity_id");



CREATE INDEX "catalog_order_items_order_idx" ON "public"."catalog_order_items" USING "btree" ("order_id");



CREATE INDEX "catalog_orders_business_created_idx" ON "public"."catalog_orders" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "catalog_orders_business_phone_created_idx" ON "public"."catalog_orders" USING "btree" ("business_id", "customer_phone", "created_at" DESC);



CREATE INDEX "catalog_orders_business_status_idx" ON "public"."catalog_orders" USING "btree" ("business_id", "status");



CREATE INDEX "customers_active_idx" ON "public"."customers" USING "btree" ("business_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "daily_snapshots_business_date_idx" ON "public"."daily_snapshots" USING "btree" ("business_id", "snapshot_date" DESC);



CREATE INDEX "daily_snapshots_snapshot_date_idx" ON "public"."daily_snapshots" USING "btree" ("snapshot_date" DESC);



CREATE INDEX "feedback_business_created_idx" ON "public"."feedback" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "feedback_created_idx" ON "public"."feedback" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_cam_business_customer_created" ON "public"."customer_account_movements" USING "btree" ("business_id", "customer_id", "created_at");



CREATE INDEX "idx_cam_operator_id" ON "public"."customer_account_movements" USING "btree" ("operator_id");



CREATE INDEX "idx_cam_sale_id" ON "public"."customer_account_movements" USING "btree" ("sale_id");



CREATE INDEX "idx_cam_session_id" ON "public"."customer_account_movements" USING "btree" ("session_id");



CREATE INDEX "idx_cash_sessions_business_id" ON "public"."cash_sessions" USING "btree" ("business_id");



CREATE INDEX "idx_cash_sessions_business_opened_at" ON "public"."cash_sessions" USING "btree" ("business_id", "opened_at" DESC);



CREATE INDEX "idx_cash_sessions_closed_by" ON "public"."cash_sessions" USING "btree" ("closed_by");



CREATE UNIQUE INDEX "idx_cash_sessions_one_open_per_business" ON "public"."cash_sessions" USING "btree" ("business_id") WHERE ("status" = 'open'::"text");



CREATE INDEX "idx_cash_sessions_opened_by" ON "public"."cash_sessions" USING "btree" ("opened_by");



CREATE INDEX "idx_catalog_order_items_product_id" ON "public"."catalog_order_items" USING "btree" ("product_id");



CREATE INDEX "idx_catalog_order_items_variant_id" ON "public"."catalog_order_items" USING "btree" ("variant_id");



CREATE INDEX "idx_catalog_orders_sale_id" ON "public"."catalog_orders" USING "btree" ("sale_id");



CREATE INDEX "idx_categories_business_id" ON "public"."categories" USING "btree" ("business_id");



CREATE INDEX "idx_customers_business_id" ON "public"."customers" USING "btree" ("business_id");



CREATE INDEX "idx_daily_snapshots_top_product_id" ON "public"."daily_snapshots" USING "btree" ("top_product_id");



CREATE INDEX "idx_expense_items_business_id" ON "public"."expense_items" USING "btree" ("business_id");



CREATE INDEX "idx_expense_items_expense_id" ON "public"."expense_items" USING "btree" ("expense_id");



CREATE INDEX "idx_expense_items_product_id" ON "public"."expense_items" USING "btree" ("product_id");



CREATE INDEX "idx_expense_items_variant_id" ON "public"."expense_items" USING "btree" ("variant_id") WHERE ("variant_id" IS NOT NULL);



CREATE INDEX "idx_expenses_category" ON "public"."expenses" USING "btree" ("business_id", "category");



CREATE INDEX "idx_expenses_date" ON "public"."expenses" USING "btree" ("business_id", "date" DESC);



CREATE INDEX "idx_expenses_operator_id" ON "public"."expenses" USING "btree" ("operator_id");



CREATE INDEX "idx_expenses_supplier_id" ON "public"."expenses" USING "btree" ("supplier_id");



CREATE INDEX "idx_feedback_operator_id" ON "public"."feedback" USING "btree" ("operator_id");



CREATE INDEX "idx_inventory_movements_business_id" ON "public"."inventory_movements" USING "btree" ("business_id");



CREATE INDEX "idx_inventory_movements_operator_id" ON "public"."inventory_movements" USING "btree" ("created_by_operator");



CREATE INDEX "idx_inventory_movements_product_id" ON "public"."inventory_movements" USING "btree" ("product_id");



CREATE INDEX "idx_inventory_movements_variant_id" ON "public"."inventory_movements" USING "btree" ("variant_id") WHERE ("variant_id" IS NOT NULL);



CREATE INDEX "idx_operators_business_id" ON "public"."operators" USING "btree" ("business_id");



CREATE INDEX "idx_payments_method_sale" ON "public"."payments" USING "btree" ("method", "sale_id");



CREATE INDEX "idx_payments_sale_id" ON "public"."payments" USING "btree" ("sale_id");



CREATE INDEX "idx_price_list_overrides_brand_id" ON "public"."price_list_overrides" USING "btree" ("brand_id");



CREATE INDEX "idx_price_list_overrides_price_list_id" ON "public"."price_list_overrides" USING "btree" ("price_list_id");



CREATE INDEX "idx_price_list_overrides_product_id" ON "public"."price_list_overrides" USING "btree" ("product_id");



CREATE INDEX "idx_price_lists_business_id" ON "public"."price_lists" USING "btree" ("business_id");



CREATE INDEX "idx_product_option_values_option_id" ON "public"."product_option_values" USING "btree" ("option_id");



CREATE INDEX "idx_product_options_attribute_type_id" ON "public"."product_options" USING "btree" ("attribute_type_id");



CREATE INDEX "idx_product_options_business_id" ON "public"."product_options" USING "btree" ("business_id");



CREATE INDEX "idx_product_options_product_id" ON "public"."product_options" USING "btree" ("product_id");



CREATE INDEX "idx_product_variant_option_values_option_value_id" ON "public"."product_variant_option_values" USING "btree" ("option_value_id");



CREATE INDEX "idx_product_variants_business_id" ON "public"."product_variants" USING "btree" ("business_id");



CREATE INDEX "idx_product_variants_product_id" ON "public"."product_variants" USING "btree" ("product_id");



CREATE INDEX "idx_products_barcode" ON "public"."products" USING "btree" ("barcode") WHERE ("barcode" IS NOT NULL);



CREATE INDEX "idx_products_brand_id" ON "public"."products" USING "btree" ("brand_id") WHERE ("brand_id" IS NOT NULL);



CREATE INDEX "idx_products_business_active" ON "public"."products" USING "btree" ("business_id", "is_active");



CREATE INDEX "idx_products_business_id" ON "public"."products" USING "btree" ("business_id");



CREATE INDEX "idx_products_category_id" ON "public"."products" USING "btree" ("category_id");



CREATE INDEX "idx_products_default_variant_id" ON "public"."products" USING "btree" ("default_variant_id");



CREATE INDEX "idx_products_sku" ON "public"."products" USING "btree" ("sku") WHERE ("sku" IS NOT NULL);



CREATE INDEX "idx_profiles_business_id" ON "public"."profiles" USING "btree" ("business_id");



CREATE INDEX "idx_pvov_variant_id" ON "public"."product_variant_option_values" USING "btree" ("variant_id");



CREATE INDEX "idx_sale_items_product_id" ON "public"."sale_items" USING "btree" ("product_id");



CREATE INDEX "idx_sale_items_product_sale" ON "public"."sale_items" USING "btree" ("product_id", "sale_id");



CREATE INDEX "idx_sale_items_sale_id" ON "public"."sale_items" USING "btree" ("sale_id");



CREATE INDEX "promotions_business_active_idx" ON "public"."promotions" USING "btree" ("business_id") WHERE ("archived_at" IS NULL);



CREATE INDEX "sale_items_promotion_idx" ON "public"."sale_items" USING "btree" ("promotion_id") WHERE ("promotion_id" IS NOT NULL);



CREATE INDEX "idx_sale_items_variant_id" ON "public"."sale_items" USING "btree" ("variant_id");



CREATE INDEX "idx_sales_business_created" ON "public"."sales" USING "btree" ("business_id", "created_at" DESC);



CREATE INDEX "idx_sales_business_status_created" ON "public"."sales" USING "btree" ("business_id", "status", "created_at" DESC);



CREATE INDEX "idx_sales_customer_id" ON "public"."sales" USING "btree" ("customer_id") WHERE ("customer_id" IS NOT NULL);



CREATE INDEX "idx_sales_operator_id" ON "public"."sales" USING "btree" ("operator_id");



CREATE INDEX "idx_sales_price_list_id" ON "public"."sales" USING "btree" ("price_list_id");



CREATE INDEX "idx_sales_session_id" ON "public"."sales" USING "btree" ("session_id");



CREATE INDEX "idx_session_digital_balances_entered_by" ON "public"."session_digital_balances" USING "btree" ("entered_by");



CREATE INDEX "idx_suppliers_business_id" ON "public"."suppliers" USING "btree" ("business_id");



CREATE INDEX "session_digital_balances_business_id_idx" ON "public"."session_digital_balances" USING "btree" ("business_id");



CREATE INDEX "session_digital_balances_session_id_idx" ON "public"."session_digital_balances" USING "btree" ("session_id");



CREATE INDEX "subscriptions_status_idx" ON "public"."subscriptions" USING "btree" ("status");





CREATE OR REPLACE TRIGGER "ai_insights_updated_at" BEFORE UPDATE ON "public"."ai_insights" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "expenses_updated_at" BEFORE UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "on_sale_item_inserted" AFTER INSERT ON "public"."sale_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_stock_on_sale"();



CREATE OR REPLACE TRIGGER "set_updated_at_product_variants" BEFORE UPDATE ON "public"."product_variants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_insights"
    ADD CONSTRAINT "ai_insights_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cash_sessions"
    ADD CONSTRAINT "cash_sessions_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalog_order_counters"
    ADD CONSTRAINT "catalog_order_counters_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalog_order_items"
    ADD CONSTRAINT "catalog_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."catalog_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalog_order_items"
    ADD CONSTRAINT "catalog_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalog_order_items"
    ADD CONSTRAINT "catalog_order_items_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id");



ALTER TABLE ONLY "public"."catalog_order_items"
    ADD CONSTRAINT "catalog_order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalog_orders"
    ADD CONSTRAINT "catalog_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."catalog_orders"
    ADD CONSTRAINT "catalog_orders_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."catalog_phone_blacklist"
    ADD CONSTRAINT "catalog_phone_blacklist_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_account_movements"
    ADD CONSTRAINT "customer_account_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_account_movements"
    ADD CONSTRAINT "customer_account_movements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_account_movements"
    ADD CONSTRAINT "customer_account_movements_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_account_movements"
    ADD CONSTRAINT "customer_account_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_account_movements"
    ADD CONSTRAINT "customer_account_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_snapshots"
    ADD CONSTRAINT "daily_snapshots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_snapshots"
    ADD CONSTRAINT "daily_snapshots_top_product_id_fkey" FOREIGN KEY ("top_product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expense_items"
    ADD CONSTRAINT "expense_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_items"
    ADD CONSTRAINT "expense_items_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_items"
    ADD CONSTRAINT "expense_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expense_items"
    ADD CONSTRAINT "expense_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_created_by_operator_fkey" FOREIGN KEY ("created_by_operator") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."operators"
    ADD CONSTRAINT "operators_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_list_overrides"
    ADD CONSTRAINT "price_list_overrides_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_list_overrides"
    ADD CONSTRAINT "price_list_overrides_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_list_overrides"
    ADD CONSTRAINT "price_list_overrides_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_lists"
    ADD CONSTRAINT "price_lists_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_option_values"
    ADD CONSTRAINT "product_option_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."product_options"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_options"
    ADD CONSTRAINT "product_options_attribute_type_id_fkey" FOREIGN KEY ("attribute_type_id") REFERENCES "public"."attribute_types"("id");



ALTER TABLE ONLY "public"."product_options"
    ADD CONSTRAINT "product_options_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_options"
    ADD CONSTRAINT "product_options_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_variant_option_values"
    ADD CONSTRAINT "product_variant_option_values_option_value_id_fkey" FOREIGN KEY ("option_value_id") REFERENCES "public"."product_option_values"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_variant_option_values"
    ADD CONSTRAINT "product_variant_option_values_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_variants"
    ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_default_variant_id_fkey" FOREIGN KEY ("default_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id");



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cash_sessions"("id");



ALTER TABLE ONLY "public"."session_digital_balances"
    ADD CONSTRAINT "session_digital_balances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_digital_balances"
    ADD CONSTRAINT "session_digital_balances_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "public"."operators"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."session_digital_balances"
    ADD CONSTRAINT "session_digital_balances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE;



ALTER TABLE "public"."ai_insights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attribute_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated_read" ON "public"."attribute_types" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business isolation" ON "public"."ai_insights" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "business isolation" ON "public"."audit_log" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "business isolation" ON "public"."catalog_order_counters" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "business isolation" ON "public"."catalog_orders" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "business isolation" ON "public"."catalog_phone_blacklist" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "business isolation via order" ON "public"."catalog_order_items" USING ((EXISTS ( SELECT 1
   FROM "public"."catalog_orders" "o"
  WHERE (("o"."id" = "catalog_order_items"."order_id") AND ("o"."business_id" = "public"."get_business_id"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."catalog_orders" "o"
  WHERE (("o"."id" = "catalog_order_items"."order_id") AND ("o"."business_id" = "public"."get_business_id"())))));



CREATE POLICY "business members can manage digital balances" ON "public"."session_digital_balances" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



ALTER TABLE "public"."businesses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalog_order_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalog_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalog_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalog_phone_blacklist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_account_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "daily_snapshots_select_own_business" ON "public"."daily_snapshots" FOR SELECT TO "authenticated" USING (("business_id" = "public"."get_business_id"()));



ALTER TABLE "public"."expense_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expenses_business_access" ON "public"."expenses" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_select_own_business" ON "public"."feedback" FOR SELECT TO "authenticated" USING (("business_id" = "public"."get_business_id"()));



CREATE POLICY "insert_own_profile" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."inventory_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."operators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own_profile" ON "public"."profiles" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));


-- Solo lectura directa (el POS lee promos vigentes client-side).
-- Escrituras EXCLUSIVAMENTE vía RPCs guardadas (create/update/archive_promotion) — sin policy de INSERT/UPDATE/DELETE.
CREATE POLICY "promotions_select" ON "public"."promotions" FOR SELECT USING (("business_id" = "public"."get_business_id"()));



CREATE POLICY "owner_manage_expense_items" ON "public"."expense_items" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "owner_read_own_subscription" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING (("business_id" = "public"."get_business_id"()));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_list_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "price_list_overrides_insert" ON "public"."price_list_overrides" FOR INSERT WITH CHECK (("price_list_id" IN ( SELECT "price_lists"."id"
   FROM "public"."price_lists"
  WHERE ("price_lists"."business_id" = "public"."get_business_id"()))));



CREATE POLICY "price_list_overrides_select" ON "public"."price_list_overrides" FOR SELECT USING (("price_list_id" IN ( SELECT "price_lists"."id"
   FROM "public"."price_lists"
  WHERE ("price_lists"."business_id" = "public"."get_business_id"()))));



CREATE POLICY "price_list_overrides_stock_write_delete" ON "public"."price_list_overrides" FOR DELETE USING ((("price_list_id" IN ( SELECT "price_lists"."id"
   FROM "public"."price_lists"
  WHERE ("price_lists"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")))) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("operators"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ("operators"."is_active" = true) AND ((("operators"."permissions" ->> 'stock_write'::"text"))::boolean = true)))))));



CREATE POLICY "price_list_overrides_stock_write_update" ON "public"."price_list_overrides" FOR UPDATE USING ((("price_list_id" IN ( SELECT "price_lists"."id"
   FROM "public"."price_lists"
  WHERE ("price_lists"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")))) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("operators"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ("operators"."is_active" = true) AND ((("operators"."permissions" ->> 'stock_write'::"text"))::boolean = true))))))) WITH CHECK ((("price_list_id" IN ( SELECT "price_lists"."id"
   FROM "public"."price_lists"
  WHERE ("price_lists"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")))) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("operators"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ("operators"."is_active" = true) AND ((("operators"."permissions" ->> 'stock_write'::"text"))::boolean = true)))))));



ALTER TABLE "public"."price_lists" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_option_values" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_variant_option_values" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_variants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_stock_write_delete" ON "public"."products" FOR DELETE USING ((("business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("operators"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ("operators"."is_active" = true) AND ((("operators"."permissions" ->> 'stock_write'::"text"))::boolean = true)))))));



CREATE POLICY "products_stock_write_insert" ON "public"."products" FOR INSERT WITH CHECK ((("business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("operators"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ("operators"."is_active" = true) AND ((("operators"."permissions" ->> 'stock_write'::"text"))::boolean = true)))))));



CREATE POLICY "products_stock_write_update" ON "public"."products" FOR UPDATE USING ((("business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("operators"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ("operators"."is_active" = true) AND ((("operators"."permissions" ->> 'stock_write'::"text"))::boolean = true))))))) WITH CHECK ((("business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id"))))) OR (EXISTS ( SELECT 1
   FROM "public"."operators"
  WHERE (("operators"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("operators"."business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")) AND ("operators"."is_active" = true) AND ((("operators"."permissions" ->> 'stock_write'::"text"))::boolean = true)))))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promotions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read_products" ON "public"."products" FOR SELECT USING (("business_id" = "public"."get_business_id"()));



ALTER TABLE "public"."sale_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_digital_balances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "suppliers_business_access" ON "public"."suppliers" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."brands" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."businesses" USING (("id" = "public"."get_business_id"())) WITH CHECK (("id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."cash_sessions" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."categories" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."customer_account_movements" USING (("business_id" = ( SELECT "public"."get_business_id"() AS "get_business_id")));



CREATE POLICY "tenant_isolation" ON "public"."customers" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."inventory_movements" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."operators" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."payments" USING (("sale_id" IN ( SELECT "sales"."id"
   FROM "public"."sales"
  WHERE ("sales"."business_id" = "public"."get_business_id"())))) WITH CHECK (("sale_id" IN ( SELECT "sales"."id"
   FROM "public"."sales"
  WHERE ("sales"."business_id" = "public"."get_business_id"()))));



CREATE POLICY "tenant_isolation" ON "public"."price_lists" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."product_option_values" USING (("option_id" IN ( SELECT "product_options"."id"
   FROM "public"."product_options"
  WHERE ("product_options"."business_id" = "public"."get_business_id"())))) WITH CHECK (("option_id" IN ( SELECT "product_options"."id"
   FROM "public"."product_options"
  WHERE ("product_options"."business_id" = "public"."get_business_id"()))));



CREATE POLICY "tenant_isolation" ON "public"."product_options" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."product_variant_option_values" USING (("variant_id" IN ( SELECT "product_variants"."id"
   FROM "public"."product_variants"
  WHERE ("product_variants"."business_id" = "public"."get_business_id"())))) WITH CHECK (("variant_id" IN ( SELECT "product_variants"."id"
   FROM "public"."product_variants"
  WHERE ("product_variants"."business_id" = "public"."get_business_id"()))));



CREATE POLICY "tenant_isolation" ON "public"."product_variants" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_isolation" ON "public"."sale_items" USING (("sale_id" IN ( SELECT "sales"."id"
   FROM "public"."sales"
  WHERE ("sales"."business_id" = "public"."get_business_id"())))) WITH CHECK (("sale_id" IN ( SELECT "sales"."id"
   FROM "public"."sales"
  WHERE ("sales"."business_id" = "public"."get_business_id"()))));



CREATE POLICY "tenant_isolation" ON "public"."sales" USING (("business_id" = "public"."get_business_id"())) WITH CHECK (("business_id" = "public"."get_business_id"()));



CREATE POLICY "tenant_select_profiles" ON "public"."profiles" FOR SELECT USING (("business_id" = "public"."get_business_id"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


SET SESSION AUTHORIZATION "postgres";
RESET SESSION AUTHORIZATION;






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";















































































































































































































GRANT ALL ON FUNCTION "public"."_add"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_add"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_add"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_add"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_add"("text", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_add"("text", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_add"("text", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_add"("text", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_alike"(boolean, "anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_alike"(boolean, "anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_alike"(boolean, "anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_alike"(boolean, "anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", "name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", "name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", "name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ancestor_of"("name", "name", "name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_are"("text", "name"[], "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_are"("text", "name"[], "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_are"("text", "name"[], "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_are"("text", "name"[], "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_areni"("text", "text"[], "text"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_areni"("text", "text"[], "text"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_areni"("text", "text"[], "text"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_areni"("text", "text"[], "text"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_array_to_sorted_string"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_array_to_sorted_string"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_array_to_sorted_string"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_array_to_sorted_string"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_assets_are"("text", "text"[], "text"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_assets_are"("text", "text"[], "text"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_assets_are"("text", "text"[], "text"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_assets_are"("text", "text"[], "text"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cast_exists"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "name", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "name", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "name", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cdi"("name", "name", "name", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cexists"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cexists"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_cexists"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cexists"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_cexists"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cexists"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_cexists"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cexists"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ckeys"("name", character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ckeys"("name", character) TO "anon";
GRANT ALL ON FUNCTION "public"."_ckeys"("name", character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ckeys"("name", character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_ckeys"("name", "name", character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_ckeys"("name", "name", character) TO "anon";
GRANT ALL ON FUNCTION "public"."_ckeys"("name", "name", character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ckeys"("name", "name", character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_cleanup"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_cleanup"() TO "anon";
GRANT ALL ON FUNCTION "public"."_cleanup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cleanup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_cmp_types"("oid", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_cmp_types"("oid", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_cmp_types"("oid", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_cmp_types"("oid", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "text", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "text", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "text", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "text", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "name", "text", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "name", "text", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "name", "text", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_col_is_null"("name", "name", "name", "text", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_constraint"("name", character, "name"[], "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_constraint"("name", character, "name"[], "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_constraint"("name", character, "name"[], "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_constraint"("name", character, "name"[], "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_constraint"("name", "name", character, "name"[], "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_constraint"("name", "name", character, "name"[], "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_constraint"("name", "name", character, "name"[], "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_constraint"("name", "name", character, "name"[], "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_contract_on"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_contract_on"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_contract_on"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_contract_on"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_currtest"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_currtest"() TO "anon";
GRANT ALL ON FUNCTION "public"."_currtest"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_currtest"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_db_privs"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_db_privs"() TO "anon";
GRANT ALL ON FUNCTION "public"."_db_privs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_db_privs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_def_is"("text", "text", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_def_is"("text", "text", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_def_is"("text", "text", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_def_is"("text", "text", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_definer"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_definer"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_definer"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_definer"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_definer"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_definer"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_definer"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_definer"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_dexists"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_dexists"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_dexists"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_dexists"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_dexists"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_dexists"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_dexists"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_dexists"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_do_ne"("text", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_do_ne"("text", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_do_ne"("text", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_do_ne"("text", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_docomp"("text", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_docomp"("text", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_docomp"("text", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_docomp"("text", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_error_diag"("text", "text", "text", "text", "text", "text", "text", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_error_diag"("text", "text", "text", "text", "text", "text", "text", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_error_diag"("text", "text", "text", "text", "text", "text", "text", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_error_diag"("text", "text", "text", "text", "text", "text", "text", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_expand_context"(character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_expand_context"(character) TO "anon";
GRANT ALL ON FUNCTION "public"."_expand_context"(character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_expand_context"(character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_expand_on"(character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_expand_on"(character) TO "anon";
GRANT ALL ON FUNCTION "public"."_expand_on"(character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_expand_on"(character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_expand_vol"(character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_expand_vol"(character) TO "anon";
GRANT ALL ON FUNCTION "public"."_expand_vol"(character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_expand_vol"(character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_ext_exists"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ext_exists"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_ext_exists"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ext_exists"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ext_exists"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ext_exists"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_ext_exists"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ext_exists"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_extensions"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_extensions"() TO "anon";
GRANT ALL ON FUNCTION "public"."_extensions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_extensions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_extensions"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_extensions"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_extensions"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_extensions"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_extras"(character[], "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_extras"(character[], "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_extras"(character[], "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_extras"(character[], "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_extras"(character, "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_extras"(character, "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_extras"(character, "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_extras"(character, "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_extras"(character[], "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_extras"(character[], "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_extras"(character[], "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_extras"(character[], "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_extras"(character, "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_extras"(character, "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_extras"(character, "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_extras"(character, "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_finish"(integer, integer, integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_finish"(integer, integer, integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_finish"(integer, integer, integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_finish"(integer, integer, integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_fkexists"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_fprivs_are"("text", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_fprivs_are"("text", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_fprivs_are"("text", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_fprivs_are"("text", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", boolean, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", boolean, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", boolean, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", boolean, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], boolean, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], boolean, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], boolean, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], boolean, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "anyelement", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "anyelement", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "anyelement", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "anyelement", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], "anyelement", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], "anyelement", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], "anyelement", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_func_compare"("name", "name", "name"[], "anyelement", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_funkargs"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_funkargs"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_funkargs"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_funkargs"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_get"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_ac_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_ac_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_ac_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_ac_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_col_ns_type"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_col_ns_type"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_col_ns_type"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_col_ns_type"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_col_privs"("name", "text", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_col_privs"("name", "text", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_col_privs"("name", "text", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_col_privs"("name", "text", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_col_type"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_context"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_context"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_context"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_context"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_db_owner"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_db_owner"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_db_owner"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_db_owner"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_db_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_db_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_db_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_db_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_dtype"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_dtype"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_dtype"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_dtype"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_dtype"("name", "text", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_dtype"("name", "text", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_get_dtype"("name", "text", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_dtype"("name", "text", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_fdw_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_fdw_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_fdw_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_fdw_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_func_owner"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_func_privs"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_func_privs"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_func_privs"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_func_privs"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_index_owner"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_lang_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_lang_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_lang_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_lang_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_language_owner"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_language_owner"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_language_owner"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_language_owner"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_latest"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_latest"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_latest"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_latest"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_latest"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_latest"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_get_latest"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_latest"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_note"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_note"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_get_note"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_note"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_note"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_note"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_note"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_note"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_opclass_owner"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character[], "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_rel_owner"(character, "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_schema_owner"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_schema_owner"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_schema_owner"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_schema_owner"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_schema_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_schema_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_schema_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_schema_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_sequence_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_sequence_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_sequence_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_sequence_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_server_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_server_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_server_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_server_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_table_privs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_table_privs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_table_privs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_table_privs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_tablespace_owner"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_tablespace_owner"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_tablespace_owner"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_tablespace_owner"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_tablespaceprivs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_tablespaceprivs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_tablespaceprivs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_tablespaceprivs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_type_owner"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_type_owner"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_type_owner"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_type_owner"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_get_type_owner"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_get_type_owner"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_get_type_owner"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_get_type_owner"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_got_func"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_got_func"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_got_func"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_got_func"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_got_func"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_got_func"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_got_func"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_got_func"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_grolist"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_grolist"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_grolist"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_grolist"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_has_def"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_has_def"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_has_def"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_has_def"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_has_def"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_has_def"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_has_def"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_has_def"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_has_group"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_has_group"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_has_group"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_has_group"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_has_role"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_has_role"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_has_role"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_has_role"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_has_type"("name", character[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_has_type"("name", character[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_has_type"("name", character[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_has_type"("name", character[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_has_type"("name", "name", character[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_has_type"("name", "name", character[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_has_type"("name", "name", character[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_has_type"("name", "name", character[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_has_user"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_has_user"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_has_user"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_has_user"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_hasc"("name", character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_hasc"("name", character) TO "anon";
GRANT ALL ON FUNCTION "public"."_hasc"("name", character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_hasc"("name", character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_hasc"("name", "name", character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_hasc"("name", "name", character) TO "anon";
GRANT ALL ON FUNCTION "public"."_hasc"("name", "name", character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_hasc"("name", "name", character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_have_index"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_have_index"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_have_index"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_have_index"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_have_index"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_have_index"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_have_index"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_have_index"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ident_array_to_sorted_string"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ident_array_to_sorted_string"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_ident_array_to_sorted_string"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ident_array_to_sorted_string"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ident_array_to_string"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ident_array_to_string"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_ident_array_to_string"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ident_array_to_string"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_ikeys"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_inherited"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_inherited"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_inherited"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_inherited"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_inherited"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_inherited"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_inherited"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_inherited"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_indexed"("name", "name", "text"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_is_indexed"("name", "name", "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_is_indexed"("name", "name", "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_indexed"("name", "name", "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_instead"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_schema"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_is_schema"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_is_schema"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_schema"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_super"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_is_super"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_is_super"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_super"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_trusted"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_is_trusted"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_is_trusted"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_trusted"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_verbose"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_is_verbose"() TO "anon";
GRANT ALL ON FUNCTION "public"."_is_verbose"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_verbose"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_keys"("name", character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_keys"("name", character) TO "anon";
GRANT ALL ON FUNCTION "public"."_keys"("name", character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_keys"("name", character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_keys"("name", "name", character) TO "postgres";
GRANT ALL ON FUNCTION "public"."_keys"("name", "name", character) TO "anon";
GRANT ALL ON FUNCTION "public"."_keys"("name", "name", character) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_keys"("name", "name", character) TO "service_role";



GRANT ALL ON FUNCTION "public"."_lang"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_lang"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_lang"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lang"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_lang"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_lang"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_lang"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_lang"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_missing"(character[], "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_missing"(character[], "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_missing"(character[], "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_missing"(character[], "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_missing"(character, "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_missing"(character, "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_missing"(character, "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_missing"(character, "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_missing"(character[], "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_missing"(character[], "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_missing"(character[], "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_missing"(character[], "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_missing"(character, "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_missing"(character, "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_missing"(character, "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_missing"(character, "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_nosuch"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_nosuch"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_nosuch"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_nosuch"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_op_exists"("name", "name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_opc_exists"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_opc_exists"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_opc_exists"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_opc_exists"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_opc_exists"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_opc_exists"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_opc_exists"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_opc_exists"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_partof"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_partof"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_partof"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_partof"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_partof"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_partof"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_partof"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_partof"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_parts"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_parts"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_parts"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_parts"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_parts"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_parts"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_parts"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_parts"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_pg_sv_column_array"("oid", smallint[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_pg_sv_column_array"("oid", smallint[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_pg_sv_column_array"("oid", smallint[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_pg_sv_column_array"("oid", smallint[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_pg_sv_table_accessible"("oid", "oid") TO "postgres";
GRANT ALL ON FUNCTION "public"."_pg_sv_table_accessible"("oid", "oid") TO "anon";
GRANT ALL ON FUNCTION "public"."_pg_sv_table_accessible"("oid", "oid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_pg_sv_table_accessible"("oid", "oid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_pg_sv_type_array"("oid"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_pg_sv_type_array"("oid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_pg_sv_type_array"("oid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_pg_sv_type_array"("oid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_prokind"("p_oid" "oid") TO "postgres";
GRANT ALL ON FUNCTION "public"."_prokind"("p_oid" "oid") TO "anon";
GRANT ALL ON FUNCTION "public"."_prokind"("p_oid" "oid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_prokind"("p_oid" "oid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_query"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_query"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_query"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_query"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_refine_vol"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_refine_vol"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_refine_vol"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_refine_vol"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_relcomp"("text", "anyarray", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "anyarray", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "anyarray", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "anyarray", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_relcomp"("text", "text", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_relexists"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_relexists"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_relexists"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_relexists"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_relexists"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_relexists"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_relexists"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_relexists"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_relne"("text", "anyarray", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_relne"("text", "anyarray", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_relne"("text", "anyarray", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_relne"("text", "anyarray", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_relne"("text", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_relne"("text", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_relne"("text", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_relne"("text", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_returns"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_returns"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_returns"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_returns"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_returns"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_returns"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_returns"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_returns"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_retval"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_retval"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_retval"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_retval"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rexists"(character, "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_rexists"(character, "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_rexists"(character, "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rexists"(character, "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rexists"(character[], "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rexists"(character, "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_rexists"(character, "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_rexists"(character, "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rexists"(character, "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_rule_on"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_runem"("text"[], boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."_runem"("text"[], boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."_runem"("text"[], boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_runem"("text"[], boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."_runner"("text"[], "text"[], "text"[], "text"[], "text"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_runner"("text"[], "text"[], "text"[], "text"[], "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_runner"("text"[], "text"[], "text"[], "text"[], "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_runner"("text"[], "text"[], "text"[], "text"[], "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_set"(integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_set"(integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_set"(integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_set"(integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_set"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."_set"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_set"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_set"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."_set"("text", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_set"("text", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_set"("text", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_set"("text", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_strict"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_strict"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_strict"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_strict"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_strict"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_strict"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_strict"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_strict"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_table_privs"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_table_privs"() TO "anon";
GRANT ALL ON FUNCTION "public"."_table_privs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_table_privs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_temptable"("anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_temptable"("anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_temptable"("anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_temptable"("anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_temptable"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_temptable"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_temptable"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_temptable"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_temptypes"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_temptypes"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."_temptypes"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_temptypes"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_time_trials"("text", integer, numeric) TO "postgres";
GRANT ALL ON FUNCTION "public"."_time_trials"("text", integer, numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."_time_trials"("text", integer, numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_time_trials"("text", integer, numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."_tlike"(boolean, "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_tlike"(boolean, "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_tlike"(boolean, "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_tlike"(boolean, "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_todo"() TO "postgres";
GRANT ALL ON FUNCTION "public"."_todo"() TO "anon";
GRANT ALL ON FUNCTION "public"."_todo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_todo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_trig"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_trig"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_trig"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_trig"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_trig"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_trig"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_trig"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_trig"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_type_func"("char", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_type_func"("char", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_typename"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_typename"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_typename"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_typename"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_types_are"("name"[], "text", character[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_types_are"("name"[], "text", character[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_types_are"("name"[], "text", character[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_types_are"("name"[], "text", character[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_types_are"("name", "name"[], "text", character[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_types_are"("name", "name"[], "text", character[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_types_are"("name", "name"[], "text", character[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_types_are"("name", "name"[], "text", character[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_unalike"(boolean, "anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."_unalike"(boolean, "anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_unalike"(boolean, "anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_unalike"(boolean, "anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_vol"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_vol"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."_vol"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_vol"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_vol"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."_vol"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."_vol"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_vol"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."add_result"(boolean, boolean, "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."add_result"(boolean, boolean, "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_result"(boolean, boolean, "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_result"(boolean, boolean, "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."alike"("anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."any_column_privs_are"("name", "name", "name", "name"[], "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_unit_promo"("p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_unit_price" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_unit_promo"("p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_unit_price" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_unit_promo"("p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_unit_price" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."archive_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assert_tenant"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_tenant"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_tenant"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."attach_feedback_links"("p_id" "uuid", "p_github_issue_url" "text", "p_telegram_sent_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attach_feedback_links"("p_id" "uuid", "p_github_issue_url" "text", "p_telegram_sent_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."attach_feedback_links"("p_id" "uuid", "p_github_issue_url" "text", "p_telegram_sent_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_eq"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_has"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_has"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_has"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_has"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_has"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_has"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_has"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_has"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_hasnt"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bag_ne"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."bootstrap_new_user"("p_user_id" "uuid", "p_business_name" "text", "p_user_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."bootstrap_new_user"("p_user_id" "uuid", "p_business_name" "text", "p_user_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_new_user"("p_user_id" "uuid", "p_business_name" "text", "p_user_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulk_delete_products"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_delete_products"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_delete_products"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulk_set_product_status"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_set_product_status"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_set_product_status"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_is_active" boolean) TO "service_role";
REVOKE ALL ON FUNCTION "public"."bulk_set_product_catalog"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_show_in_catalog" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_set_product_catalog"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_show_in_catalog" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_set_product_catalog"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_show_in_catalog" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulk_update_product_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_brand_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_update_product_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_update_product_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_brand_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bulk_update_product_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bulk_update_product_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_update_product_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_ids" "uuid"[], "p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."can"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."can"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."can"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."can"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."can"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."can"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."can"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."can"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."can"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."can"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."can"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cast_context_is"("name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."casts_are"("text"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."casts_are"("text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."casts_are"("text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."casts_are"("text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."casts_are"("text"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."casts_are"("text"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."casts_are"("text"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."casts_are"("text"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_test"("text", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text", boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text", boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text", boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_test"("text", boolean, "text", "text", "text", boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_closing_amount" numeric, "p_notes" "text", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_closing_amount" numeric, "p_notes" "text", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_cash_session"("p_session_id" "uuid", "p_closing_amount" numeric, "p_notes" "text", "p_operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cmp_ok"("anyelement", "text", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_default_is"("name", "name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_check"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_has_default"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_hasnt_default"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_fk"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_null"("table_name" "name", "column_name" "name", "description" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_null"("table_name" "name", "column_name" "name", "description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_null"("table_name" "name", "column_name" "name", "description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_null"("table_name" "name", "column_name" "name", "description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_pk"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_is_unique"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_fk"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_isnt_pk"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_not_null"("table_name" "name", "column_name" "name", "description" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_not_null"("table_name" "name", "column_name" "name", "description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_not_null"("table_name" "name", "column_name" "name", "description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_not_null"("table_name" "name", "column_name" "name", "description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_not_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_not_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_not_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_not_null"("schema_name" "name", "table_name" "name", "column_name" "name", "description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."col_type_is"("name", "name", "name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."collect_tap"(VARIADIC "text"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."collect_tap"(VARIADIC "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."collect_tap"(VARIADIC "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."collect_tap"(VARIADIC "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."collect_tap"(character varying[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."collect_tap"(character varying[]) TO "anon";
GRANT ALL ON FUNCTION "public"."collect_tap"(character varying[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."collect_tap"(character varying[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."column_privs_are"("name", "name", "name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."columns_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."composite_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_effective_price"("p_cost" numeric, "p_price" numeric, "p_variant_price" numeric, "p_list_id" "uuid", "p_list_multiplier" numeric, "p_product_id" "uuid", "p_brand_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_effective_price"("p_cost" numeric, "p_price" numeric, "p_variant_price" numeric, "p_list_id" "uuid", "p_list_multiplier" numeric, "p_product_id" "uuid", "p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_effective_price"("p_cost" numeric, "p_price" numeric, "p_variant_price" numeric, "p_list_id" "uuid", "p_list_multiplier" numeric, "p_product_id" "uuid", "p_brand_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_quantity_promo_discount"("p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_unit_price" numeric, "p_quantity" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_quantity_promo_discount"("p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_unit_price" numeric, "p_quantity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_quantity_promo_discount"("p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_unit_price" numeric, "p_quantity" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_brand_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_brand_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_brand_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_catalog_order"("p_slug" "text", "p_customer_name" "text", "p_phone" "text", "p_delivery_type" "text", "p_address" "text", "p_notes" "text", "p_items" "jsonb", "p_client_ip" "inet") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_catalog_order"("p_slug" "text", "p_customer_name" "text", "p_phone" "text", "p_delivery_type" "text", "p_address" "text", "p_notes" "text", "p_items" "jsonb", "p_client_ip" "inet") TO "anon";
GRANT ALL ON FUNCTION "public"."create_catalog_order"("p_slug" "text", "p_customer_name" "text", "p_phone" "text", "p_delivery_type" "text", "p_address" "text", "p_notes" "text", "p_items" "jsonb", "p_client_ip" "inet") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_catalog_order"("p_slug" "text", "p_customer_name" "text", "p_phone" "text", "p_delivery_type" "text", "p_address" "text", "p_notes" "text", "p_items" "jsonb", "p_client_ip" "inet") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_category_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_category_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_category_guarded"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_expense"("p_business_id" "uuid", "p_category" "text", "p_amount" numeric, "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_expense"("p_business_id" "uuid", "p_category" "text", "p_amount" numeric, "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_expense"("p_business_id" "uuid", "p_category" "text", "p_amount" numeric, "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_feedback"("p_business_id" "uuid", "p_operator_id" "uuid", "p_type" "text", "p_message" "text", "p_contact_email" "text", "p_route" "text", "p_user_agent" "text", "p_attachment_path" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_feedback"("p_business_id" "uuid", "p_operator_id" "uuid", "p_type" "text", "p_message" "text", "p_contact_email" "text", "p_route" "text", "p_user_agent" "text", "p_attachment_path" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_feedback"("p_business_id" "uuid", "p_operator_id" "uuid", "p_type" "text", "p_message" "text", "p_contact_email" "text", "p_route" "text", "p_user_agent" "text", "p_attachment_path" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_mercaderia_expense"("p_business_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_update_stock" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_mercaderia_expense"("p_business_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_update_stock" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_mercaderia_expense"("p_business_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_operator_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_update_stock" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_role" "text", "p_pin" "text", "p_permissions" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_role" "text", "p_pin" "text", "p_permissions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_role" "text", "p_pin" "text", "p_permissions" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides" "jsonb", "p_round_step" numeric, "p_round_up" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides" "jsonb", "p_round_step" numeric, "p_round_up" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides" "jsonb", "p_round_step" numeric, "p_round_up" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_product_with_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product" "jsonb", "p_options" "jsonb", "p_variants" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_product_with_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product" "jsonb", "p_options" "jsonb", "p_variants" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_product_with_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product" "jsonb", "p_options" "jsonb", "p_variants" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_sale_transaction"("p_business_id" "uuid", "p_subtotal" numeric, "p_discount" numeric, "p_total" numeric, "p_status" "text", "p_price_list_id" "uuid", "p_operator_id" "uuid", "p_items" "jsonb", "p_payments" "jsonb", "p_customer_id" "uuid", "p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_sale_transaction"("p_business_id" "uuid", "p_subtotal" numeric, "p_discount" numeric, "p_total" numeric, "p_status" "text", "p_price_list_id" "uuid", "p_operator_id" "uuid", "p_items" "jsonb", "p_payments" "jsonb", "p_customer_id" "uuid", "p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_sale_transaction"("p_business_id" "uuid", "p_subtotal" numeric, "p_discount" numeric, "p_total" numeric, "p_status" "text", "p_price_list_id" "uuid", "p_operator_id" "uuid", "p_items" "jsonb", "p_payments" "jsonb", "p_customer_id" "uuid", "p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."database_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."db_owner_is"("name", "name", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."deactivate_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deactivate_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deactivate_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_customer"("p_customer_id" "uuid", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_customer"("p_customer_id" "uuid", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_customer"("p_customer_id" "uuid", "p_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_operator"("p_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_operator"("p_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_operator"("p_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."find_applicable_promotion"("p_business_id" "uuid", "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."find_applicable_promotion"("p_business_id" "uuid", "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_applicable_promotion"("p_business_id" "uuid", "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "text"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."diag"(VARIADIC "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."diag"("msg" "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."diag"("msg" "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."diag"("msg" "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."diag"("msg" "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."diag"("msg" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."diag"("msg" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."diag"("msg" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."diag"("msg" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."diag_test_name"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."diag_test_name"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."diag_test_name"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."diag_test_name"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."display_oper"("name", "oid") TO "postgres";
GRANT ALL ON FUNCTION "public"."display_oper"("name", "oid") TO "anon";
GRANT ALL ON FUNCTION "public"."display_oper"("name", "oid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."display_oper"("name", "oid") TO "service_role";



GRANT ALL ON FUNCTION "public"."do_tap"() TO "postgres";
GRANT ALL ON FUNCTION "public"."do_tap"() TO "anon";
GRANT ALL ON FUNCTION "public"."do_tap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."do_tap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."do_tap"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."do_tap"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."do_tap"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."do_tap"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."do_tap"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."do_tap"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."do_tap"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."do_tap"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."do_tap"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."do_tap"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."do_tap"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."do_tap"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."doesnt_imatch"("anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."doesnt_match"("anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_is"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_is"("name", "text", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domain_type_isnt"("name", "text", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domains_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."domains_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."domains_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."domains_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."domains_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domains_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domains_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domains_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."domains_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enum_has_labels"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enums_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."enums_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."enums_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enums_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."enums_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."enums_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enums_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enums_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enums_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."extensions_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."extensions_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."extensions_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."extensions_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."extensions_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."extensions_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."extensions_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extensions_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extensions_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fail"() TO "postgres";
GRANT ALL ON FUNCTION "public"."fail"() TO "anon";
GRANT ALL ON FUNCTION "public"."fail"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fail"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."fail"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."fail"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fdw_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."findfuncs"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."findfuncs"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."findfuncs"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."findfuncs"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."findfuncs"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."findfuncs"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."findfuncs"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."findfuncs"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."findfuncs"("name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."finish"("exception_on_failure" boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."finish"("exception_on_failure" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."finish"("exception_on_failure" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finish"("exception_on_failure" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name"[], "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name"[], "name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fk_ok"("name", "name", "name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_table_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."foreign_tables_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."format_type_string"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."format_type_string"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."format_type_string"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."format_type_string"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name"[], "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_lang_is"("name", "name", "name"[], "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name") TO "anon";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name"[], "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name") TO "anon";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_owner_is"("name", "name", "name"[], "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name"[], "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_privs_are"("name", "name", "name"[], "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name"[], "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."function_returns"("name", "name", "name"[], "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."functions_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."functions_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."functions_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."functions_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."functions_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."functions_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."functions_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."functions_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."functions_are"("name", "name"[], "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_session"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_session"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_attribute_types"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_attribute_types"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_attribute_types"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_audit_log"("p_business_id" "uuid", "p_entity_type" "text", "p_operator_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_audit_log"("p_business_id" "uuid", "p_entity_type" "text", "p_operator_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_audit_log"("p_business_id" "uuid", "p_entity_type" "text", "p_operator_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_business_balance"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_business_balance"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_business_balance"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_business_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_business_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_business_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_business"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_business"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_business"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_business"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_categories"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_categories"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_categories"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_categories"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_default_variant_prices"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_default_variant_prices"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_default_variant_prices"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_default_variant_prices"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_order"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_order"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_order"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_orders"("p_status" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_orders"("p_status" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_orders"("p_status" "text"[], "p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_orders_unread_count"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_orders_unread_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_orders_unread_count"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_product_with_variants"("p_slug" "text", "p_product_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_catalog_products"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_products"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_products"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_catalog_variant_filters"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_catalog_variant_filters"("p_slug" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_variant_filters"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_variant_filters"("p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_daily_snapshots"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_daily_snapshots"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_snapshots"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_dead_stock"("p_business_id" "uuid", "p_days_threshold" integer, "p_bucket" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dead_stock"("p_business_id" "uuid", "p_days_threshold" integer, "p_bucket" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dead_stock"("p_business_id" "uuid", "p_days_threshold" integer, "p_bucket" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_expenses_list"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_category" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_expenses_list"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_category" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_expenses_list"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_category" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_low_stock_summary"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_low_stock_summary"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_low_stock_summary"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_mercaderia_expense_items"("p_expense_id" "uuid", "p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_mercaderia_expense_items"("p_expense_id" "uuid", "p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_mercaderia_expense_items"("p_expense_id" "uuid", "p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_operator_sales_sparkline"("p_business_id" "uuid", "p_operator_id" "uuid", "p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_operator_sales_sparkline"("p_business_id" "uuid", "p_operator_id" "uuid", "p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_operator_sales_sparkline"("p_business_id" "uuid", "p_operator_id" "uuid", "p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_operator_stats"("p_operator_id" "uuid", "p_date_from" "date", "p_date_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_operator_stats"("p_operator_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_operator_stats"("p_operator_id" "uuid", "p_date_from" "date", "p_date_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_overstock"("p_business_id" "uuid", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_overstock"("p_business_id" "uuid", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_overstock"("p_business_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_owner_stats"("p_date_from" "date", "p_date_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_owner_stats"("p_date_from" "date", "p_date_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_owner_stats"("p_date_from" "date", "p_date_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_period_comparison"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_period_comparison"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_period_comparison"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_demand_shifts"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_units_base" integer, "p_min_delta_pct" numeric, "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_payment_mix_shift"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_channel_signals"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_min_delta_pp" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_history"("p_business_id" "uuid", "p_product_id" "uuid", "p_months" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_plan_limits"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_plan_limits"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_plan_limits"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_product_with_variants"("p_product_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_product_with_variants"("p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_product_with_variants"("p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sale_detail"("p_sale_id" "uuid", "p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sale_detail"("p_sale_id" "uuid", "p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sale_detail"("p_sale_id" "uuid", "p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_promo_impact"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_promo_impact"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_promo_impact"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sales_by_brand_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sales_by_brand_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sales_by_brand_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sales_by_category_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sales_by_category_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sales_by_category_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sales_by_operator_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sales_by_operator_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sales_by_operator_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sales_by_payment_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sales_by_payment_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sales_by_payment_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sales_heatmap"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sales_heatmap"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sales_heatmap"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sales_history"("p_business_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_method" "text", "p_operator_id" "uuid", "p_search" "text", "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sales_history"("p_business_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_method" "text", "p_operator_id" "uuid", "p_search" "text", "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sales_history"("p_business_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_method" "text", "p_operator_id" "uuid", "p_search" "text", "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_session_summary"("p_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_session_summary"("p_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_session_summary"("p_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_sessions_list"("p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_sessions_list"("p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_sessions_list"("p_limit" integer, "p_offset" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_stats_breakdown"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_stats_breakdown"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_breakdown"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_stats_evolution"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_stats_evolution"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_evolution"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_stats_kpis"("p_business_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_stats_kpis"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_kpis"("p_business_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_top_products_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_top_products_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_products_detail"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "service_role";


CREATE OR REPLACE FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date" DEFAULT NULL::"date", "p_to" "date" DEFAULT NULL::"date", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_timezone text;
  v_data    jsonb;
  v_total   int;
  v_totals  jsonb;
begin
  if auth.uid() is not null then perform public.assert_tenant(p_business_id); end if;

  select timezone into v_timezone from public.businesses where id = p_business_id;
  if v_timezone is null or v_timezone = '' then
    v_timezone := 'America/Argentina/Buenos_Aires';
  end if;

  select count(distinct si.product_id) into v_total
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and si.product_id is not null
    and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
    and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to);

  select jsonb_build_object(
    'revenue',              coalesce(sum(t.revenue), 0),
    'cost_total',           coalesce(sum(t.cost_total), 0),
    'gross_profit',         coalesce(sum(t.revenue) - sum(t.cost_total), 0),
    'margin_pct',           case when coalesce(sum(t.revenue), 0) = 0 then null
                                 else round((sum(t.revenue) - sum(t.cost_total)) / sum(t.revenue) * 100, 2) end,
    'products_count',       count(*),
    'products_without_cost', count(*) filter (where t.units_without_cost > 0)
  )
  into v_totals
  from (
    select
      si.product_id,
      sum(si.total)                                              as revenue,
      sum(si.quantity * COALESCE(pv.cost, p.cost))               as cost_total,
      coalesce(sum(si.quantity) filter (where COALESCE(pv.cost, p.cost) = 0), 0) as units_without_cost
    from sale_items si
    join sales s    on s.id = si.sale_id
    join products p on p.id = si.product_id
    left join product_variants pv on pv.id = si.variant_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
      and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to)
    group by si.product_id
  ) t;

  select jsonb_agg(row)
  into v_data
  from (
    select
      p.id,
      p.name,
      p.sku,
      c.name as category_name,
      b.name as brand_name,
      sum(si.quantity)                                                       as units_sold,
      coalesce(sum(si.quantity) filter (where COALESCE(pv.cost, p.cost) = 0), 0) as units_without_cost,
      sum(si.total)                                                as revenue,
      sum(si.quantity * COALESCE(pv.cost, p.cost))                 as cost_total,
      sum(si.total) - sum(si.quantity * COALESCE(pv.cost, p.cost)) as gross_profit,
      case when sum(si.total) = 0 then null
           else round((sum(si.total) - sum(si.quantity * COALESCE(pv.cost, p.cost))) / sum(si.total) * 100, 2)
      end                                                          as margin_pct
    from sale_items si
    join sales s    on s.id = si.sale_id
    join products p on p.id = si.product_id
    left join product_variants pv on pv.id = si.variant_id
    left join categories c on c.id = p.category_id
    left join brands b     on b.id = p.brand_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and (p_from is null or (s.created_at at time zone v_timezone)::date >= p_from)
      and (p_to   is null or (s.created_at at time zone v_timezone)::date <= p_to)
    group by p.id, p.name, p.sku, c.name, b.name
    order by margin_pct asc nulls last, revenue desc
    limit p_limit offset p_offset
  ) row;

  return jsonb_build_object(
    'data',   coalesce(v_data, '[]'::jsonb),
    'total',  v_total,
    'totals', v_totals
  );
end;
$$;
ALTER FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) FROM "anon";
GRANT ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_margin_analysis"("p_business_id" "uuid", "p_from" "date", "p_to" "date", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."groups_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."groups_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."groups_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."groups_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."groups_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."groups_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."groups_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."groups_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_cast"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_cast"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_check"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_check"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_check"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_check"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_check"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_check"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_check"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_check"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_check"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_check"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_check"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_check"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_column"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_column"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_composite"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_composite"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_composite"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_composite"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_composite"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_composite"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_composite"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_composite"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_composite"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_composite"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_composite"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_composite"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_domain"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_domain"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_domain"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_domain"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_domain"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_domain"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_domain"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_domain"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_enum"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_enum"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_enum"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_enum"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_enum"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_enum"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_enum"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_enum"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_extension"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_extension"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_extension"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_extension"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_extension"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_extension"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_extension"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_extension"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_fk"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_fk"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_fk"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_fk"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_fk"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_fk"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_fk"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_fk"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_fk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_fk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_fk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_fk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_foreign_table"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_foreign_table"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_function"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_group"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_group"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_group"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_group"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_group"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_group"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_group"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_group"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_index"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_inherited_tables"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_language"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_language"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_language"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_language"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_language"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_language"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_language"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_language"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_leftop"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_materialized_view"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_materialized_view"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_opclass"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_opclass"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_opclass"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_opclass"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_opclass"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_opclass"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_operator"("name", "name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_pk"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_pk"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_pk"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_pk"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_pk"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_pk"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_pk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_pk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_relation"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_relation"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_relation"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_relation"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_relation"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_relation"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_relation"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_relation"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_relation"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_relation"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_relation"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_relation"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rightop"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_role"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_role"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rule"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_rule"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_schema"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_schema"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_schema"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_schema"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_schema"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_schema"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_schema"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_schema"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_sequence"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_sequence"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_sequence"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_sequence"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_sequence"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_sequence"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_table"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_table"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_table"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_table"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_table"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_table"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_table"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_table"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_table"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_table"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_table"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_table"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_table"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_table"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_table"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_table"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_tablespace"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_tablespace"("name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_trigger"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_type"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_type"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_type"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_type"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_type"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_type"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_type"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_type"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_type"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_type"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_type"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_type"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_type"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_type"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_type"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_type"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_unique"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_unique"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_unique"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_unique"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_unique"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_unique"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_unique"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_unique"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_unique"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_unique"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_unique"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_unique"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_user"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_user"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_user"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_user"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_user"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_user"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_user"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_user"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_view"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_view"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_view"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_view"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_view"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_view"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."has_view"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_view"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_view"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_view"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_view"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_view"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."has_view"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."has_view"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."has_view"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_view"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_cast"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_column"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_composite"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_composite"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_domain"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_domain"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_enum"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_enum"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_extension"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_extension"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_fk"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_fk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_foreign_table"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_function"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_group"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_group"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_group"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_group"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_group"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_group"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_group"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_group"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_index"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_inherited_tables"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_language"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_language"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_language"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_language"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_language"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_language"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_language"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_language"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_leftop"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_materialized_view"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_opclass"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_operator"("name", "name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_pk"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_pk"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_relation"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_relation"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rightop"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_role"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_role"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_role"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_role"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_role"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_role"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_role"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_role"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_rule"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_schema"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_schema"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_schema"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_schema"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_schema"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_schema"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_schema"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_schema"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_sequence"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_table"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_table"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_tablespace"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_trigger"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_type"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_type"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_user"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_user"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_user"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_user"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_user"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_user"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_user"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_user"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_view"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hasnt_view"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ialike"("anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."imatches"("anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."in_todo"() TO "postgres";
GRANT ALL ON FUNCTION "public"."in_todo"() TO "anon";
GRANT ALL ON FUNCTION "public"."in_todo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."in_todo"() TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_primary"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_primary"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_type"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_unique"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_is_unique"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."index_owner_is"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."indexes_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is"("anyelement", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_aggregate"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_ancestor_of"("name", "name", "name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_clustered"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_clustered"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_clustered"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_clustered"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_clustered"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_definer"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_descendent_of"("name", "name", "name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_empty"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_empty"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_empty"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_empty"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_empty"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_empty"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_empty"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_empty"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_indexed"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_normal_function"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partition_of"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partitioned"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_partitioned"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_procedure"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_strict"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_superuser"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_superuser"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_superuser"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_superuser"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_superuser"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_superuser"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_superuser"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_superuser"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_window"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype") TO "postgres";
GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype") TO "anon";
GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype") TO "service_role";



GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isa_ok"("anyelement", "regtype", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt"("anyelement", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_aggregate"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_ancestor_of"("name", "name", "name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_definer"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_descendent_of"("name", "name", "name", "name", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_empty"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_empty"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_empty"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_empty"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_empty"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_empty"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_empty"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_empty"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_member_of"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_normal_function"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_partitioned"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_procedure"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_strict"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_superuser"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_superuser"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_superuser"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_superuser"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_superuser"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_superuser"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_superuser"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_superuser"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."isnt_window"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."language_is_trusted"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."language_is_trusted"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."language_is_trusted"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."language_is_trusted"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."language_is_trusted"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."language_is_trusted"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."language_is_trusted"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."language_is_trusted"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."language_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."language_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."languages_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."languages_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."languages_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."languages_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."languages_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."languages_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."languages_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."languages_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lives_ok"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."lives_ok"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."lives_ok"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lives_ok"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lives_ok"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."lives_ok"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lives_ok"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lives_ok"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_audit_event"("p_business_id" "uuid", "p_operator_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_label" "text", "p_old_data" "jsonb", "p_new_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_business_id" "uuid", "p_operator_id" "uuid", "p_actor_role" "text", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_entity_label" "text", "p_old_data" "jsonb", "p_new_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_catalog_orders_read"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_catalog_orders_read"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_catalog_orders_read"() TO "service_role";



GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."matches"("anyelement", "text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."normalize_permissions"("p" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_permissions"("p" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_permissions"("p" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_view_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."materialized_views_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."no_plan"() TO "postgres";
GRANT ALL ON FUNCTION "public"."no_plan"() TO "anon";
GRANT ALL ON FUNCTION "public"."no_plan"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."no_plan"() TO "service_role";



GRANT ALL ON FUNCTION "public"."num_failed"() TO "postgres";
GRANT ALL ON FUNCTION "public"."num_failed"() TO "anon";
GRANT ALL ON FUNCTION "public"."num_failed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."num_failed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ok"(boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."ok"(boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."ok"(boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ok"(boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."ok"(boolean, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."ok"(boolean, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ok"(boolean, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ok"(boolean, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclass_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."opclasses_are"("name", "name"[], "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_cash_session"("p_opening_amount" numeric, "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_cash_session"("p_opening_amount" numeric, "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."open_cash_session"("p_opening_amount" numeric, "p_operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."operators_are"("text"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."operators_are"("text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."operators_are"("text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."operators_are"("text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."operators_are"("text"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."operators_are"("text"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."operators_are"("text"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."operators_are"("text"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."operators_are"("name", "text"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."os_name"() TO "postgres";
GRANT ALL ON FUNCTION "public"."os_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."os_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."os_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."partitions_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pass"() TO "postgres";
GRANT ALL ON FUNCTION "public"."pass"() TO "anon";
GRANT ALL ON FUNCTION "public"."pass"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pass"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pass"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."pass"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."pass"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pass"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric) TO "postgres";
GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."performs_ok"("text", numeric, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric) TO "postgres";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."performs_within"("text", numeric, numeric, integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."pg_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."pg_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."pg_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pg_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pg_version_num"() TO "postgres";
GRANT ALL ON FUNCTION "public"."pg_version_num"() TO "anon";
GRANT ALL ON FUNCTION "public"."pg_version_num"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pg_version_num"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pgtap_version"() TO "postgres";
GRANT ALL ON FUNCTION "public"."pgtap_version"() TO "anon";
GRANT ALL ON FUNCTION "public"."pgtap_version"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."pgtap_version"() TO "service_role";



GRANT ALL ON FUNCTION "public"."plan"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."plan"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."plan"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."plan"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policies_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_cmd_is"("name", "name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."policy_roles_are"("name", "name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."product_variants_snapshot"("p_business_id" "uuid", "p_product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."product_variants_snapshot"("p_business_id" "uuid", "p_product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."product_variants_snapshot"("p_business_id" "uuid", "p_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_sales_count"("p_business_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_sales_count"("p_business_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_sales_count"("p_business_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_all_daily_snapshots"("p_snapshot_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_all_daily_snapshots"("p_snapshot_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."relation_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "refcursor", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("refcursor", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "refcursor", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_eq"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_eq"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "refcursor", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("refcursor", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "refcursor", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."results_ne"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."results_ne"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."roles_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."roles_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."roles_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."roles_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."roles_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."roles_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."roles_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."roles_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement") TO "postgres";
GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement") TO "anon";
GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement") TO "authenticated";
GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement") TO "service_role";



GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."row_eq"("text", "anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_instead"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rule_is_on"("name", "name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rules_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."runtests"() TO "postgres";
GRANT ALL ON FUNCTION "public"."runtests"() TO "anon";
GRANT ALL ON FUNCTION "public"."runtests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."runtests"() TO "service_role";



GRANT ALL ON FUNCTION "public"."runtests"("name") TO "postgres";
GRANT ALL ON FUNCTION "public"."runtests"("name") TO "anon";
GRANT ALL ON FUNCTION "public"."runtests"("name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."runtests"("name") TO "service_role";



GRANT ALL ON FUNCTION "public"."runtests"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."runtests"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."runtests"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."runtests"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."runtests"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."runtests"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."runtests"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."runtests"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."schema_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."schema_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."schemas_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."schemas_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."schemas_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."schemas_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."schemas_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."schemas_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."schemas_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."schemas_are"("name"[], "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_expense_products"("p_business_id" "uuid", "p_term" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_expense_products"("p_business_id" "uuid", "p_term" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_expense_products"("p_business_id" "uuid", "p_term" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequence_privs_are"("name", "name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sequences_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sequences_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sequences_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequences_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sequences_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequences_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sequences_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequences_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sequences_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."server_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_eq"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_eq"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_eq"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_has"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_has"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_has"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_has"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_has"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_has"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_has"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_has"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_hasnt"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray") TO "anon";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_ne"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "anyarray", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_ne"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_ne"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."settle_customer_credit"("p_customer_id" "uuid", "p_amount" numeric, "p_method" "text", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."settle_customer_credit"("p_customer_id" "uuid", "p_amount" numeric, "p_method" "text", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."settle_customer_credit"("p_customer_id" "uuid", "p_amount" numeric, "p_method" "text", "p_operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."skip"(integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."skip"(integer) TO "anon";
GRANT ALL ON FUNCTION "public"."skip"(integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."skip"(integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."skip"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."skip"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."skip"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."skip"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."skip"(integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."skip"(integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."skip"(integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."skip"(integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."skip"("why" "text", "how_many" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."skip"("why" "text", "how_many" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."skip"("why" "text", "how_many" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."skip"("why" "text", "how_many" integer) TO "service_role";





GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."table_privs_are"("name", "name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tables_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."tables_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."tables_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tables_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."tables_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."tables_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tables_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tables_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tables_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tablespace_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tablespace_privs_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tablespaces_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ilike"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_imatching"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_like"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_like"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_like"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_like"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_like"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_like"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_like"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_like"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_matching"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ok"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ok"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ok"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ok"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ok"("text", character, "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", character, "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", character, "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", character, "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."throws_ok"("text", integer, "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."todo"("how_many" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."todo"("how_many" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."todo"("how_many" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."todo"("how_many" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."todo"("why" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."todo"("why" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."todo"("why" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."todo"("why" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."todo"("how_many" integer, "why" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."todo"("how_many" integer, "why" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."todo"("how_many" integer, "why" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."todo"("how_many" integer, "why" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."todo"("why" "text", "how_many" integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."todo"("why" "text", "how_many" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."todo"("why" "text", "how_many" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."todo"("why" "text", "how_many" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."todo_end"() TO "postgres";
GRANT ALL ON FUNCTION "public"."todo_end"() TO "anon";
GRANT ALL ON FUNCTION "public"."todo_end"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."todo_end"() TO "service_role";



GRANT ALL ON FUNCTION "public"."todo_start"() TO "postgres";
GRANT ALL ON FUNCTION "public"."todo_start"() TO "anon";
GRANT ALL ON FUNCTION "public"."todo_start"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."todo_start"() TO "service_role";



GRANT ALL ON FUNCTION "public"."todo_start"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."todo_start"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."todo_start"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."todo_start"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_is"("name", "name", "name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."triggers_are"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."type_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."types_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."types_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."types_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."types_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."types_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."types_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."types_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."types_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."types_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unalike"("anyelement", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unialike"("anyelement", "text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid", "p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_brand"("p_operator_id" "uuid", "p_business_id" "uuid", "p_brand_id" "uuid", "p_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_business_settings"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_whatsapp" "text", "p_logo_url" "text", "p_settings_patch" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_business_settings"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_whatsapp" "text", "p_logo_url" "text", "p_settings_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_business_settings"("p_operator_id" "uuid", "p_business_id" "uuid", "p_name" "text", "p_description" "text", "p_whatsapp" "text", "p_logo_url" "text", "p_settings_patch" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_business_slug"("p_operator_id" "uuid", "p_business_id" "uuid", "p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_business_slug"("p_operator_id" "uuid", "p_business_id" "uuid", "p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_business_slug"("p_operator_id" "uuid", "p_business_id" "uuid", "p_slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_catalog_order_status"("p_operator_id" "uuid", "p_order_id" "uuid", "p_new_status" "text", "p_blacklist" boolean, "p_payment_method" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_catalog_order_status"("p_operator_id" "uuid", "p_order_id" "uuid", "p_new_status" "text", "p_blacklist" boolean, "p_payment_method" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_catalog_order_status"("p_operator_id" "uuid", "p_order_id" "uuid", "p_new_status" "text", "p_blacklist" boolean, "p_payment_method" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_category"("p_operator_id" "uuid", "p_business_id" "uuid", "p_category_id" "uuid", "p_name" "text", "p_icon" "text", "p_icon_color" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_customer_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_customer_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_customer"("p_operator_id" "uuid", "p_business_id" "uuid", "p_customer_id" "uuid", "p_name" "text", "p_phone" "text", "p_email" "text", "p_dni" "text", "p_credit_limit" numeric, "p_is_credit_enabled" boolean, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_amount" numeric, "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_amount" numeric, "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_amount" numeric, "p_attachment_url" "text", "p_attachment_type" "text", "p_attachment_name" "text", "p_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_mercaderia_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_mercaderia_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_mercaderia_expense"("p_business_id" "uuid", "p_expense_id" "uuid", "p_description" "text", "p_date" "date", "p_supplier_id" "uuid", "p_notes" "text", "p_items" "jsonb", "p_operator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid", "p_name" "text", "p_new_pin" "text", "p_permissions" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid", "p_name" "text", "p_new_pin" "text", "p_permissions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_operator"("p_actor_operator_id" "uuid", "p_business_id" "uuid", "p_target_operator_id" "uuid", "p_name" "text", "p_new_pin" "text", "p_permissions" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides_upsert" "jsonb", "p_overrides_delete_ids" "uuid"[], "p_round_step" numeric, "p_round_up" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides_upsert" "jsonb", "p_overrides_delete_ids" "uuid"[], "p_round_step" numeric, "p_round_up" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_price_list"("p_operator_id" "uuid", "p_business_id" "uuid", "p_price_list_id" "uuid", "p_name" "text", "p_description" "text", "p_multiplier" numeric, "p_overrides_upsert" "jsonb", "p_overrides_delete_ids" "uuid"[], "p_round_step" numeric, "p_round_up" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_changes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_product"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_changes" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_product_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_options" "jsonb", "p_variants" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_product_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_options" "jsonb", "p_variants" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_product_variants"("p_operator_id" "uuid", "p_business_id" "uuid", "p_product_id" "uuid", "p_options" "jsonb", "p_variants" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean, "p_is_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean, "p_is_active" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_promotion"("p_operator_id" "uuid", "p_business_id" "uuid", "p_promotion_id" "uuid", "p_name" "text", "p_kind" "text", "p_percent" numeric, "p_offer_price" numeric, "p_group_size" integer, "p_affected_units" integer, "p_pay_percent" numeric, "p_product_id" "uuid", "p_category_id" "uuid", "p_brand_id" "uuid", "p_starts_at" timestamp with time zone, "p_ends_at" timestamp with time zone, "p_show_in_catalog" boolean, "p_is_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_operator_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_operator_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_sale"("p_sale_id" "uuid", "p_business_id" "uuid", "p_items" "jsonb", "p_payment_method" "text", "p_operator_id" "uuid", "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_stock_on_sale"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_stock_on_sale"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_stock_on_sale"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_supplier"("p_operator_id" "uuid", "p_business_id" "uuid", "p_supplier_id" "uuid", "p_name" "text", "p_contact_name" "text", "p_phone" "text", "p_email" "text", "p_address" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_daily_snapshot"("p_business_id" "uuid", "p_snapshot_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_session_digital_balance"("p_session_id" "uuid", "p_method" "text", "p_opening_balance" numeric, "p_closing_balance" numeric, "p_operator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_session_digital_balance"("p_session_id" "uuid", "p_method" "text", "p_opening_balance" numeric, "p_closing_balance" numeric, "p_operator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_session_digital_balance"("p_session_id" "uuid", "p_method" "text", "p_opening_balance" numeric, "p_closing_balance" numeric, "p_operator_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."users_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."users_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."users_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."users_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."users_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."users_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."users_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."users_are"("name"[], "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_operator_pin"("p_business_id" "uuid", "p_operator_id" "uuid", "p_pin" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_operator_pin"("p_business_id" "uuid", "p_operator_id" "uuid", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_operator_pin"("p_business_id" "uuid", "p_operator_id" "uuid", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name") TO "postgres";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name") TO "anon";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name") TO "authenticated";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name") TO "service_role";



GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."view_owner_is"("name", "name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."views_are"("name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."views_are"("name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."views_are"("name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."views_are"("name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."views_are"("name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."views_are"("name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."views_are"("name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."views_are"("name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."views_are"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name"[], "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."volatility_is"("name", "name", "name"[], "text", "text") TO "service_role";






























GRANT ALL ON TABLE "public"."attribute_types" TO "anon";
GRANT ALL ON TABLE "public"."attribute_types" TO "authenticated";
GRANT ALL ON TABLE "public"."attribute_types" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



-- ai_insights: sin anon (datos privados; RLS bloquea anon, grants tampoco — regla 34).
GRANT ALL ON TABLE "public"."ai_insights" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_insights" TO "service_role";



GRANT ALL ON TABLE "public"."brands" TO "anon";
GRANT ALL ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."businesses" TO "anon";
GRANT ALL ON TABLE "public"."businesses" TO "authenticated";
GRANT ALL ON TABLE "public"."businesses" TO "service_role";



GRANT ALL ON TABLE "public"."cash_sessions" TO "anon";
GRANT ALL ON TABLE "public"."cash_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_order_counters" TO "anon";
GRANT ALL ON TABLE "public"."catalog_order_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_order_counters" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_order_items" TO "anon";
GRANT ALL ON TABLE "public"."catalog_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_orders" TO "anon";
GRANT ALL ON TABLE "public"."catalog_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_orders" TO "service_role";



GRANT ALL ON TABLE "public"."catalog_phone_blacklist" TO "anon";
GRANT ALL ON TABLE "public"."catalog_phone_blacklist" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_phone_blacklist" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."customer_account_movements" TO "anon";
GRANT ALL ON TABLE "public"."customer_account_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_account_movements" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."daily_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."daily_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."expense_items" TO "anon";
GRANT ALL ON TABLE "public"."expense_items" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_items" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT ALL ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT ALL ON TABLE "public"."inventory_movements" TO "anon";
GRANT ALL ON TABLE "public"."inventory_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."inventory_movements" TO "service_role";



GRANT ALL ON TABLE "public"."operators" TO "anon";
GRANT ALL ON TABLE "public"."operators" TO "authenticated";
GRANT ALL ON TABLE "public"."operators" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."price_list_overrides" TO "anon";
GRANT ALL ON TABLE "public"."price_list_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."price_list_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."price_lists" TO "anon";
GRANT ALL ON TABLE "public"."price_lists" TO "authenticated";
GRANT ALL ON TABLE "public"."price_lists" TO "service_role";



GRANT ALL ON TABLE "public"."product_option_values" TO "anon";
GRANT ALL ON TABLE "public"."product_option_values" TO "authenticated";
GRANT ALL ON TABLE "public"."product_option_values" TO "service_role";



GRANT ALL ON TABLE "public"."product_options" TO "anon";
GRANT ALL ON TABLE "public"."product_options" TO "authenticated";
GRANT ALL ON TABLE "public"."product_options" TO "service_role";



GRANT ALL ON TABLE "public"."product_variant_option_values" TO "anon";
GRANT ALL ON TABLE "public"."product_variant_option_values" TO "authenticated";
GRANT ALL ON TABLE "public"."product_variant_option_values" TO "service_role";



GRANT ALL ON TABLE "public"."product_variants" TO "anon";
GRANT ALL ON TABLE "public"."product_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."product_variants" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."promotions" TO "anon";
GRANT ALL ON TABLE "public"."promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."promotions" TO "service_role";



GRANT ALL ON TABLE "public"."sale_items" TO "anon";
GRANT ALL ON TABLE "public"."sale_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_items" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."session_digital_balances" TO "anon";
GRANT ALL ON TABLE "public"."session_digital_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."session_digital_balances" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































