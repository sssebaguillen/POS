-- ============================================================
-- Expandir audit_log para incluir promotion
-- ============================================================
-- Las RPCs create/update/archive_promotion (20260609_05) llaman a
-- log_audit_event con entity_type = 'promotion', pero el CHECK
-- audit_log_entity_type_check nunca se amplió. Como log_audit_event
-- traga excepciones (EXCEPTION WHEN OTHERS THEN NULL), los eventos
-- de promociones se perdían en silencio.

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_type_check
  CHECK (entity_type IN (
    'sale','product','category','brand',
    'expense','supplier','price_list','setting','operator','customer',
    'catalog_order','promotion'
  ));
