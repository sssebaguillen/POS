-- Audit: Database Security (2026-05-14) — Priority 5
-- Add explicit WITH CHECK to all ALL policies. PostgreSQL falls back to the
-- USING clause when WITH CHECK is NULL, so behavior is unchanged — this is
-- defense in depth and makes intent explicit. WITH CHECK expressions mirror
-- the existing USING (`qual`) predicates verbatim.

BEGIN;

ALTER POLICY "tenant_isolation" ON public.brands
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.cash_sessions
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.categories
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.customers
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "owner_manage_expense_items" ON public.expense_items
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "expenses_business_access" ON public.expenses
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.inventory_movements
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.operators
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.payments
  WITH CHECK (
    sale_id IN (
      SELECT sales.id
      FROM sales
      WHERE sales.business_id = get_business_id()
    )
  );

ALTER POLICY "tenant_isolation" ON public.price_lists
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.product_options
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "tenant_isolation" ON public.product_variants
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "own_profile" ON public.profiles
  WITH CHECK (id = auth.uid());

ALTER POLICY "tenant_isolation" ON public.sale_items
  WITH CHECK (
    sale_id IN (
      SELECT sales.id
      FROM sales
      WHERE sales.business_id = get_business_id()
    )
  );

ALTER POLICY "tenant_isolation" ON public.sales
  WITH CHECK (business_id = get_business_id());

ALTER POLICY "suppliers_business_access" ON public.suppliers
  WITH CHECK (business_id = get_business_id());

COMMIT;
