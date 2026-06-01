-- =============================================================
-- Batch A — DB structure audit (2026-06-01)
-- Performance-only, behavior-preserving. No data changes.
--
-- Sources (read-only diagnostics):
--   get_advisors(performance) — unindexed_foreign_keys, auth_rls_initplan,
--                               duplicate_index
--   Supabase Postgres best practices: schema-foreign-key-indexes,
--                                     security-rls-performance
--
-- Three changes, all non-breaking:
--   1. Add covering indexes on 10 unindexed foreign keys (10-100x JOINs).
--   2. Wrap get_business_id()/auth.uid() in (select ...) in 6 RLS policies
--      so they are evaluated once per statement (InitPlan), not per row.
--      Semantically identical — pure planner optimization.
--   3. Drop the duplicate UNIQUE constraint businesses_slug_unique
--      (businesses_slug_key still enforces slug uniqueness; the dropped
--      one was schema drift, present in no tracked migration).
--
-- Note: plain CREATE INDEX (not CONCURRENTLY) is used deliberately — the
-- DB has no production traffic yet and tables are tiny, so the brief lock
-- is negligible and this can run inside the migration transaction. Once
-- live with traffic, prefer CREATE INDEX CONCURRENTLY (outside a txn).
-- =============================================================

-- -------------------------------------------------------------
-- 1. Covering indexes for unindexed foreign keys
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_catalog_order_items_product_id
  ON public.catalog_order_items USING btree (product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_order_items_variant_id
  ON public.catalog_order_items USING btree (variant_id);
CREATE INDEX IF NOT EXISTS idx_catalog_orders_sale_id
  ON public.catalog_orders USING btree (sale_id);
CREATE INDEX IF NOT EXISTS idx_daily_snapshots_top_product_id
  ON public.daily_snapshots USING btree (top_product_id);
CREATE INDEX IF NOT EXISTS idx_feedback_operator_id
  ON public.feedback USING btree (operator_id);
CREATE INDEX IF NOT EXISTS idx_product_options_attribute_type_id
  ON public.product_options USING btree (attribute_type_id);
CREATE INDEX IF NOT EXISTS idx_product_variant_option_values_option_value_id
  ON public.product_variant_option_values USING btree (option_value_id);
CREATE INDEX IF NOT EXISTS idx_products_default_variant_id
  ON public.products USING btree (default_variant_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_variant_id
  ON public.sale_items USING btree (variant_id);
CREATE INDEX IF NOT EXISTS idx_session_digital_balances_entered_by
  ON public.session_digital_balances USING btree (entered_by);

-- -------------------------------------------------------------
-- 2. RLS InitPlan optimization — wrap volatile/stable calls in (select ...)
--    ALTER POLICY is atomic: the policy is never absent (no security gap).
--    Expressions reproduced verbatim from pg_policies, only adding the wrap.
-- -------------------------------------------------------------

-- profiles.own_profile (ALL)
ALTER POLICY own_profile ON public.profiles
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- products_stock_write_insert (INSERT — WITH CHECK only)
ALTER POLICY products_stock_write_insert ON public.products
  WITH CHECK (
    (business_id = (select get_business_id()))
    AND (
      (EXISTS (SELECT 1 FROM profiles
        WHERE profiles.id = (select auth.uid())
          AND profiles.business_id = (select get_business_id())))
      OR (EXISTS (SELECT 1 FROM operators
        WHERE operators.id = (select auth.uid())
          AND operators.business_id = (select get_business_id())
          AND operators.is_active = true
          AND ((operators.permissions ->> 'stock_write')::boolean = true)))
    )
  );

-- products_stock_write_update (UPDATE — USING + WITH CHECK)
ALTER POLICY products_stock_write_update ON public.products
  USING (
    (business_id = (select get_business_id()))
    AND (
      (EXISTS (SELECT 1 FROM profiles
        WHERE profiles.id = (select auth.uid())
          AND profiles.business_id = (select get_business_id())))
      OR (EXISTS (SELECT 1 FROM operators
        WHERE operators.id = (select auth.uid())
          AND operators.business_id = (select get_business_id())
          AND operators.is_active = true
          AND ((operators.permissions ->> 'stock_write')::boolean = true)))
    )
  )
  WITH CHECK (
    (business_id = (select get_business_id()))
    AND (
      (EXISTS (SELECT 1 FROM profiles
        WHERE profiles.id = (select auth.uid())
          AND profiles.business_id = (select get_business_id())))
      OR (EXISTS (SELECT 1 FROM operators
        WHERE operators.id = (select auth.uid())
          AND operators.business_id = (select get_business_id())
          AND operators.is_active = true
          AND ((operators.permissions ->> 'stock_write')::boolean = true)))
    )
  );

-- products_stock_write_delete (DELETE — USING only)
ALTER POLICY products_stock_write_delete ON public.products
  USING (
    (business_id = (select get_business_id()))
    AND (
      (EXISTS (SELECT 1 FROM profiles
        WHERE profiles.id = (select auth.uid())
          AND profiles.business_id = (select get_business_id())))
      OR (EXISTS (SELECT 1 FROM operators
        WHERE operators.id = (select auth.uid())
          AND operators.business_id = (select get_business_id())
          AND operators.is_active = true
          AND ((operators.permissions ->> 'stock_write')::boolean = true)))
    )
  );

-- price_list_overrides_stock_write_update (UPDATE — USING + WITH CHECK)
ALTER POLICY price_list_overrides_stock_write_update ON public.price_list_overrides
  USING (
    (price_list_id IN (SELECT price_lists.id FROM price_lists
        WHERE price_lists.business_id = (select get_business_id())))
    AND (
      (EXISTS (SELECT 1 FROM profiles
        WHERE profiles.id = (select auth.uid())
          AND profiles.business_id = (select get_business_id())))
      OR (EXISTS (SELECT 1 FROM operators
        WHERE operators.id = (select auth.uid())
          AND operators.business_id = (select get_business_id())
          AND operators.is_active = true
          AND ((operators.permissions ->> 'stock_write')::boolean = true)))
    )
  )
  WITH CHECK (
    (price_list_id IN (SELECT price_lists.id FROM price_lists
        WHERE price_lists.business_id = (select get_business_id())))
    AND (
      (EXISTS (SELECT 1 FROM profiles
        WHERE profiles.id = (select auth.uid())
          AND profiles.business_id = (select get_business_id())))
      OR (EXISTS (SELECT 1 FROM operators
        WHERE operators.id = (select auth.uid())
          AND operators.business_id = (select get_business_id())
          AND operators.is_active = true
          AND ((operators.permissions ->> 'stock_write')::boolean = true)))
    )
  );

-- price_list_overrides_stock_write_delete (DELETE — USING only)
ALTER POLICY price_list_overrides_stock_write_delete ON public.price_list_overrides
  USING (
    (price_list_id IN (SELECT price_lists.id FROM price_lists
        WHERE price_lists.business_id = (select get_business_id())))
    AND (
      (EXISTS (SELECT 1 FROM profiles
        WHERE profiles.id = (select auth.uid())
          AND profiles.business_id = (select get_business_id())))
      OR (EXISTS (SELECT 1 FROM operators
        WHERE operators.id = (select auth.uid())
          AND operators.business_id = (select get_business_id())
          AND operators.is_active = true
          AND ((operators.permissions ->> 'stock_write')::boolean = true)))
    )
  );

-- -------------------------------------------------------------
-- 3. Drop duplicate unique constraint on businesses.slug
--    businesses_slug_key (tracked in schema.sql) remains the enforcer.
-- -------------------------------------------------------------
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_slug_unique;
