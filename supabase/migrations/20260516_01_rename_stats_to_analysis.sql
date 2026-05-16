-- Rename permissions JSONB key 'stats' → 'analysis' on operators table.
-- Covers: column default, existing rows (if any), and the create_operator RPC.

-- 1. Migrate existing rows: rename 'stats' key to 'analysis' where present.
UPDATE operators
SET permissions = (permissions - 'stats') || jsonb_build_object('analysis', permissions->'stats')
WHERE permissions ? 'stats';

-- 2. Update column default.
ALTER TABLE operators
ALTER COLUMN permissions
SET DEFAULT '{"sales": true, "analysis": false, "stock": false, "expenses": false, "settings": false, "price_lists": false, "stock_write": false, "operators_write": false, "price_lists_write": false}'::jsonb;

-- 3. Patch create_operator to use 'analysis' in its hardcoded role defaults.
CREATE OR REPLACE FUNCTION public.create_operator(
  p_business_id uuid,
  p_name text,
  p_role text,
  p_pin text,
  p_permissions jsonb DEFAULT NULL::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_default_permissions jsonb;
  v_final_permissions jsonb;
  v_operator_id uuid;
BEGIN
  v_default_permissions := CASE p_role
    WHEN 'manager' THEN
      '{"sales": true, "stock": true, "stock_write": true, "analysis": true, "price_lists": true, "price_lists_write": true, "settings": false, "operators_write": false, "expenses": false}'::jsonb
    WHEN 'cashier' THEN
      '{"sales": true, "stock": true, "stock_write": false, "analysis": false, "price_lists": false, "price_lists_write": false, "settings": false, "operators_write": false, "expenses": false}'::jsonb
    ELSE
      '{"sales": true, "stock": false, "stock_write": false, "analysis": false, "price_lists": false, "price_lists_write": false, "settings": false, "operators_write": false, "expenses": false}'::jsonb
  END;

  v_final_permissions := COALESCE(p_permissions, v_default_permissions);

  IF (v_final_permissions->>'expenses') IS NULL THEN
    v_final_permissions := v_final_permissions || '{"expenses": false}'::jsonb;
  END IF;
  IF (v_final_permissions->>'operators_write') IS NULL THEN
    v_final_permissions := v_final_permissions || '{"operators_write": false}'::jsonb;
  END IF;

  INSERT INTO operators (business_id, name, role, pin, permissions)
  VALUES (
    p_business_id,
    p_name,
    p_role,
    extensions.crypt(p_pin, extensions.gen_salt('bf')),
    v_final_permissions
  )
  RETURNING id INTO v_operator_id;

  RETURN json_build_object('success', true, 'operator_id', v_operator_id);
EXCEPTION
  WHEN others THEN
    RETURN json_build_object('success', false, 'error', sqlerrm);
END;
$function$;
