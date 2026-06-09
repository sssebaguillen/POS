'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/shared/ToastProvider'
import type { ToastVariant } from '@/components/shared/Toast'

const MESSAGES: Record<string, string> = {
  'no-access': 'No tienes permisos para acceder a esa sección',
}

function clearFlashCookie() {
  document.cookie = 'flash_toast=; Max-Age=0; path=/; SameSite=Lax'
}

interface Props {
  message: string
  variant?: ToastVariant
}

/** Lee el mensaje flash (cookie) y lo dispara una vez en el toast global. No renderiza nada. */
export default function FlashToast({ message, variant = 'warning' }: Props) {
  const { showToast } = useToast()

  useEffect(() => {
    showToast({ message: MESSAGES[message] ?? message, variant, duration: 3000 })
    clearFlashCookie()
  }, [message, variant, showToast])

  return null
}
