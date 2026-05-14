-- Audit: Database Security (2026-05-14) — Priority 7
-- Drop the redundant `public_read_categories` SELECT policy on categories.
-- The `tenant_isolation` ALL policy already covers SELECT with the identical
-- `business_id = get_business_id()` predicate. The name was misleading: the
-- predicate uses `get_business_id()` which returns NULL for anon, so it never
-- permitted public reads. The catalog anon path uses SECURITY DEFINER RPCs.

DROP POLICY "public_read_categories" ON public.categories;
