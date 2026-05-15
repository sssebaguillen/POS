-- Audit log (P7h Phase 1): single polymorphic table, written explicitly
-- from inside existing RPCs (no triggers, no GUCs). Scope: sales, products,
-- categories, brands. Retention is unbounded.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  operator_id   uuid        NOT NULL,
  actor_role    text        NOT NULL CHECK (actor_role IN ('owner','manager','cashier','custom')),
  action        text        NOT NULL,
  entity_type   text        NOT NULL CHECK (entity_type IN ('sale','product','category','brand')),
  entity_id     uuid        NOT NULL,
  entity_label  text,
  old_data      jsonb,
  new_data      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_business_created_idx
  ON public.audit_log (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_business_entity_created_idx
  ON public.audit_log (business_id, entity_type, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business isolation" ON public.audit_log;
CREATE POLICY "business isolation" ON public.audit_log
  FOR ALL
  USING      (business_id = get_business_id())
  WITH CHECK (business_id = get_business_id());


-- Helper: only called from other SECURITY DEFINER functions. Wrap the INSERT
-- in an exception block so a logging failure never aborts the parent RPC's
-- transaction (PL/pgSQL EXCEPTION blocks create implicit savepoints, so the
-- inner failure is contained).
--
-- Revoked from PUBLIC so authenticated/anon clients can't invoke directly
-- to forge audit rows with arbitrary business_id / operator_id.
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_business_id  uuid,
  p_operator_id  uuid,
  p_actor_role   text,
  p_action       text,
  p_entity_type  text,
  p_entity_id    uuid,
  p_entity_label text  DEFAULT NULL,
  p_old_data     jsonb DEFAULT NULL,
  p_new_data     jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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

REVOKE EXECUTE ON FUNCTION public.log_audit_event(uuid, uuid, text, text, text, uuid, text, jsonb, jsonb) FROM PUBLIC;
