'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSidebar } from '@/components/shared/AppShell'

interface OperatorSwitcherProps {
  operatorName: string
}

interface LogoutResponse {
  success: boolean
  error?: string
}

export default function OperatorSwitcher({ operatorName }: OperatorSwitcherProps) {
  const router = useRouter()
  const { close } = useSidebar()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSwitchOperator() {
    close()
    setLoading(true)
    setError('')

    const response = await fetch('/api/operator/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const payload = (await response.json().catch(() => null)) as LogoutResponse | null

    setLoading(false)

    if (!response.ok || !payload?.success) {
      setError(payload?.error ?? 'No se pudo cerrar el operador activo.')
      return
    }

    router.push('/operator-select')
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleSwitchOperator}
        disabled={loading}
        className="w-full rounded-lg border border-edge px-3 py-2 text-left text-sm text-body hover:bg-hover-bg transition-colors disabled:opacity-60"
      >
        {loading ? 'Cambiando operador...' : `Operador: ${operatorName}`}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
