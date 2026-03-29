'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

const MESSAGES: Record<string, string> = {
  'no-access': 'No tenés permisos para acceder a esa sección',
}

interface Props {
  message: string
}

function clearFlashCookie() {
  document.cookie = 'flash_toast=; Max-Age=0; path=/; SameSite=Lax'
}

export default function FlashToast({ message }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    clearFlashCookie()
    const timer = setTimeout(() => setVisible(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[60] flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-4 py-2.5 shadow-lg text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/80 dark:text-amber-200"
    >
      <span>{MESSAGES[message] ?? message}</span>
      <button
        type="button"
        onClick={() => {
          clearFlashCookie()
          setVisible(false)
        }}
        aria-label="Cerrar notificacion"
        className="ml-1 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}
