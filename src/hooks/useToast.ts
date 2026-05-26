'use client'

import { useState, useCallback } from 'react'
import type { ToastVariant } from '@/components/shared/Toast'

export interface ToastOptions {
  message: string
  duration?: number
  variant?: ToastVariant
  onUndo?: () => void
}

export interface ToastState {
  message: string
  duration: number
  variant: ToastVariant
  onUndo?: () => void
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((opts: ToastOptions) => {
    setToast({
      message: opts.message,
      duration: opts.duration ?? 5500,
      variant: opts.variant ?? 'success',
      onUndo: opts.onUndo,
    })
  }, [])

  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  return { toast, showToast, dismissToast }
}
