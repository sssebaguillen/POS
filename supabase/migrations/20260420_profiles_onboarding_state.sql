-- Onboarding progress for the authenticated profile (owner flow).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_state jsonb;

-- Existing users: skip onboarding.
UPDATE public.profiles
SET onboarding_state = jsonb_build_object(
  'completed', true,
  'wizard_step', 4,
  'steps_done', '[]'::jsonb,
  'tour_done', true,
  'wizard_suppressed', false
)
WHERE onboarding_state IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN onboarding_state SET DEFAULT jsonb_build_object(
    'completed', false,
    'wizard_step', 0,
    'steps_done', '[]'::jsonb,
    'tour_done', false,
    'wizard_suppressed', false
  );

ALTER TABLE public.profiles
  ALTER COLUMN onboarding_state SET NOT NULL;
