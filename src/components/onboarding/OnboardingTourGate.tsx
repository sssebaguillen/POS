'use client'

import { useState } from 'react'
import { Compass, X } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import OnboardingTour from '@/components/onboarding/OnboardingTour'
import { mergeOnboardingState, parseOnboardingState } from '@/components/onboarding/onboarding-types'

interface Props {
  profileId: string
  onboardingState: unknown
}

/**
 * Tour opt-in: en vez de auto-lanzar el recorrido de 7 pasos al terminar el
 * wizard, ofrecemos un prompt descartable. El dueño puede ir a vender ya.
 * "Ahora no" marca tour_done (no completa el onboarding: el checklist sigue).
 */
export default function OnboardingTourGate({ profileId, onboardingState }: Props) {
  const [mode, setMode] = useState<'prompt' | 'tour' | 'hidden'>('prompt')
  const [dismissing, setDismissing] = useState(false)

  async function declineTour() {
    setDismissing(true)
    const supabase = createClient()
    const { data: fresh } = await supabase
      .from('profiles')
      .select('onboarding_state')
      .eq('id', profileId)
      .maybeSingle()
    const next = mergeOnboardingState(parseOnboardingState(fresh?.onboarding_state ?? onboardingState), {
      tour_done: true,
    })
    await supabase.from('profiles').update({ onboarding_state: next }).eq('id', profileId)
    window.dispatchEvent(new Event('onboarding-state-changed'))
    setMode('hidden')
  }

  if (mode === 'tour') {
    return <OnboardingTour open profileId={profileId} onboardingState={onboardingState} />
  }

  if (mode === 'hidden') return null

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border border-edge bg-surface shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Compass size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">¿Querés un recorrido rápido?</p>
          <p className="mt-0.5 text-xs text-subtle">Te muestro lo esencial en menos de un minuto. Podés hacerlo cuando quieras.</p>
          <div className="mt-3 flex items-center gap-2">
            <Button className="h-8 px-3 text-xs" onClick={() => setMode('tour')}>
              Ver recorrido
            </Button>
            <Button
              variant="ghost"
              className="h-8 px-3 text-xs text-subtle"
              onClick={() => void declineTour()}
              disabled={dismissing}
            >
              Ahora no
            </Button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={() => void declineTour()}
          className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
