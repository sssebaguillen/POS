'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

export type ToastVariant = 'success' | 'warning' | 'error'

interface Props {
  message: string
  duration?: number
  variant?: ToastVariant
  onUndo?: () => void
  onDismiss: () => void
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: 'border-border bg-popover text-popover-foreground',
  warning: 'border-amber-200 bg-background text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/80 dark:text-amber-200',
  error: 'border-destructive/30 bg-background text-destructive dark:border-destructive/40 dark:bg-destructive/10 dark:text-red-300',
}

export default function Toast({ message, duration = 5500, variant = 'success', onUndo, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [duration, onDismiss])

  return (
    <div
      role={variant === 'success' ? 'status' : 'alert'}
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-lg border px-4 py-2.5 shadow-lg text-sm animate-fade-in ${VARIANT_CLASSES[variant]}`}
    >
      <span>{message}</span>
      {onUndo && (
        <button
          type="button"
          onClick={() => { onUndo(); onDismiss() }}
          className="rounded px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          Deshacer
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar notificación"
        className="rounded p-0.5 hover:bg-muted transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}
