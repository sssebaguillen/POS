-- P11.3 foundation:
-- - businesses.timezone (IANA tz name) for time-of-day analytics
-- - default 'America/Argentina/Buenos_Aires' (beta is AR-first)
-- - backfill existing rows from country_code where present

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL
  DEFAULT 'America/Argentina/Buenos_Aires';

-- Backfill from country_code for rows that may have been created before the default kicked in.
UPDATE public.businesses
SET timezone = CASE country_code
  WHEN 'AR' THEN 'America/Argentina/Buenos_Aires'
  WHEN 'UY' THEN 'America/Argentina/Buenos_Aires'
  WHEN 'CO' THEN 'America/Bogota'
  WHEN 'MX' THEN 'America/Mexico_City'
  ELSE 'America/Argentina/Buenos_Aires'
END
WHERE timezone IS NULL
   OR timezone = '';

-- Sanity check: every business resolves a non-empty timezone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.businesses
    WHERE timezone IS NULL OR timezone = ''
  ) THEN
    RAISE EXCEPTION 'business timezone backfill missed rows';
  END IF;
END $$;
