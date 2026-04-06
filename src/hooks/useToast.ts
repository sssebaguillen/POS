'use client'

import { useState, useCallback } from 'react'

export interface ToastOptions {
  message: string
  duration?: number
  onUndo?: () => void
}

export interface ToastState {
  message: string
  duration: number
  onUndo?: () => void
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((opts: ToastOptions) => {
    setToast({
      message: opts.message,
      duration: opts.duration ?? 5500,
      onUndo: opts.onUndo,
    })
  }, [])

  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  return { toast, showToast, dismissToast }
}
