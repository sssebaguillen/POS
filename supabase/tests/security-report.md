# SQL Security Test Report

**Date:** 2026-05-15
**Tool:** pgTAP 1.3.3
**Database:** Pulsar POS — `zrnthcznbrplzpmxmkwk` (sa-east-1)
**Total:** 42 tests, 42 passed, 0 failed

---

## Test Results

| # | Group | Tests | Result |
|---|-------|-------|--------|
| 1 | RLS enabled on all 22 public tables | 22 | ✅ Pass |
| 2 | Anon grants revoked/preserved correctly | 10 | ✅ Pass |
| 3 | WITH CHECK present on all write policies | 3 | ✅ Pass |
| 4 | search_path consistency + no orphaned RLS tables | 3 | ✅ Pass |
| 5 | Critical function guards | 2 | ✅ Pass |
| 6 | create_operator + verify_operator_pin scoping | 2 | ✅ Pass |

---

## Group Detail

### 1. RLS enabled on all 22 public tables (22 tests)
Verified `rowsecurity = true` on every table in the public schema:
`products`, `sales`, `sale_items`, `payments`, `categories`, `brands`, `operators`, `customers`, `cash_sessions`, `expenses`, `expense_items`, `suppliers`, `profiles`, `businesses`, `inventory_movements`, `price_lists`, `price_list_overrides`, `product_options`, `product_variants`, `product_option_values`, `product_variant_option_values`, `attribute_types`.

### 2. Anon grants revoked/preserved correctly (10 tests)
Verified anon grant is **revoked** on: `create_sale_transaction`, `delete_sale`, `bulk_delete_products`, `create_operator`, `get_stats_kpis`.  
Verified anon grant is **preserved** on: `get_catalog_products`, `get_catalog_categories`, `bootstrap_new_user`, `verify_operator_pin`.  
Verified authenticated grant is **present** on: `create_sale_transaction`.

### 3. WITH CHECK present on all write policies (3 tests)
Verified no ALL, UPDATE, or INSERT policy has `with_check IS NULL`.
All 24 write policies now have explicit WITH CHECK expressions matching their USING predicates.

### 4. search_path consistency + no orphaned RLS tables (3 tests)
Verified all SECURITY DEFINER functions (except `rls_auto_enable`) have `search_path = public, extensions`.  
Verified `rls_auto_enable` correctly uses `search_path = pg_catalog` (DDL event trigger requirement).  
Verified no RLS-enabled table is missing policies (previously `attribute_types`, `product_option_values`, `product_variant_option_values` had no policies — fixed).

### 5. Critical function guards (2 tests)
Verified `bootstrap_new_user` contains `auth.uid()` guard with 403 return on mismatch.  
Verified `reconcile_sales_count` contains `IS NULL` guard (fixed from `p_business_id != get_business_id()` which evaluated to NULL for anon callers).

### 6. create_operator + verify_operator_pin scoping (2 tests)
Verified `create_operator` includes the `expenses` permission field.  
Verified `verify_operator_pin` scopes by `business_id = p_business_id` parameter (not `get_business_id()` — correct, since this RPC is called pre-auth with the business_id as an explicit parameter).

---

## Notes

- Initial test count was 40 but actual sum is 42 (22+10+3+3+2+2). `plan(42)` used in `security.sql`.
- One test was initially incorrect: `verify_operator_pin` was tested for `get_business_id()` usage but correctly uses `p_business_id` parameter instead. Test was corrected before saving to `security.sql`.
- pgTAP 1.3.3 was available as an extension in Postgres 17.6.1 on Supabase Free tier (sa-east-1). Installed via `CREATE EXTENSION pgtap`.
- All tests run inside `BEGIN/ROLLBACK` — no data was modified.

---

## How to re-run

Open Supabase SQL Editor and run the contents of `supabase/tests/security.sql`.

Re-run after every DB migration that touches:
- RLS policies
- SECURITY DEFINER functions
- Grant/revoke operations
- New tables added to public schema
