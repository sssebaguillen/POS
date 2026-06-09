'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import Toast, { type ToastVariant } from '@/components/shared/Toast'

export interface ToastOptions {
  message: string
  duration?: number
  variant?: ToastVariant
  onUndo?: () => void
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void
  dismissToast: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

interface ToastState {
  message: string
  duration: number
  variant: ToastVariant
  onUndo?: () => void
  key: number
}

/**
 * Provider único de toasts: mantiene un solo toast a la vez (el último gana) y lo renderiza
 * de forma centralizada arriba-centrado vía `<Toast>`. Reemplaza el estado per-componente del
 * viejo `useToast`. Se monta una sola vez en `(app)/layout.tsx`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((opts: ToastOptions) => {
    setToast({
      message: opts.message,
      duration: opts.duration ?? 5500,
      variant: opts.variant ?? 'success',
      onUndo: opts.onUndo,
      key: Date.now(),
    })
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {toast && (
        <Toast
          key={toast.key}
          message={toast.message}
          duration={toast.duration}
          variant={toast.variant}
          onUndo={toast.onUndo}
          onDismiss={dismissToast}
        />
      )}
    </ToastContext.Provider>
  )
}

// Fallback no-op para componentes que se renderizan FUERA del provider (ej. el Sidebar/
// FeedbackButton también se montan en `(standalone)/operator-select`, que no usa `(app)/layout`).
// Nunca lanza: en ese contexto los toasts simplemente no se muestran, en vez de crashear la ruta.
const NOOP_TOAST: ToastContextValue = { showToast: () => {}, dismissToast: () => {} }

export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_TOAST
}
