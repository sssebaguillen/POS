'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  type Placement,
} from '@floating-ui/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { mergeOnboardingState, parseOnboardingState } from '@/components/onboarding/onboarding-types'

interface OnboardingTourProps {
  open: boolean
  profileId: string
  onboardingState: unknown
}

interface TourStep {
  target: string
  title: string
  description: string
  placement: Placement
  route: string
  isLast?: boolean
}

interface SpotRect {
  top: number
  left: number
  width: number
  height: number
}

const TARGET_RETRY_MS = 2500
const ROUTE_RETRY_MS = 3000
const CHECK_INTERVAL_MS = 100

const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="sidebar-inventory"]',
    title: 'Inventario',
    description: 'Acá gestionás productos, categorías y stock. Todo lo que vendés vive acá.',
    placement: 'right',
    route: '/inventory',
  },
  {
    target: '[data-tour="sidebar-gastos"]',
    title: 'Gastos',
    description: 'Registrá tus gastos operativos para tener el flujo real del negocio, no solo las ventas.',
    placement: 'right',
    route: '/expenses',
  },
  {
    target: '[data-tour="sidebar-price-lists"]',
    title: 'Listas de precios',
    description: 'Podés tener múltiples listas: mayorista, minorista y promocional. Cada venta usa la lista que elijas en el momento.',
    placement: 'right',
    route: '/price-lists',
  },
  {
    target: '[data-tour="sidebar-pos"]',
    title: 'Punto de venta',
    description: 'Desde acá realizás las ventas. Vamos a verlo.',
    placement: 'right',
    route: '/pos',
  },
  {
    target: '[data-tour="pos-price-list-selector"]',
    title: 'Selector de lista de precios',
    description: 'Antes de cada venta podés elegir qué lista aplicar. Útil para atender distintos tipos de clientes.',
    placement: 'bottom',
    route: '/pos',
  },
  {
    target: '[data-tour="pos-cart"]',
    title: 'Carrito de venta',
    description: 'Los productos que agregás aparecen acá. Podés modificar cantidades, precios y aplicar descuentos.',
    placement: 'left',
    route: '/pos',
  },
  {
    target: '[data-tour="pos-cart"]',
    title: 'Todo listo',
    description: 'Tus operarios solo verán lo que sus permisos les permitan. Si necesitás ajustar algo, está en Configuración.',
    placement: 'left',
    route: '/pos',
    isLast: true,
  },
]

function isVisibleElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function findVisibleTarget(selector: string): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
  for (const candidate of candidates) {
    if (isVisibleElement(candidate)) {
      return candidate
    }
  }
  return null
}

