-- P10 minimal foundation:
-- - commercial/billing source of truth via subscriptions
-- - fiscal metadata on businesses
-- - feature-flag helper for plan-aware limits

-- 1. businesses: fiscal metadata -------------------------------------------

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS tax_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'businesses_country_code_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_country_code_check
      CHECK (country_code IS NULL OR country_code IN ('AR', 'MX', 'CO', 'UY'));
  END IF;
END;
$$;

-- 2. subscriptions ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan               text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'cancelled', 'trialing')),
  provider           text NULL CHECK (provider IS NULL OR provider IN ('stripe', 'mercadopago')),
  external_id        text NULL,
  current_period_end timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_business_id_key UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON public.subscriptions (status);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_read_own_subscription ON public.subscriptions;
CREATE POLICY owner_read_own_subscription
  ON public.subscriptions
  FOR SELECT
  TO authenticated
  USING (business_id = public.get_business_id());

-- Sin policies de INSERT/UPDATE/DELETE — billing se actualiza por backend/webhooks.

INSERT INTO public.subscriptions (business_id, plan, status)
SELECT b.id, b.plan, 'active'
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.subscriptions s
  WHERE s.business_id = b.id
);

-- 3. bootstrap_new_user: create the free subscription on day 1 ------------

CREATE OR REPLACE FUNCTION public.bootstrap_new_user(
  p_user_id       uuid,
  p_business_name text,
  p_user_name     text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_business_id uuid;
  v_slug        text;
BEGIN
  v_slug := lower(regexp_replace(p_business_name, '\s+', '-', 'g'));
  v_slug := regexp_replace(v_slug, '[^a-z0-9-]', '', 'g');
  v_slug := v_slug || '-' || extract(epoch from now())::bigint;

  INSERT INTO public.businesses (name, slug)
  VALUES (p_business_name, v_slug)
  RETURNING id INTO v_business_id;

  INSERT INTO public.profiles (id, business_id, role, name)
  VALUES (p_user_id, v_business_id, 'owner', p_user_name);

  INSERT INTO public.subscriptions (business_id, plan, status)
  VALUES (v_business_id, 'free', 'active');

  RETURN json_build_object(
    'business_id', v_business_id,
    'success', true
  );
EXCEPTION
  WHEN others THEN
    RETURN json_build_object(
      'success', false,
      'error', sqlerrm
    );
END;
$$;

-- 4. plan-aware limits helper ----------------------------------------------

CREATE OR REPLACE FUNCTION public.get_plan_limits(
  p_business_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_caller_business_id uuid;
  v_plan               text;
  v_status             text;
  v_provider           text;
  v_current_period_end timestamptz;
BEGIN
  v_caller_business_id := public.get_business_id();

  IF v_caller_business_id IS NULL OR p_business_id IS DISTINCT FROM v_caller_business_id THEN
    RAISE EXCEPTION 'Contexto de negocio inválido';
  END IF;

  SELECT
    s.plan,
    s.status,
    s.provider,
    s.current_period_end
  INTO
    v_plan,
    v_status,
    v_provider,
    v_current_period_end
  FROM public.subscriptions s
  WHERE s.business_id = v_caller_business_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suscripción no encontrada para el negocio %', v_caller_business_id;
  END IF;

  RETURN CASE
    WHEN v_plan = 'pro' THEN
      jsonb_build_object(
        'plan', v_plan,
        'status', v_status,
        'provider', v_provider,
        'current_period_end', v_current_period_end,
        'max_sales_per_month', NULL,
        'invoicing', true,
        'accounting', true,
        'analytics_history_days', NULL,
        'ai', true
      )
    WHEN v_plan = 'enterprise' THEN
      jsonb_build_object(
        'plan', v_plan,
        'status', v_status,
        'provider', v_provider,
        'current_period_end', v_current_period_end,
        'max_sales_per_month', NULL,
        'invoicing', true,
        'accounting', true,
        'analytics_history_days', NULL,
        'ai', true
      )
    ELSE
      jsonb_build_object(
        'plan', 'free',
        'status', v_status,
        'provider', v_provider,
        'current_period_end', v_current_period_end,
        'max_sales_per_month', 200,
        'invoicing', false,
        'accounting', false,
        'analytics_history_days', 30,
        'ai', false
      )
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_plan_limits(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_plan_limits(uuid) TO authenticated;
