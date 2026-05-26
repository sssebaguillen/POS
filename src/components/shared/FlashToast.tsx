'use client'

import { useState, useEffect } from 'react'
import Toast, { type ToastVariant } from '@/components/shared/Toast'

const MESSAGES: Record<string, string> = {
  'no-access': 'No tienes permisos para acceder a esa sección',
}

interface Props {
  message: string
  variant?: ToastVariant
}

function clearFlashCookie() {
  document.cookie = 'flash_toast=; Max-Age=0; path=/; SameSite=Lax'
}

export default function FlashToast({ message, variant = 'warning' }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    clearFlashCookie()
  }, [])

  if (!visible) return null

  return (
    <Toast
      message={MESSAGES[message] ?? message}
      variant={variant}
      duration={3000}
      onDismiss={() => {
        clearFlashCookie()
        setVisible(false)
      }}
    />
  )
}
