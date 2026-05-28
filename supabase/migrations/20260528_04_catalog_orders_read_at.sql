-- Online-orders badge: persist the "read" state server-side per business.
--
-- Before this, the sidebar unread badge tracked "seen" in localStorage
-- (key orders-online-seen-at). That is per-browser-per-device, so it never
-- synced across devices and a fresh browser/incognito recounted every
-- 'recibido' order. We move the state into businesses.catalog_orders_read_at
-- so any device/operator opening /orders clears the badge for the whole
-- business (single shared order queue).

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS catalog_orders_read_at timestamptz;

-- mark_catalog_orders_read — called when someone opens /orders.
CREATE OR REPLACE FUNCTION public.mark_catalog_orders_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE businesses
     SET catalog_orders_read_at = now()
   WHERE id = v_business_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_catalog_orders_read() TO authenticated;

-- get_catalog_orders_unread_count — count 'recibido' orders newer than the
-- stored read marker. Drops the p_since param (seen state now lives in the DB).
DROP FUNCTION IF EXISTS public.get_catalog_orders_unread_count(timestamptz);

CREATE OR REPLACE FUNCTION public.get_catalog_orders_unread_count()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id uuid;
  v_read_at     timestamptz;
  v_count       int;
BEGIN
  v_business_id := get_business_id();
  IF v_business_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT catalog_orders_read_at INTO v_read_at
    FROM businesses
   WHERE id = v_business_id;

  SELECT COUNT(*) INTO v_count
    FROM catalog_orders
   WHERE business_id = v_business_id
     AND status = 'recibido'
     AND created_at > COALESCE(v_read_at, '-infinity'::timestamptz);

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_catalog_orders_unread_count() TO authenticated;
