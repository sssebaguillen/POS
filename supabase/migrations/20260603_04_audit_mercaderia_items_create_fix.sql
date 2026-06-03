-- Reconciliación de ledger: esta migración existe en el remoto como
-- `audit_mercaderia_items_create_fix` (version 20260603151442, aplicada vía MCP)
-- pero no tenía archivo local — el fix se había editado in-place en
-- `20260603_02_audit_mercaderia_items.sql`. Se agrega el archivo para que el
-- directorio de migraciones local quede 1:1 con el historial remoto.
--
-- Contenido: redefinición idempotente de create_mercaderia_expense con el array
-- 'items' completo en el audit (mismo cuerpo que el `_02` final). Replayearla es
-- no-op porque es CREATE OR REPLACE de la versión ya vigente. schema.sql ya refleja
-- este estado.

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
  v_expense_id   uuid;
  v_total        numeric := 0;
  v_item         jsonb;
  v_product_id   uuid;
  v_variant_id   uuid;
  v_qty          integer;
  v_cost         numeric;
  v_name         text;
  v_update       boolean;
  v_actor_role   text;
  v_stored_op_id uuid;
  v_new_data     jsonb;
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
    v_variant_id := (v_item->>'variant_id')::uuid;
    v_qty        := (v_item->>'quantity')::integer;
    v_cost       := (v_item->>'unit_cost')::numeric;
    v_name       := v_item->>'product_name';
    v_update     := COALESCE((v_item->>'update_cost')::boolean, false);

    INSERT INTO public.expense_items (
      business_id, expense_id, product_id, variant_id, product_name,
      quantity, unit_cost, update_cost
    ) VALUES (
      p_business_id, v_expense_id, v_product_id, v_variant_id, v_name,
      v_qty, v_cost, v_update
    );

    IF p_update_stock AND v_product_id IS NOT NULL THEN
      IF v_variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock = stock + v_qty
        WHERE id = v_variant_id AND business_id = p_business_id;

        IF v_update THEN
          UPDATE public.product_variants
          SET cost = v_cost
          WHERE id = v_variant_id AND business_id = p_business_id;
        END IF;
      ELSE
        UPDATE public.products
        SET stock = stock + v_qty
        WHERE id = v_product_id AND business_id = p_business_id;

        IF v_update THEN
          UPDATE public.products
          SET cost = v_cost
          WHERE id = v_product_id AND business_id = p_business_id;
        END IF;
      END IF;

      INSERT INTO public.inventory_movements (
        business_id, product_id, variant_id, type, quantity,
        reason, reference_id, created_by_operator
      ) VALUES (
        p_business_id, v_product_id, v_variant_id, 'purchase', v_qty,
        'Compra de mercadería — gasto #' || v_expense_id::text,
        v_expense_id,
        v_stored_op_id
      );
    END IF;
  END LOOP;

  SELECT jsonb_build_object(
    'category',    'mercaderia',
    'amount',      v_total,
    'description', p_description,
    'date',        p_date,
    'supplier_id', p_supplier_id,
    'item_count',  jsonb_array_length(p_items),
    'items',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',   ei.product_id,
        'product_name', ei.product_name,
        'variant_id',   ei.variant_id,
        'variant_label', CASE WHEN ei.variant_id IS NOT NULL THEN (
          SELECT string_agg(pov.value, ' / ' ORDER BY po.position)
          FROM public.product_variant_option_values pvov
          JOIN public.product_option_values pov ON pov.id = pvov.option_value_id
          JOIN public.product_options po        ON po.id  = pov.option_id
          WHERE pvov.variant_id = ei.variant_id
        ) END,
        'quantity',     ei.quantity,
        'unit_cost',    ei.unit_cost,
        'update_cost',  ei.update_cost
      ) ORDER BY ei.id)
      FROM public.expense_items ei WHERE ei.expense_id = v_expense_id
    ), '[]'::jsonb)
  ) INTO v_new_data;

  PERFORM log_audit_event(
    p_business_id,
    v_stored_op_id,
    v_actor_role,
    'expense_created', 'expense', v_expense_id, p_description,
    NULL,
    v_new_data
  );

  RETURN jsonb_build_object('success', true, 'id', v_expense_id, 'total', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_mercaderia_expense(uuid, text, date, uuid, uuid, text, jsonb, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_mercaderia_expense(uuid, text, date, uuid, uuid, text, jsonb, boolean) TO authenticated;
