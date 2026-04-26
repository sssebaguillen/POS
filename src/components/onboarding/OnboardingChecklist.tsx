'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  mergeOnboardingState,
  parseOnboardingState,
  type OnboardingState,
} from '@/components/onboarding/onboarding-types'

interface ChecklistState {
  loading: boolean
  role: string | null
  onboarding: OnboardingState
}

type ChecklistKey = 'business_info' | 'category' | 'brand' | 'product' | 'operator' | 'tour'

interface ChecklistItem {
  key: ChecklistKey
  label: string
  wizardStep: number | null
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  { key: 'business_info', label: 'Datos del negocio', wizardStep: 0 },
  { key: 'category', label: 'Primera categoría', wizardStep: 1 },
  { key: 'brand', label: 'Primera marca', wizardStep: 2 },
  { key: 'product', label: 'Primer producto', wizardStep: 3 },
  { key: 'operator', label: 'Primer operador', wizardStep: 4 },
  { key: 'tour', label: 'Tour del sistema', wizardStep: null },
]

export default function OnboardingChecklist() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [expanded, setExpanded] = useState(true)
  const [launchingKey, setLaunchingKey] = useState<ChecklistKey | null>(null)
  const [state, setState] = useState<ChecklistState>({
    loading: true,
    role: null,
    onboarding: parseOnboardingState(null),
  })

  const completionInFlightRef = useRef(false)

  const load = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.error('Failed to resolve authenticated user for onboarding checklist', authError.message)
      setState({ loading: false, role: null, onboarding: parseOnboardingState(null) })
      return
    }

    if (!auth.user) {
      setState({ loading: false, role: null, onboarding: parseOnboardingState(null) })
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, onboarding_state')
      .eq('id', auth.user.id)
      .single()

    if (profileError) {
      console.error('Failed to load onboarding checklist profile', profileError.message)
    }

    setState({
      loading: false,
      role: typeof profile?.role === 'string' ? profile.role : null,
      onboarding: parseOnboardingState(profile?.onboarding_state),
    })
  }, [supabase])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    function handleChange() {
      void load()
    }

    window.addEventListener('onboarding-state-changed', handleChange)
    return () => window.removeEventListener('onboarding-state-changed', handleChange)
  }, [load])

  const onboarding = state.onboarding
  const done = useMemo(() => new Set(onboarding.steps_done), [onboarding.steps_done])
  const completedWizardSteps = CHECKLIST_ITEMS.filter(
    item => item.key !== 'tour' && done.has(item.key)
  ).length
  const completedCount = completedWizardSteps + (onboarding.tour_done ? 1 : 0)
  const progressPercent = Math.min((completedCount / CHECKLIST_ITEMS.length) * 100, 100)

  const show = !state.loading && state.role === 'owner' && !onboarding.completed

  const allDone =
    done.has('business_info') &&
    done.has('category') &&
    done.has('brand') &&
    done.has('product') &&
    done.has('operator') &&
    onboarding.tour_done

  useEffect(() => {
    if (!show || !allDone || onboarding.completed || completionInFlightRef.current) {
      return
    }

    completionInFlightRef.current = true

    void (async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) {
        completionInFlightRef.current = false
        return
      }

      const next = mergeOnboardingState(onboarding, { completed: true })
      const { error } = await supabase
        .from('profiles')
        .update({ onboarding_state: next })
        .eq('id', auth.user.id)

      completionInFlightRef.current = false

      if (error) {
        console.error('Failed to mark onboarding as completed from checklist', error.message)
        return
      }

      setState(prev => ({ ...prev, onboarding: next }))
      window.dispatchEvent(new Event('onboarding-state-changed'))
      router.refresh()
    })()
  }, [allDone, onboarding, router, show, supabase])

  async function applyLauncherPatch(key: ChecklistKey, patch: Partial<OnboardingState>) {
    setLaunchingKey(key)

    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.error('Failed to resolve authenticated user for onboarding launcher', authError.message)
      setLaunchingKey(null)
      return
    }

    if (!auth.user) {
      setLaunchingKey(null)
      return
    }

    const next = mergeOnboardingState(onboarding, patch)

    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_state: next })
      .eq('id', auth.user.id)

    setLaunchingKey(null)

    if (error) {
      console.error('Failed to update onboarding state from checklist', error.message)
      return
    }

    setState(prev => ({ ...prev, onboarding: next }))
    window.dispatchEvent(new Event('onboarding-state-changed'))
    router.push('/dashboard')
    router.refresh()
  }

  if (!show) {
    return null
  }

  return (
    <div className="rounded-xl border border-edge bg-surface-alt/40 mb-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-hover-bg/60 transition-colors"
      >
        <p className="text-[10px] font-semibold text-subtle uppercase tracking-widest">Primeros pasos</p>
        <ChevronDown
          size={14}
          className={`text-hint transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-subtle">Progreso</span>
              <span className="text-[11px] text-subtle">{completedCount} / {CHECKLIST_ITEMS.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface border border-edge overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <ul className="space-y-1.5">
            {CHECKLIST_ITEMS.map(item => {
              const checked = item.key === 'tour' ? onboarding.tour_done : done.has(item.key)
              const isLaunching = launchingKey === item.key
              const isPending = !checked

              return (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={!isPending || isLaunching}
                    onClick={() => {
                      if (!isPending) return

                      if (item.key === 'tour') {
                        void applyLauncherPatch(item.key, {
                          completed: false,
                          tour_done: false,
                          wizard_step: 5,
                          wizard_suppressed: false,
                        })
                        return
                      }

                      void applyLauncherPatch(item.key, {
                        completed: false,
                        wizard_step: item.wizardStep ?? onboarding.wizard_step,
                        wizard_suppressed: false,
                      })
                    }}
                    className={`w-full flex items-center gap-2 text-xs rounded-lg px-1.5 py-1 transition-colors ${
                      isPending
                        ? 'text-body hover:bg-hover-bg cursor-pointer'
                        : 'text-subtle cursor-default'
                    }`}
                  >
                    <span
                      className={`h-4 w-4 rounded border shrink-0 flex items-center justify-center ${
                        checked ? 'bg-primary border-primary' : 'border-edge bg-surface'
                      }`}
                    >
                      {checked && (
                        <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-none stroke-white stroke-[2]">
                          <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className={checked ? 'line-through' : ''}>
                      {isLaunching ? 'Abriendo…' : item.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
