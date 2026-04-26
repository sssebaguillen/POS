export interface OnboardingState {
  completed: boolean
  wizard_step: number
  steps_done: string[]
  tour_done: boolean
  /** When true, the setup wizard stays closed until the user resumes from the checklist. */
  wizard_suppressed?: boolean
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  wizard_step: 0,
  steps_done: [],
  tour_done: false,
  wizard_suppressed: false,
}

export function parseOnboardingState(value: unknown): OnboardingState {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_ONBOARDING_STATE }
  }

  const raw = value as Record<string, unknown>
  const steps = raw.steps_done
  const stepsDone = Array.isArray(steps) ? steps.filter((s): s is string => typeof s === 'string') : []

  return {
    completed: raw.completed === true,
    wizard_step: typeof raw.wizard_step === 'number' && Number.isFinite(raw.wizard_step) ? raw.wizard_step : 0,
    steps_done: stepsDone,
    tour_done: raw.tour_done === true,
    wizard_suppressed: raw.wizard_suppressed === true,
  }
}

export function mergeOnboardingState(
  current: OnboardingState | null | undefined,
  patch: Partial<OnboardingState>
): OnboardingState {
  const base = current ?? { ...DEFAULT_ONBOARDING_STATE }
  return {
    ...base,
    ...patch,
    steps_done: patch.steps_done ?? base.steps_done,
  }
}
