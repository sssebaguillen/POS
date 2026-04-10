'use client'

import { useState } from 'react'
import type { UserRole } from '@/lib/operator'
import { useSidebar } from '@/components/shared/AppShell'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface OperatorSwitcherProps {
  operatorName: string
  operatorRole: UserRole
}

interface LogoutResponse {
  success: boolean
  error?: string
}

function roleLabel(role: UserRole): string {
  if (role === 'owner') return 'Owner'
  if (role === 'manager') return 'Manager'
  if (role === 'custom') return 'Custom'
  return 'Cashier'
}

export default function OperatorSwitcher({ operatorName, operatorRole }: OperatorSwitcherProps) {
  const { close } = useSidebar()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  function navigateToOperatorProfile() {
    setOpen(false)
    close()
    window.location.href = '/operator/me'
  }

  async function handleSwitchOperator() {
    setOpen(false)
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

    close()
    window.location.href = '/operator-select'
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full rounded-lg border border-edge px-3 py-2 text-left text-sm text-body hover:bg-hover-bg transition-colors"
          >
            <span className="block text-xs uppercase tracking-wide text-muted-foreground">Operador activo</span>
            <span className="mt-1 block font-medium text-heading">{operatorName}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="surface-elevated w-64 p-3">
          <div className="space-y-1 border-b border-border/60 pb-3">
            <p className="text-sm font-semibold text-foreground">{operatorName}</p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{roleLabel(operatorRole)}</p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={navigateToOperatorProfile}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-body transition-colors hover:bg-hover-bg"
            >
              Mi perfil
            </button>
            <button
              type="button"
              onClick={handleSwitchOperator}
              disabled={loading}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-500/10"
            >
              {loading ? 'Cerrando sesion...' : 'Cerrar sesion de operario'}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
