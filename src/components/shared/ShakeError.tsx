'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Total del keyframe t-input-shake (2·--shake-dur-a + 2·--shake-dur-b en
// globals.css) + margen. Mantener en sync si se tunean las variables.
const SHAKE_MS = 300
const REVERT_MS = 300

interface ShakeOnErrorProps {
  /** Truthy = estado de error. El shake se reproduce al aparecer o cambiar el mensaje. */
  error?: string | boolean | null
  /** Incrementar para forzar replay con el mismo mensaje (ej. segundo intento fallido). */
  nonce?: number
  className?: string
  children: ReactNode
}

/**
 * Error state shake (transitions-dev): sacude al children cuando `error` se
 * vuelve truthy o cambia. El replay usa remove → reflow → re-add sobre un ref
 * (no key-remount: remontar un input le robaría el foco al usuario).
 * El borde rojo sigue siendo responsabilidad de `aria-invalid` en el input.
 */
export function ShakeOnError({ error, nonce, className, children }: ShakeOnErrorProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!error) return
    const el = ref.current
    if (!el) return
    el.classList.remove('is-shaking')
    void el.offsetWidth // reflow — garantiza que la animación se reproduzca de nuevo
    el.classList.add('is-shaking')
    const t = setTimeout(() => el.classList.remove('is-shaking'), SHAKE_MS)
    return () => clearTimeout(t)
  }, [error, nonce])

  return (
    <div ref={ref} className={cn('t-input', className)}>
      {children}
    </div>
  )
}

interface FieldErrorMessageProps {
  error?: string | null | false
  id?: string
  className?: string
}

/**
 * Mensaje de error con reveal animado. Al limpiarse el error retiene el último
 * texto durante el fade-out (--revert-dur) antes de desmontar, para que la
 * altura no colapse en seco a mitad del fade.
 */
export function FieldErrorMessage({ error, id, className = 'text-xs' }: FieldErrorMessageProps) {
  const pRef = useRef<HTMLParagraphElement>(null)
  const [rendered, setRendered] = useState<string | null>(error || null)

  // setState solo desde callbacks (rAF/timeout) — el lint del React Compiler
  // prohíbe setState síncrono dentro del cuerpo del efecto.
  useEffect(() => {
    if (error) {
      const raf = requestAnimationFrame(() => setRendered(error))
      return () => cancelAnimationFrame(raf)
    }
    const t = setTimeout(() => setRendered(null), REVERT_MS)
    return () => clearTimeout(t)
  }, [error])

  // La clase de visibilidad se maneja directo en el DOM: el <p> debe pintar
  // primero oculto (reflow) para que la transición de entrada encienda.
  useEffect(() => {
    const el = pRef.current
    if (!el) return
    if (error) {
      void el.offsetHeight
      el.classList.add('is-error')
      return
    }
    el.classList.remove('is-error') // dispara el fade-out; el timer de arriba desmonta después
  }, [error, rendered])

  if (!rendered) return null
  return (
    <p
      ref={pRef}
      id={id}
      role="alert"
      className={cn('t-error-msg text-destructive', className)}
    >
      {rendered}
    </p>
  )
}
