'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { X } from 'lucide-react'
import { isSettingsOperator, type SettingsOperator } from '@/components/settings/types'
import { OPERATOR_ROLE_LABELS } from '@/lib/constants/domain'
import type { Permissions } from '@/lib/operator'
import {
  ROLE_DEFAULTS,
  type RolePreset,
  presetForPermissions,
  applyPermissionToggle,
  PermissionsFields,
} from '@/components/settings/operatorPermissions'
import { ERR } from '@/lib/errors'

const BASE_ROLES: RolePreset[] = ['cashier', 'manager']

interface NewOperatorModalProps {
  /** When true, renders only the form (no Dialog). */
  embedded?: boolean
  open?: boolean
  onClose: () => void
  businessId: string
  operatorId: string | null
  onCreated: (operator: SettingsOperator) => void
  onSuccess?: (operator: SettingsOperator) => void
}

export default function NewOperatorModal({
  embedded = false,
  open = false,
  onClose,
  businessId,
  operatorId,
  onCreated,
  onSuccess,
}: NewOperatorModalProps) {
  const [name, setName] = useState('')
  const [permissions, setPermissions] = useState<Permissions>(ROLE_DEFAULTS.cashier)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (embedded) return
    if (!open) return
    setName('')
    setPermissions(ROLE_DEFAULTS.cashier)
    setPin('')
    setError(null)
  }, [open, embedded])

  const activePreset = presetForPermissions(permissions)

  function handleRoleSelect(role: RolePreset) {
    setPermissions(ROLE_DEFAULTS[role])
  }

  function togglePermission(key: keyof Permissions) {
    setPermissions(prev => applyPermissionToggle(prev, key))
  }

  function normalizePin(value: string): string {
    return value.replace(/\D/g, '').slice(0, 6)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(ERR.OPR41)
      return
    }

    if (!/^\d{4}$|^\d{6}$/.test(pin)) {
      setError(ERR.OPR42)
      return
    }

    const roleToSend = activePreset

    setLoading(true)
    setError(null)

    try {
      const { data: createData, error: createError } = await supabase.rpc('create_operator', {
        p_actor_operator_id: operatorId,
        p_business_id: businessId,
        p_name: trimmedName,
        p_role: roleToSend,
        p_pin: pin,
        p_permissions: permissions,
      })

      if (createError || !createData?.success) {
        setError(createData?.error ?? ERR.OPR1)
        return
      }
    } catch {
      setError(ERR.OPR1)
      setLoading(false)
      return
    }

    try {
      const { data: newOps } = await supabase
        .from('operators')
        .select('id, name, role, permissions')
        .eq('business_id', businessId)
        .eq('name', trimmedName)
        .order('created_at', { ascending: false })
        .limit(1)

      const created = newOps?.[0]
      if (created && isSettingsOperator(created)) {
        onCreated(created)
        onSuccess?.(created)
      }
    } catch (refetchError) {
      console.error('Failed to refetch created operator', refetchError)
    } finally {
      setLoading(false)
      if (!embedded) {
        onClose()
      }
    }
  }

  if (!embedded && !open) {
    return null
  }

  const formBody = (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto px-5 py-4 flex-1 space-y-5">
          <div className="space-y-1.5">
            <label className="text-label text-subtle">
              Nombre <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              placeholder="Nombre del operario"
              required
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-label text-subtle">Rol base</p>
            <div className="flex gap-2">
              {BASE_ROLES.map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => handleRoleSelect(role)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${
                    activePreset === role
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent text-body border-edge hover:bg-hover-bg'
                  }`}
                >
                  {OPERATOR_ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-label text-subtle">Permisos</p>
            <PermissionsFields permissions={permissions} onToggle={togglePermission} />
          </div>

          <div className="space-y-1.5">
            <label className="text-label text-subtle">
              PIN <span className="text-destructive">*</span>
            </label>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={e => { setPin(normalizePin(e.target.value)); setError(null) }}
              placeholder="4 o 6 dígitos"
              required
            />
          </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="border-t border-edge px-5 py-4 flex items-center justify-end gap-2.5">
            {!embedded && (
              <Button type="button" variant="cancel" onClick={onClose} disabled={loading} className="h-9 rounded-lg text-sm">
                Cancelar
              </Button>
            )}
            <Button type="submit" disabled={loading} className="h-9 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground">
              {loading ? 'Creando...' : 'Crear operario'}
            </Button>
          </div>
        </form>
  )

  if (embedded) {
    return (
      <div className="max-h-[min(70vh,520px)] overflow-y-auto rounded-xl border border-edge bg-surface">
        {formBody}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm p-0 gap-0 overflow-hidden bg-card flex flex-col" showCloseButton={false}>
        <VisuallyHidden><DialogTitle>Nuevo operario</DialogTitle></VisuallyHidden>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h2 className="text-base font-semibold text-heading">Nuevo operario</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {formBody}
      </DialogContent>
    </Dialog>
  )
}
