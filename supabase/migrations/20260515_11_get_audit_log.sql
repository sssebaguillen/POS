-- P7h Phase 1: paginated, filtered read API for the audit_log table.
-- Used by the /activity page (owner + manager only — gated client-side
-- by permissions.stats, defended server-side by the business_id match
-- and the table's RLS policy).

CREATE OR REPLACE FUNCTION public.get_audit_log(
  p_business_id uuid,
  p_entity_type text        DEFAULT NULL,
  p_operator_id uuid        DEFAULT NULL,
  p_date_from   timestamptz DEFAULT NULL,
  p_date_to     timestamptz DEFAULT NULL,
  p_limit       integer     DEFAULT 50,
  p_offset      integer     DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_rows  jsonb;
  v_total bigint;
BEGIN
  v_caller_business_id := get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('data', '[]'::jsonb, 'total', 0);
  END IF;

  -- p_operator_id sentinel '00000000-0000-0000-0000-000000000000' means filter
  -- by owner (operator_id IS NULL). Any other UUID filters by that operator.
  -- NULL means no operator filter.

  SELECT COUNT(*) INTO v_total
  FROM public.audit_log al
  WHERE al.business_id = p_business_id
    AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (
      p_operator_id IS NULL
      OR (p_operator_id = '00000000-0000-0000-0000-000000000000'::uuid AND al.operator_id IS NULL)
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
      COALESCE(o.name, 'Dueño') AS actor_name
    FROM public.audit_log al
    LEFT JOIN public.operators o ON o.id = al.operator_id
    WHERE al.business_id = p_business_id
      AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
      AND (
        p_operator_id IS NULL
        OR (p_operator_id = '00000000-0000-0000-0000-000000000000'::uuid AND al.operator_id IS NULL)
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

REVOKE EXECUTE ON FUNCTION public.get_audit_log(uuid, text, uuid, timestamptz, timestamptz, integer, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_audit_log(uuid, text, uuid, timestamptz, timestamptz, integer, integer) TO authenticated;
