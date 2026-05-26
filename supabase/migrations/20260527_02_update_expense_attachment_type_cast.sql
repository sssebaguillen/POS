-- Fix: update_expense was assigning the text param p_attachment_type directly to
-- the column expenses.attachment_type, which is the enum expense_attachment_type.
-- Postgres won't auto-cast text → enum in an UPDATE assignment, so any edit that
-- set a non-null attachment_type failed with "column is of type
-- expense_attachment_type but expression is of type text". The client surfaced
-- this as the generic EXP-1 fallback ("No se pudo guardar el gasto").
--
-- create_expense already does the explicit cast (p_attachment_type::public.expense_attachment_type).
-- This migration matches that pattern in update_expense. No signature change.

CREATE OR REPLACE FUNCTION public.update_expense(
  p_business_id     uuid,
  p_expense_id      uuid,
  p_description     text,
  p_date            date,
  p_supplier_id     uuid    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_amount          numeric DEFAULT 0,
  p_attachment_url  text    DEFAULT NULL,
  p_attachment_type text    DEFAULT NULL,
  p_attachment_name text    DEFAULT NULL,
  p_operator_id     uuid    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_actor_role text;
  v_old_data   jsonb;
  v_new_data   jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(e.*) INTO v_old_data
  FROM public.expenses e
  WHERE e.id = p_expense_id
    AND e.business_id = p_business_id
    AND e.category <> 'mercaderia';

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  UPDATE public.expenses
  SET
    description     = p_description,
    date            = p_date,
    supplier_id     = p_supplier_id,
    notes           = p_notes,
    amount          = p_amount,
    attachment_url  = p_attachment_url,
    attachment_type = p_attachment_type::public.expense_attachment_type,
    attachment_name = p_attachment_name,
    updated_at      = now()
  WHERE id = p_expense_id
    AND business_id = p_business_id
    AND category <> 'mercaderia'
  RETURNING to_jsonb(expenses.*) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'expense_updated', 'expense', p_expense_id, p_description,
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
