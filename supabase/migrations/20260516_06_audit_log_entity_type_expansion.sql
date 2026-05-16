-- P7h Phase 2: expand audit_log.entity_type CHECK to cover Phase 2 domains.
-- Adds: expense, supplier, price_list, setting, operator.
--
-- entity_id remains NOT NULL. For business-scoped entries that don't have a
-- natural row id (settings, slug, default-list swap, bulk-like operations),
-- the convention from Phase 1 is to use business_id as the entity_id sentinel.

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type IN (
    'sale', 'product', 'category', 'brand',
    'expense', 'supplier', 'price_list', 'setting', 'operator'
  ));