export default function OnboardingTour({ open, profileId, onboardingState }: OnboardingTourProps) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])

  const [stepIndex, setStepIndex] = useState(0)
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null)
  const [targetRect, setTargetRect] = useState<SpotRect | null>(null)
  const [saving, setSaving] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)

  const arrowRef = useRef<HTMLDivElement | null>(null)

  const currentStep = TOUR_STEPS[stepIndex] ?? null

  const { refs, floatingStyles, middlewareData, placement, update } = useFloating({
    placement: currentStep?.placement ?? 'right',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(14), flip({ padding: 16 }), shift({ padding: 16 }), arrow({ element: arrowRef })],
  })

  const completeTour = useCallback(async () => {
    if (saving) return

    setSaving(true)

    const { data: freshProfile } = await supabase
      .from('profiles')
      .select('onboarding_state')
      .eq('id', profileId)
      .single()

    const current = parseOnboardingState(freshProfile?.onboarding_state ?? onboardingState)
    const next = mergeOnboardingState(current, {
      completed: true,
      tour_done: true,
      wizard_step: 5,
    })

    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_state: next })
      .eq('id', profileId)

    setSaving(false)

    if (error) {
      console.error('Failed to complete onboarding tour', error.message)
      return
    }

    window.dispatchEvent(new Event('onboarding-state-changed'))
    router.refresh()
  }, [onboardingState, profileId, router, saving, supabase])

  useEffect(() => {
    if (!open) return

    const query = window.matchMedia('(min-width: 1024px)')
    const apply = () => setIsDesktop(query.matches)
    apply()

    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [open])

  useEffect(() => {
    if (!open) return

    setStepIndex(0)
    setTargetElement(null)
    setTargetRect(null)
  }, [open])

  useEffect(() => {
    if (!open || !isDesktop || !currentStep) return

    if (pathname === currentStep.route) {
      return
    }

    setTargetElement(null)
    setTargetRect(null)
    router.push(currentStep.route)

    const timeout = window.setTimeout(() => {
      if (window.location.pathname === currentStep.route) {
        return
      }
      console.warn(`Onboarding tour route not reachable for step ${stepIndex + 1}: ${currentStep.route}`)
      if (stepIndex >= TOUR_STEPS.length - 1) {
        void completeTour()
        return
      }
      setStepIndex(prev => (prev === stepIndex ? prev + 1 : prev))
    }, ROUTE_RETRY_MS)

    return () => window.clearTimeout(timeout)
  }, [completeTour, currentStep, isDesktop, open, pathname, router, stepIndex])

  useEffect(() => {
    if (!open || !isDesktop || !currentStep) return
    if (pathname !== currentStep.route) return

    setTargetElement(null)
    setTargetRect(null)

    const startedAt = Date.now()
    const findTarget = () => {
      const nextTarget = findVisibleTarget(currentStep.target)
      if (nextTarget) {
        setTargetElement(nextTarget)
        return true
      }
      return false
    }

    if (findTarget()) return

    const interval = window.setInterval(() => {
      if (findTarget()) {
        window.clearInterval(interval)
        return
      }

      if (Date.now() - startedAt >= TARGET_RETRY_MS) {
        window.clearInterval(interval)
        console.warn(`Onboarding tour target not found: ${currentStep.target}`)
        if (stepIndex >= TOUR_STEPS.length - 1) {
          void completeTour()
          return
        }
        setStepIndex(prev => (prev === stepIndex ? prev + 1 : prev))
      }
    }, CHECK_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [completeTour, currentStep, isDesktop, open, pathname, stepIndex])

  useEffect(() => {
    if (!open || !isDesktop || !targetElement) return

    refs.setReference(targetElement)

    const measure = () => {
      const rect = targetElement.getBoundingClientRect()
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      })
      void update()
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(targetElement)

    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [isDesktop, open, refs, targetElement, update])

  if (!open) {
    return null
  }

  async function handleNext() {
    if (!currentStep) return

    if (currentStep.isLast || stepIndex >= TOUR_STEPS.length - 1) {
      await completeTour()
      return
    }

    const nextIndex = stepIndex + 1
    setStepIndex(nextIndex)
  }

  const totalSteps = TOUR_STEPS.length
  const progressLabel = `${stepIndex + 1} de ${totalSteps}`

  if (!isDesktop) {
    return (
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-4">
        <div className="surface-elevated w-full max-w-md rounded-xl border border-edge bg-card p-4">
          <p className="text-xs uppercase tracking-widest text-subtle font-semibold">Recorrido</p>
          <h3 className="mt-1 text-base font-semibold text-heading">Tour guiado disponible en desktop</h3>
          <p className="mt-2 text-sm text-subtle">
            En mobile mostramos una versión simplificada para no bloquear el onboarding.
          </p>
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={() => void completeTour()} disabled={saving}>
              {saving ? 'Guardando…' : 'Saltar tour'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const spotlightPadding = 8
  const spotlight = targetRect
    ? {
        top: Math.max(0, targetRect.top - spotlightPadding),
        left: Math.max(0, targetRect.left - spotlightPadding),
        width: targetRect.width + spotlightPadding * 2,
        height: targetRect.height + spotlightPadding * 2,
      }
    : null

  const side = placement.split('-')[0]
  const arrowX = middlewareData.arrow?.x
  const arrowY = middlewareData.arrow?.y

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Tour del sistema">
      <div className="fixed inset-0 z-[80]" />

      {spotlight && (
        <div
          className="pointer-events-none fixed z-[81] rounded-xl border-2 border-primary/60 transition-all duration-200"
          style={{
            top: `${spotlight.top}px`,
            left: `${spotlight.left}px`,
            width: `${spotlight.width}px`,
            height: `${spotlight.height}px`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.58)',
          }}
        />
      )}

      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className="z-[82] w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-edge surface-elevated bg-card p-4 shadow-2xl"
      >
        <div
          ref={arrowRef}
          style={{
            left: arrowX != null ? `${arrowX}px` : undefined,
            top: arrowY != null ? `${arrowY}px` : undefined,
          }}
          className={cn(
            'absolute h-3 w-3 rotate-45 border border-edge bg-card',
            side === 'top' && '-bottom-1.5 border-t-0 border-l-0',
            side === 'right' && '-left-1.5 border-r-0 border-t-0',
            side === 'bottom' && '-top-1.5 border-b-0 border-r-0',
            side === 'left' && '-right-1.5 border-l-0 border-b-0'
          )}
        />

        <p className="text-xs uppercase tracking-widest text-subtle font-semibold">Recorrido</p>
        <h3 className="mt-1 text-base font-semibold text-heading">{currentStep?.title ?? 'Recorrido'}</h3>
        <p className="mt-2 text-sm text-subtle">{currentStep?.description ?? 'Preparando paso...'}</p>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-subtle">{progressLabel}</span>
          <Button type="button" className="h-9" onClick={() => void handleNext()} disabled={saving}>
            {currentStep?.isLast || stepIndex >= totalSteps - 1 ? 'Finalizar' : 'Siguiente'}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => void completeTour()}
          className="mt-3 text-xs text-hint hover:text-body transition-colors"
          disabled={saving}
        >
          Saltar tour
        </button>
      </div>
    </div>
  )
}
