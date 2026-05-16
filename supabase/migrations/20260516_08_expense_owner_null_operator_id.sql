-- Fix: create_expense and create_mercaderia_expense were inserting the
-- caller's profile_id into expenses.operator_id (and inventory_movements
-- .created_by_operator) for the owner path. Those columns FK to operators(id),
-- and owners have no row in operators, so the INSERT failed with an FK
-- violation. Resolve the stored operator_id through the same owner-aware
-- CASE used for audit logging: NULL when the actor is the owner, the
-- operator id otherwise.

CREATE OR REPLACE FUNCTION public.create_expense(
  p_business_id     uuid,
  p_category        text,
  p_amount          numeric,
  p_description     text,
  p_date            date  DEFAULT CURRENT_DATE,
  p_supplier_id     uuid  DEFAULT NULL,
  p_operator_id     uuid  DEFAULT NULL,
  p_attachment_url  text  DEFAULT NULL,
  p_attachment_type text  DEFAULT NULL,
  p_attachment_name text  DEFAULT NULL,
  p_notes           text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_expense_id     uuid;
  v_actor_role     text;
  v_stored_op_id   uuid;
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

  -- expenses.operator_id FKs to operators(id). Owners aren't in that table,
  -- so store NULL for the owner path.
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  INSERT INTO public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id,
    attachment_url, attachment_type, attachment_name,
    notes
  ) VALUES (
    p_business_id, p_category::public.expense_category, p_amount, p_description, p_date,
    p_supplier_id, v_stored_op_id,
    p_attachment_url, p_attachment_type::public.expense_attachment_type, p_attachment_name,
    p_notes
  )
  RETURNING id INTO v_expense_id;

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'expense_created', 'expense', v_expense_id, p_description,
    NULL,
    jsonb_build_object(
      'category',    p_category,
      'amount',      p_amount,
      'description', p_description,
      'date',        p_date,
      'supplier_id', p_supplier_id
    )
  );

  RETURN jsonb_build_object('success', true, 'id', v_expense_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_mercaderia_expense(
  p_business_id  uuid,
  p_description  text,
  p_date         date    DEFAULT CURRENT_DATE,
  p_supplier_id  uuid    DEFAULT NULL,
  p_operator_id  uuid    DEFAULT NULL,
  p_notes        text    DEFAULT NULL,
  p_items        jsonb   DEFAULT '[]'::jsonb,
  p_update_stock boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_expense_id    uuid;
  v_total         numeric := 0;
  v_item          jsonb;
  v_product_id    uuid;
  v_qty           integer;
  v_cost          numeric;
  v_name          text;
  v_update        boolean;
  v_actor_role    text;
  v_stored_op_id  uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_items');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  -- expenses.operator_id and inventory_movements.created_by_operator both FK
  -- to operators(id). Store NULL for the owner path.
  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  SELECT sum((item->>'unit_cost')::numeric * (item->>'quantity')::integer)
  INTO v_total
  FROM jsonb_array_elements(p_items) AS item;

  INSERT INTO public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id, notes
  ) VALUES (
    p_business_id, 'mercaderia', v_total, p_description, p_date,
    p_supplier_id, v_stored_op_id, p_notes
  )
  RETURNING id INTO v_expense_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'quantity')::integer;
    v_cost       := (v_item->>'unit_cost')::numeric;
    v_name       := v_item->>'product_name';
    v_update     := COALESCE((v_item->>'update_cost')::boolean, false);

    INSERT INTO public.expense_items (
      business_id, expense_id, product_id, product_name,
      quantity, unit_cost, update_cost
    ) VALUES (
      p_business_id, v_expense_id, v_product_id, v_name,
      v_qty, v_cost, v_update
    );

    IF p_update_stock AND v_product_id IS NOT NULL THEN
      UPDATE public.products
      SET stock = stock + v_qty
      WHERE id = v_product_id AND business_id = p_business_id;

      IF v_update THEN
        UPDATE public.products
        SET cost = v_cost
        WHERE id = v_product_id AND business_id = p_business_id;
      END IF;

      INSERT INTO public.inventory_movements (
        business_id, product_id, type, quantity,
        reason, reference_id, created_by_operator
      ) VALUES (
        p_business_id, v_product_id, 'purchase', v_qty,
        'Compra de mercadería — gasto #' || v_expense_id::text,
        v_expense_id,
        v_stored_op_id
      );
    END IF;
  END LOOP;

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'expense_created', 'expense', v_expense_id, p_description,
    NULL,
    jsonb_build_object(
      'category',    'mercaderia',
      'amount',      v_total,
      'description', p_description,
      'date',        p_date,
      'supplier_id', p_supplier_id,
      'item_count',  jsonb_array_length(p_items)
    )
  );

  RETURN jsonb_build_object('success', true, 'id', v_expense_id, 'total', v_total);
END;
$$;
