-- P7h Phase 2: instrument expense RPCs with log_audit_event.

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
  v_expense_id  uuid;
  v_actor_role  text;
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

  INSERT INTO public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id,
    attachment_url, attachment_type, attachment_name,
    notes
  ) VALUES (
    p_business_id, p_category::public.expense_category, p_amount, p_description, p_date,
    p_supplier_id, p_operator_id,
    p_attachment_url, p_attachment_type::public.expense_attachment_type, p_attachment_name,
    p_notes
  )
  RETURNING id INTO v_expense_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
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

DROP FUNCTION IF EXISTS public.update_expense(uuid, uuid, text, date, uuid, text, numeric, text, text, text);

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
    attachment_type = p_attachment_type,
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

REVOKE EXECUTE ON FUNCTION public.update_expense(uuid, uuid, text, date, uuid, text, numeric, text, text, text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_expense(uuid, uuid, text, date, uuid, text, numeric, text, text, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.delete_expense(uuid, uuid);

CREATE OR REPLACE FUNCTION public.delete_expense(
  p_business_id uuid,
  p_expense_id  uuid,
  p_operator_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_actor_role   text;
  v_old_data     jsonb;
  v_old_label    text;
  v_category     text;
  v_item         record;
  v_current_cost numeric;
  v_warnings     jsonb := '[]'::jsonb;
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

  SELECT to_jsonb(e.*), e.description, e.category
    INTO v_old_data, v_old_label, v_category
  FROM public.expenses e
  WHERE e.id = p_expense_id AND e.business_id = p_business_id;

  IF v_old_data IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  -- Capture mercadería line-items into old_data before any mutations, so the
  -- audit row carries the full pre-state.
  IF v_category = 'mercaderia' THEN
    v_old_data := v_old_data || jsonb_build_object(
      'items',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id',   ei.product_id,
          'product_name', ei.product_name,
          'quantity',     ei.quantity,
          'unit_cost',    ei.unit_cost,
          'update_cost',  ei.update_cost
        ) ORDER BY ei.id)
        FROM public.expense_items ei WHERE ei.expense_id = p_expense_id
      ), '[]'::jsonb)
    );
  END IF;

  IF v_category = 'mercaderia' THEN
    FOR v_item IN
      SELECT ei.product_id, ei.quantity, ei.unit_cost, ei.update_cost
      FROM public.expense_items ei
      WHERE ei.expense_id = p_expense_id
        AND ei.product_id IS NOT NULL
    LOOP
      UPDATE public.products
      SET stock = stock - v_item.quantity
      WHERE id = v_item.product_id AND business_id = p_business_id;

      IF v_item.update_cost THEN
        SELECT cost INTO v_current_cost
        FROM public.products
        WHERE id = v_item.product_id AND business_id = p_business_id;

        IF v_current_cost IS DISTINCT FROM v_item.unit_cost THEN
          v_warnings := v_warnings || jsonb_build_array(
            jsonb_build_object('product_id', v_item.product_id, 'reason', 'cost_changed')
          );
        ELSE
          UPDATE public.products
          SET cost = NULL
          WHERE id = v_item.product_id AND business_id = p_business_id;
        END IF;
      END IF;
    END LOOP;

    DELETE FROM public.inventory_movements
    WHERE reference_id = p_expense_id AND business_id = p_business_id;

    DELETE FROM public.expense_items
    WHERE expense_id = p_expense_id;
  END IF;

  DELETE FROM public.expenses
  WHERE id = p_expense_id AND business_id = p_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'expense_deleted', 'expense', p_expense_id, v_old_label,
    v_old_data, NULL
  );

  IF jsonb_array_length(v_warnings) > 0 THEN
    RETURN jsonb_build_object('success', true, 'warnings', v_warnings);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_expense(uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.delete_expense(uuid, uuid, uuid) TO authenticated;

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
  v_expense_id  uuid;
  v_total       numeric := 0;
  v_item        jsonb;
  v_product_id  uuid;
  v_qty         integer;
  v_cost        numeric;
  v_name        text;
  v_update      boolean;
  v_actor_role  text;
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

  SELECT sum((item->>'unit_cost')::numeric * (item->>'quantity')::integer)
  INTO v_total
  FROM jsonb_array_elements(p_items) AS item;

  INSERT INTO public.expenses (
    business_id, category, amount, description, date,
    supplier_id, operator_id, notes
  ) VALUES (
    p_business_id, 'mercaderia', v_total, p_description, p_date,
    p_supplier_id, p_operator_id, p_notes
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
        p_operator_id
      );
    END IF;
  END LOOP;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
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

DROP FUNCTION IF EXISTS public.update_mercaderia_expense(uuid, uuid, text, date, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.update_mercaderia_expense(
  p_business_id uuid,
  p_expense_id  uuid,
  p_description text,
  p_date        date,
  p_supplier_id uuid  DEFAULT NULL,
  p_notes       text  DEFAULT NULL,
  p_items       jsonb DEFAULT '[]'::jsonb,
  p_operator_id uuid  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_existing       record;
  v_new_item       jsonb;
  v_new_product_id uuid;
  v_new_qty        integer;
  v_new_cost       numeric;
  v_new_update     boolean;
  v_new_name       text;
  v_qty_delta      integer;
  v_current_cost   numeric;
  v_old_qty        integer;
  v_old_cost       numeric;
  v_total          numeric := 0;
  v_warnings       jsonb   := '[]'::jsonb;
  v_new_ids        uuid[];
  v_actor_role     text;
  v_old_data       jsonb;
  v_new_data       jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND business_id = p_business_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.expenses
    WHERE id = p_expense_id AND business_id = p_business_id AND category = 'mercaderia'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF p_operator_id IS NOT NULL THEN
    SELECT role INTO v_actor_role
    FROM operators
    WHERE id = p_operator_id AND business_id = p_business_id AND is_active = true;
  END IF;
  IF v_actor_role IS NULL THEN
    v_actor_role := 'owner';
  END IF;

  SELECT to_jsonb(e.*) || jsonb_build_object(
    'items',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',   ei.product_id,
        'product_name', ei.product_name,
        'quantity',     ei.quantity,
        'unit_cost',    ei.unit_cost,
        'update_cost',  ei.update_cost
      ) ORDER BY ei.id)
      FROM public.expense_items ei WHERE ei.expense_id = p_expense_id
    ), '[]'::jsonb)
  ) INTO v_old_data
  FROM public.expenses e
  WHERE e.id = p_expense_id AND e.business_id = p_business_id;

  SELECT array_agg((item->>'product_id')::uuid)
  INTO v_new_ids
  FROM jsonb_array_elements(p_items) AS item
  WHERE (item->>'product_id') IS NOT NULL;

  FOR v_existing IN
    SELECT ei.product_id, ei.quantity
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
      AND ei.product_id IS NOT NULL
      AND (v_new_ids IS NULL OR ei.product_id != ALL(v_new_ids))
  LOOP
    UPDATE public.products
    SET stock = stock - v_existing.quantity
    WHERE id = v_existing.product_id AND business_id = p_business_id;

    DELETE FROM public.inventory_movements
    WHERE reference_id = p_expense_id
      AND product_id = v_existing.product_id
      AND business_id = p_business_id;
  END LOOP;

  DELETE FROM public.expense_items
  WHERE expense_id = p_expense_id
    AND (product_id IS NULL OR v_new_ids IS NULL OR product_id != ALL(v_new_ids));

  FOR v_new_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_new_product_id := (v_new_item->>'product_id')::uuid;
    v_new_qty        := (v_new_item->>'quantity')::integer;
    v_new_cost       := (v_new_item->>'unit_cost')::numeric;
    v_new_update     := COALESCE((v_new_item->>'update_cost')::boolean, false);
    v_new_name       := v_new_item->>'product_name';

    IF v_new_product_id IS NULL THEN
      INSERT INTO public.expense_items (
        business_id, expense_id, product_id, product_name, quantity, unit_cost, update_cost
      ) VALUES (
        p_business_id, p_expense_id, NULL, v_new_name, v_new_qty, v_new_cost, v_new_update
      );
      CONTINUE;
    END IF;

    SELECT quantity, unit_cost
    INTO v_old_qty, v_old_cost
    FROM public.expense_items
    WHERE expense_id = p_expense_id AND product_id = v_new_product_id;

    IF FOUND THEN
      v_qty_delta := v_new_qty - v_old_qty;

      IF v_qty_delta <> 0 THEN
        UPDATE public.products
        SET stock = stock + v_qty_delta
        WHERE id = v_new_product_id AND business_id = p_business_id;

        UPDATE public.inventory_movements
        SET quantity = v_new_qty
        WHERE reference_id = p_expense_id
          AND product_id = v_new_product_id
          AND business_id = p_business_id;
      END IF;

      IF v_new_update THEN
        SELECT cost INTO v_current_cost
        FROM public.products
        WHERE id = v_new_product_id AND business_id = p_business_id;

        IF v_current_cost IS DISTINCT FROM v_old_cost THEN
          v_warnings := v_warnings || jsonb_build_array(
            jsonb_build_object('product_id', v_new_product_id, 'reason', 'cost_changed')
          );
        ELSE
          UPDATE public.products
          SET cost = v_new_cost
          WHERE id = v_new_product_id AND business_id = p_business_id;
        END IF;
      END IF;

      UPDATE public.expense_items
      SET quantity     = v_new_qty,
          unit_cost    = v_new_cost,
          update_cost  = v_new_update,
          product_name = v_new_name
      WHERE expense_id = p_expense_id AND product_id = v_new_product_id;

    ELSE
      UPDATE public.products
      SET stock = stock + v_new_qty
      WHERE id = v_new_product_id AND business_id = p_business_id;

      IF v_new_update THEN
        UPDATE public.products
        SET cost = v_new_cost
        WHERE id = v_new_product_id AND business_id = p_business_id;
      END IF;

      INSERT INTO public.inventory_movements (
        business_id, product_id, type, quantity,
        reason, reference_id
      ) VALUES (
        p_business_id, v_new_product_id, 'purchase', v_new_qty,
        'Compra de mercadería — gasto #' || p_expense_id::text,
        p_expense_id
      );

      INSERT INTO public.expense_items (
        business_id, expense_id, product_id, product_name, quantity, unit_cost, update_cost
      ) VALUES (
        p_business_id, p_expense_id, v_new_product_id, v_new_name, v_new_qty, v_new_cost, v_new_update
      );
    END IF;
  END LOOP;

  SELECT COALESCE(sum(quantity * unit_cost), 0)
  INTO v_total
  FROM public.expense_items
  WHERE expense_id = p_expense_id;

  UPDATE public.expenses
  SET
    description = p_description,
    date        = p_date,
    supplier_id = p_supplier_id,
    notes       = p_notes,
    amount      = v_total,
    updated_at  = now()
  WHERE id = p_expense_id AND business_id = p_business_id;

  SELECT to_jsonb(e.*) || jsonb_build_object(
    'items',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',   ei.product_id,
        'product_name', ei.product_name,
        'quantity',     ei.quantity,
        'unit_cost',    ei.unit_cost,
        'update_cost',  ei.update_cost
      ) ORDER BY ei.id)
      FROM public.expense_items ei WHERE ei.expense_id = p_expense_id
    ), '[]'::jsonb)
  ) INTO v_new_data
  FROM public.expenses e
  WHERE e.id = p_expense_id AND e.business_id = p_business_id;

  PERFORM log_audit_event(
    p_business_id,
    CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END,
    v_actor_role,
    'expense_updated', 'expense', p_expense_id, p_description,
    v_old_data, v_new_data
  );

  RETURN jsonb_build_object('success', true, 'warnings', v_warnings);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_mercaderia_expense(uuid, uuid, text, date, uuid, text, jsonb, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_mercaderia_expense(uuid, uuid, text, date, uuid, text, jsonb, uuid) TO authenticated;
