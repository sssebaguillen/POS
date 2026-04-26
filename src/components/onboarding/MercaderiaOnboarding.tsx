'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  active: boolean
  searchInputRef: React.RefObject<HTMLDivElement | null>
  firstItemCostRef: React.RefObject<HTMLInputElement | null>
  totalRef: React.RefObject<HTMLDivElement | null>
  hasItems: boolean
  onComplete: () => void
}

interface TooltipRect {
  top: number
  left: number
  width: number
  height: number
}

interface Step {
  refKey: 'search' | 'cost' | 'total'
  title: string
  body: string
  buttonLabel: string
  requiresItems: boolean
}

const STEPS: Step[] = [
  {
    refKey: 'search',
    title: 'Buscá el producto que recibiste',
    body: 'Escribí el nombre o escaneá el código de barras. Si el producto no existe todavía, podés crearlo desde acá.',
    buttonLabel: 'Entendido →',
    requiresItems: false,
  },
  {
    refKey: 'cost',
    title: 'El costo viene de tu catálogo',
    body: "Podés editarlo si el precio cambió. Activá 'Actualizar costo' para que ese nuevo precio quede guardado en el producto.",
    buttonLabel: 'Entendido →',
    requiresItems: true,
  },
  {
    refKey: 'total',
    title: 'El total se calcula solo',
    body: 'El monto del gasto es la suma de todos los productos. Al guardar, el stock de cada uno se actualiza automáticamente.',
    buttonLabel: 'Listo',
    requiresItems: true,
  },
]

export default function MercaderiaOnboarding({
  active,
  searchInputRef,
  firstItemCostRef,
  totalRef,
  hasItems,
  onComplete,
}: Props) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<TooltipRect | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const currentStep = STEPS[stepIndex] ?? null

  function getRef(key: Step['refKey']): React.RefObject<HTMLElement | null> {
    if (key === 'search') return searchInputRef as React.RefObject<HTMLElement | null>
    if (key === 'cost') return firstItemCostRef as React.RefObject<HTMLElement | null>
    return totalRef as React.RefObject<HTMLElement | null>
  }

  useEffect(() => {
    if (!active || !currentStep) return
    if (currentStep.requiresItems && !hasItems) return

    const el = getRef(currentStep.refKey).current
    if (!el) return

    function measure() {
      if (!el) return
      const rect = el.getBoundingClientRect()
      setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }

    measure()
    const id = setInterval(measure, 200)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex, hasItems])

  useEffect(() => {
    if (!currentStep?.requiresItems || !hasItems || !active) return
    const el = getRef(currentStep.refKey).current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasItems])

  if (!active || !currentStep) return null
  if (currentStep.requiresItems && !hasItems) return null
  if (!targetRect) return null

  const TOOLTIP_WIDTH = 280
  const OFFSET = 10

  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200

  let top = targetRect.top + targetRect.height + OFFSET
  let left = targetRect.left
  let arrowUp = true

  if (top + 160 > viewportH - 16) {
    top = targetRect.top - 160 - OFFSET
    arrowUp = false
  }

  if (left + TOOLTIP_WIDTH > viewportW - 16) {
    left = viewportW - TOOLTIP_WIDTH - 16
  }
  if (left < 8) left = 8

  function advance() {
    const next = stepIndex + 1
    if (next >= STEPS.length) {
      onComplete()
      return
    }
    setTargetRect(null)
    setStepIndex(next)
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998]"
        style={{ pointerEvents: 'none' }}
        aria-hidden
      />

      <div
        ref={tooltipRef}
        className="fixed z-[9999] rounded-xl bg-primary text-primary-foreground shadow-lg p-4 flex flex-col gap-2"
        style={{ top, left, width: TOOLTIP_WIDTH }}
      >
        {arrowUp && (
          <span
            className="absolute -top-[6px] border-4 border-transparent border-b-primary"
            style={{ left: Math.min(targetRect.left + targetRect.width / 2 - left - 4, TOOLTIP_WIDTH - 16) }}
          />
        )}
        {!arrowUp && (
          <span
            className="absolute -bottom-[6px] border-4 border-transparent border-t-primary"
            style={{ left: Math.min(targetRect.left + targetRect.width / 2 - left - 4, TOOLTIP_WIDTH - 16) }}
          />
        )}

        <p className="text-sm font-semibold leading-snug">{currentStep.title}</p>
        <p className="text-xs leading-relaxed opacity-90">{currentStep.body}</p>

        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] opacity-60">
            {stepIndex + 1} / {STEPS.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onComplete}
              className="text-[11px] opacity-70 hover:opacity-100 transition-opacity underline underline-offset-2"
            >
              Saltar
            </button>
            <button
              type="button"
              onClick={advance}
              className="h-7 px-3 rounded-lg bg-primary-foreground text-primary text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              {currentStep.buttonLabel}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
