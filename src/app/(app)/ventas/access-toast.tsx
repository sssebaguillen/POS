'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  message: string
}

export default function AccessToast({ message }: Props) {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <div
      role="alert"
      className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-red-200 bg-white px-4 py-3 shadow-lg text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/80 dark:text-red-300"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Cerrar notificacion"
        className="ml-1 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  )
}
