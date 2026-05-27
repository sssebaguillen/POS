-- get_catalog_orders_unread_count: accept an optional p_since timestamp so the
-- sidebar badge can show "new since I last visited /pedidos" instead of
-- "everything in recibido state". Backwards compatible: passing NULL keeps the
-- old behaviour (count of all recibido).

DROP FUNCTION IF EXISTS public.get_catalog_orders_unread_count();

CREATE OR REPLACE FUNCTION public.get_catalog_orders_unread_count(
  p_since timestamptz DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_business_id uuid; v_count int;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO v_count
    FROM catalog_orders
   WHERE business_id = v_business_id
     AND status = 'recibido'
     AND (p_since IS NULL OR created_at > p_since);

  RETURN COALESCE(v_count, 0);
END;
$$;
