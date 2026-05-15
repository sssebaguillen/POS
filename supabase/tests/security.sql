-- pgTAP security test suite for Pulsar POS
--
-- Run with: SELECT * FROM runtests();
-- Or paste directly in Supabase SQL Editor
--
-- Wrapped in BEGIN/ROLLBACK so the tests never commit.

BEGIN;

SELECT plan(42);

-- =============================================================================
-- 1. RLS enabled on all 22 public tables (22 tests)
-- =============================================================================

SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='products'), 'products has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='sales'), 'sales has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='sale_items'), 'sale_items has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='payments'), 'payments has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='categories'), 'categories has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='brands'), 'brands has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='operators'), 'operators has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='customers'), 'customers has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='cash_sessions'), 'cash_sessions has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='expenses'), 'expenses has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='expense_items'), 'expense_items has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='suppliers'), 'suppliers has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='profiles'), 'profiles has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='businesses'), 'businesses has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='inventory_movements'), 'inventory_movements has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='price_lists'), 'price_lists has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='price_list_overrides'), 'price_list_overrides has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='product_options'), 'product_options has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='product_variants'), 'product_variants has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='product_option_values'), 'product_option_values has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='product_variant_option_values'), 'product_variant_option_values has RLS enabled');
SELECT ok((SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='attribute_types'), 'attribute_types has RLS enabled');

-- =============================================================================
-- 2. Anon grants revoked/preserved correctly (10 tests)
-- =============================================================================

-- These RPCs must NOT have an anon grant
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'create_sale_transaction'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'create_sale_transaction has no anon EXECUTE grant'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'delete_sale'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'delete_sale has no anon EXECUTE grant'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'bulk_delete_products'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'bulk_delete_products has no anon EXECUTE grant'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'create_operator'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'create_operator has no anon EXECUTE grant'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'get_stats_kpis'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'get_stats_kpis has no anon EXECUTE grant'
);

-- These RPCs MUST have an anon grant (catalog + auth bootstrap)
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'get_catalog_products'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'get_catalog_products has anon EXECUTE grant'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'get_catalog_categories'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'get_catalog_categories has anon EXECUTE grant'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'bootstrap_new_user'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'bootstrap_new_user has anon EXECUTE grant'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'verify_operator_pin'
      AND grantee = 'anon'
      AND privilege_type = 'EXECUTE'
  ),
  'verify_operator_pin has anon EXECUTE grant'
);

-- create_sale_transaction must remain callable by authenticated
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'create_sale_transaction'
      AND grantee = 'authenticated'
      AND privilege_type = 'EXECUTE'
  ),
  'create_sale_transaction has authenticated EXECUTE grant'
);

-- =============================================================================
-- 3. WITH CHECK present on all write policies (3 tests)
-- =============================================================================

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND cmd = 'ALL' AND with_check IS NULL),
  0,
  'No ALL policy has NULL with_check'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND cmd = 'UPDATE' AND with_check IS NULL),
  0,
  'No UPDATE policy has NULL with_check'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND cmd = 'INSERT' AND with_check IS NULL),
  0,
  'No INSERT policy has NULL with_check'
);

-- =============================================================================
-- 4. search_path consistency + no orphaned RLS tables (3 tests)
-- =============================================================================

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname <> 'rls_auto_enable'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
        WHERE cfg = 'search_path=public, extensions'
      )
  ),
  0,
  'All SECURITY DEFINER functions (except rls_auto_enable) have search_path=public, extensions'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'rls_auto_enable'
      AND 'search_path=pg_catalog' = ANY (coalesce(p.proconfig, ARRAY[]::text[]))
  ),
  'rls_auto_enable has search_path=pg_catalog'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.rowsecurity = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename
      )
  ),
  0,
  'No RLS-enabled table is missing policies'
);

-- =============================================================================
-- 5. Critical function guards (2 tests)
-- =============================================================================

SELECT ok(
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%auth.uid()%'
       AND pg_get_functiondef(p.oid) LIKE '%403%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'bootstrap_new_user'
    LIMIT 1
  ),
  'bootstrap_new_user has auth.uid() guard with 403'
);

SELECT ok(
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%IS NULL%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'reconcile_sales_count'
    LIMIT 1
  ),
  'reconcile_sales_count has IS NULL guard'
);

-- =============================================================================
-- 6. create_operator + verify_operator_pin scoping (2 tests)
-- =============================================================================

SELECT ok(
  (
    SELECT pg_get_functiondef(p.oid) LIKE '%expenses%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_operator'
    LIMIT 1
  ),
  'create_operator includes expenses field'
);

SELECT ok(
  (
    SELECT pg_get_function_arguments(p.oid) LIKE '%p_business_id%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'verify_operator_pin'
    LIMIT 1
  ),
  'verify_operator_pin scoped by p_business_id parameter'
);

SELECT * FROM finish();

ROLLBACK;
