-- Owner POS actions pass operator_id = null by convention (null === "Dueño"
-- across the app). The original NOT NULL constraint silently dropped those
-- audit rows because log_audit_event swallows insert failures.

ALTER TABLE public.audit_log ALTER COLUMN operator_id DROP NOT NULL;
