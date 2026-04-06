'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  message: string
  duration?: number
  onUndo?: () => void
  onDismiss: () => void
}

export default function Toast({ message, duration = 5500, onUndo, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [duration, onDismiss])

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-2.5 shadow-lg text-sm text-popover-foreground"
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
        aria-label="Cerrar notificacion"
        className="rounded p-0.5 hover:bg-muted transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}
