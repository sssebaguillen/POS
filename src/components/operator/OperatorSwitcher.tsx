'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CaretUp, UserCircle, Key, Gear, Users, SignOut } from '@phosphor-icons/react/dist/ssr'
import type { Permissions, UserRole } from '@/lib/operator'
import { OPERATOR_ROLE_LABELS, PROFILE_ROLE_LABELS } from '@/lib/constants/domain'
import { useSidebar } from '@/components/shared/AppShell'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface OperatorSwitcherProps {
  operatorName: string
  operatorRole: UserRole
  permissions: Permissions | null
  // Owner / lock-screen: also surface "Cuenta" (master account) and full logout.
  showAccountActions: boolean
  collapsed: boolean
  isMobileDrawer: boolean
  onLogout: () => void
}

interface LogoutResponse {
  success: boolean
  error?: string
}

function roleLabel(role: UserRole): string {
  if (role === 'owner') return PROFILE_ROLE_LABELS.owner
  return OPERATOR_ROLE_LABELS[role]
}

const itemBase =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]'
const itemNormal = 'text-body hover:bg-hover-bg hover:text-heading'
const itemActive = 'bg-primary/10 text-[var(--primary-active-text)] font-semibold'
const itemDanger = 'text-destructive hover:bg-destructive/10'

export default function OperatorSwitcher({
  operatorName,
  operatorRole,
  permissions,
  showAccountActions,
  collapsed,
  isMobileDrawer,
  onLogout,
}: OperatorSwitcherProps) {
  const { close } = useSidebar()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const compact = collapsed && !isMobileDrawer
  const settingsAllowed = permissions === null || permissions.settings === true

  function closeAll() {
    setOpen(false)
    close()
  }

  function goOperatorProfile() {
    closeAll()
    window.location.href = '/operator/me'
  }

  async function handleSwitchOperator() {
    setOpen(false)
    setLoading(true)
    setError('')

    const response = await fetch('/api/operator/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const payload = (await response.json().catch(() => null)) as LogoutResponse | null
    setLoading(false)

    if (!response.ok || !payload?.success) {
      setError(payload?.error ?? 'No se pudo cambiar de operador.')
      return
    }

    close()
    window.location.href = '/operator-select'
  }

  const menuItems = (
    <div className="space-y-0.5">
      <button type="button" onClick={goOperatorProfile} className={cn(itemBase, itemNormal)}>
        <UserCircle size={16} />
        Mi perfil
      </button>

      {showAccountActions && (
        <Link href="/profile" onClick={closeAll} className={cn(itemBase, itemNormal)}>
          <Key size={16} />
          Cuenta
        </Link>
      )}

      {settingsAllowed && (
        <Link
          href="/settings"
          onClick={closeAll}
          className={cn(itemBase, pathname === '/settings' ? itemActive : itemNormal)}
        >
          <Gear size={16} />
          Configuración
        </Link>
      )}

      <div className="my-1 border-t border-edge-soft" />

      <button
        type="button"
        onClick={handleSwitchOperator}
        disabled={loading}
        className={cn(itemBase, itemNormal, 'disabled:opacity-60')}
      >
        <Users size={16} />
        {loading ? 'Cambiando…' : 'Cambiar de operador'}
      </button>

      {showAccountActions && (
        <button type="button" onClick={onLogout} className={cn(itemBase, itemDanger)}>
          <SignOut size={16} />
          Cerrar sesión
        </button>
      )}
    </div>
  )

  // Collapsed desktop rail (72px): an inline accordion can't fit, so the avatar
  // icon opens a flyout popover with the same menu.
  if (compact) {
    return (
      <>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Cuenta"
              aria-label="Menú de cuenta"
              className="flex w-full items-center justify-center rounded-lg p-2.5 text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95"
            >
              <UserCircle size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="end" className="surface-elevated w-60 p-2">
            <div className="mb-1 border-b border-border/60 px-2 pb-2">
              <p className="truncate text-sm font-semibold text-foreground">{operatorName}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{roleLabel(operatorRole)}</p>
            </div>
            {menuItems}
          </PopoverContent>
        </Popover>
        {error && <p className="pt-1.5 text-xs text-destructive">{error}</p>}
      </>
    )
  }

  // Expanded / mobile drawer: the operator card toggles a slide-up accordion.
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="relative z-10 flex w-full items-center justify-between rounded-lg border border-edge bg-card px-3 py-2 text-left shadow-sm transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] hover:bg-hover-bg"
      >
        <span className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Operador activo</span>
          <span className="mt-0.5 block truncate font-medium text-heading">{operatorName}</span>
        </span>
        <CaretUp
          size={16}
          className={cn(
            'shrink-0 text-hint transition-transform duration-200 ease-[var(--ease-out)]',
            open ? 'rotate-180' : ''
          )}
        />
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out)]',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="pt-1.5">{menuItems}</div>
        </div>
      </div>

      {error && <p className="px-1 pt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}
