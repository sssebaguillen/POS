-- Snapshot inmutable de categoría/marca en update_product (audit log).
-- Extiende el patrón de create/delete (mig 20260617_01) al path de edición.
--
-- old_data: siempre suma category_name/brand_name del estado PRE-edición.
-- new_data (p_changes parcial): suma category_name/brand_name SOLO si
-- category_id/brand_id cambió (así el diff muestra ambos nombres).
--
-- Retrocompat: el frontend prefiere el snapshot y cae a los lookups para
-- entradas viejas sin el campo.

CREATE OR REPLACE FUNCTION public.update_product(p_operator_id uuid, p_business_id uuid, p_product_id uuid, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_business_id uuid;
  v_stock_write        text;
  v_actor_role         text;
  v_stored_op_id       uuid;
  v_old_data           jsonb;
  v_old_name           text;
  v_new_data           jsonb;
  v_has_changes        boolean := false;
  v_key                text;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', '403: Sesión de operador no encontrada');
  END IF;

  v_caller_business_id := get_business_id();
  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contexto de negocio inválido');
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sin cambios');
  END IF;

  IF p_changes ? 'name' AND (p_changes->>'name' IS NULL OR btrim(p_changes->>'name') = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'El nombre es obligatorio');
  END IF;

  SELECT normalize_permissions(permissions)->>'inventory_write', role
  INTO v_stock_write, v_actor_role
  FROM operators
  WHERE id = p_operator_id AND business_id = v_caller_business_id AND is_active = true;

  IF FOUND THEN
    IF v_stock_write <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Permisos de inventario insuficientes');
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_operator_id AND business_id = v_caller_business_id) THEN
      RETURN jsonb_build_object('success', false, 'error', '403: Sesión inválida');
    END IF;
    v_actor_role := 'owner';
  END IF;

  v_stored_op_id := CASE WHEN v_actor_role = 'owner' THEN NULL ELSE p_operator_id END;

  -- Snapshot pre-edición + nombres de categoría/marca al momento del evento.
  SELECT to_jsonb(p) || jsonb_build_object(
           'category_name', (SELECT c.name FROM categories c WHERE c.id = p.category_id),
           'brand_name',    (SELECT b.name FROM brands b WHERE b.id = p.brand_id)
         ), p.name
  INTO v_old_data, v_old_name
  FROM products p WHERE p.id = p_product_id AND p.business_id = v_caller_business_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Producto no encontrado');
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_changes)
  LOOP
    IF v_old_data->v_key IS DISTINCT FROM p_changes->v_key THEN
      v_has_changes := true;
      EXIT;
    END IF;
  END LOOP;

  UPDATE products SET
    name            = CASE WHEN p_changes ? 'name'            THEN btrim(p_changes->>'name')                   ELSE name END,
    sku             = CASE WHEN p_changes ? 'sku'             THEN NULLIF(p_changes->>'sku', '')               ELSE sku END,
    barcode         = CASE WHEN p_changes ? 'barcode'         THEN NULLIF(p_changes->>'barcode', '')           ELSE barcode END,
    price           = CASE WHEN p_changes ? 'price'           THEN (p_changes->>'price')::numeric              ELSE price END,
    cost            = CASE WHEN p_changes ? 'cost'            THEN (p_changes->>'cost')::numeric               ELSE cost END,
    stock           = CASE WHEN p_changes ? 'stock'           THEN (p_changes->>'stock')::int                  ELSE stock END,
    min_stock       = CASE WHEN p_changes ? 'min_stock'       THEN (p_changes->>'min_stock')::int              ELSE min_stock END,
    category_id     = CASE WHEN p_changes ? 'category_id'     THEN NULLIF(p_changes->>'category_id', '')::uuid ELSE category_id END,
    brand_id        = CASE WHEN p_changes ? 'brand_id'        THEN NULLIF(p_changes->>'brand_id', '')::uuid    ELSE brand_id END,
    image_url       = CASE WHEN p_changes ? 'image_url'       THEN NULLIF(p_changes->>'image_url', '')         ELSE image_url END,
    image_source    = CASE WHEN p_changes ? 'image_source'    THEN NULLIF(p_changes->>'image_source', '')      ELSE image_source END,
    is_active       = CASE WHEN p_changes ? 'is_active'       THEN (p_changes->>'is_active')::boolean          ELSE is_active END,
    show_in_catalog = CASE WHEN p_changes ? 'show_in_catalog' THEN (p_changes->>'show_in_catalog')::boolean    ELSE show_in_catalog END,
    has_variants    = CASE WHEN p_changes ? 'has_variants'    THEN (p_changes->>'has_variants')::boolean       ELSE has_variants END
  WHERE id = p_product_id AND business_id = v_caller_business_id;

  IF v_has_changes THEN
    -- Enriquecer new_data con nombres de categoría/marca si esos campos cambiaron.
    v_new_data := p_changes;
    IF p_changes ? 'category_id' THEN
      v_new_data := v_new_data || jsonb_build_object(
        'category_name', (SELECT c.name FROM categories c
                          WHERE c.id = NULLIF(p_changes->>'category_id', '')::uuid
                            AND c.business_id = v_caller_business_id)
      );
    END IF;
    IF p_changes ? 'brand_id' THEN
      v_new_data := v_new_data || jsonb_build_object(
        'brand_name', (SELECT b.name FROM brands b
                       WHERE b.id = NULLIF(p_changes->>'brand_id', '')::uuid
                         AND b.business_id = v_caller_business_id)
      );
    END IF;
    PERFORM log_audit_event(p_business_id, v_stored_op_id, v_actor_role,
      'product_updated', 'product', p_product_id, v_old_name, v_old_data, v_new_data);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_product(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product(uuid, uuid, uuid, jsonb) TO authenticated, service_role;
