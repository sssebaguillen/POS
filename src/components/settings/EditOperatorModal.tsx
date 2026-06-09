'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { X } from 'lucide-react'
import { isSettingsOperator, type SettingsOperator } from '@/components/settings/types'
import {
  OPERATOR_MANAGEMENT_PERMISSION_KEYS,
  toOperatorManagementPermissions,
  type OperatorManagementPermissionKey,
  type OperatorManagementPermissions,
} from '@/lib/operator'
import { applyPermissionToggle, PermissionsFields } from '@/components/settings/operatorPermissions'
import { translateDbError, ERR } from '@/lib/errors'

interface EditOperatorModalProps {
  operator: SettingsOperator
  businessId: string
  actorOperatorId: string | null
  isOwner: boolean
  canManageOperators: boolean
  onClose: () => void
  onUpdated: (operator: SettingsOperator) => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

function normalizePin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

function permissionsChanged(
  current: OperatorManagementPermissions,
  initial: OperatorManagementPermissions
): boolean {
  return OPERATOR_MANAGEMENT_PERMISSION_KEYS.some(key => current[key] !== initial[key])
}

export default function EditOperatorModal({
  operator,
  businessId,
  actorOperatorId,
  isOwner,
  canManageOperators,
  onClose,
  onUpdated,
  onSuccess,
  onError,
}: EditOperatorModalProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [name, setName] = useState(operator.name)
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [permissions, setPermissions] = useState<OperatorManagementPermissions>(
    toOperatorManagementPermissions(operator.permissions)
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const initialPermissions = useMemo(
    () => toOperatorManagementPermissions(operator.permissions),
    [operator]
  )

  const canEditPermissions = isOwner || canManageOperators

  const trimmedName = name.trim()
  const shouldSendName = isOwner && trimmedName !== operator.name
  const shouldSendPin = isOwner && newPin.length > 0 && confirmPin.length > 0
  const shouldSendPermissions = canEditPermissions && permissionsChanged(permissions, initialPermissions)
  const hasChanges = shouldSendName || shouldSendPin || shouldSendPermissions

  function handleTogglePermission(key: OperatorManagementPermissionKey) {
    setPermissions(prev => applyPermissionToggle(prev, key))
    setError(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isOwner && !trimmedName) {
      setError(ERR.OPR41)
      return
    }

    if (isOwner && (newPin.length > 0 || confirmPin.length > 0)) {
      if (!newPin || !confirmPin) {
        setError(ERR.OPR43)
        return
      }

      if (newPin !== confirmPin) {
        setError(ERR.OPR44)
        return
      }

      if (!/^\d{4}$|^\d{6}$/.test(newPin)) {
        setError(ERR.OPR42)
        return
      }
    }

    if (!hasChanges) {
      onClose()
      return
    }

    setLoading(true)
    setError(null)

    const permissionsToSend = shouldSendPermissions ? permissions : null
    const nextName = shouldSendName ? trimmedName : operator.name

    const { data: updateResult, error: updateError } = await supabase.rpc('update_operator', {
      p_actor_operator_id: actorOperatorId,
      p_business_id: businessId,
      p_target_operator_id: operator.id,
      p_name: shouldSendName ? trimmedName : null,
      p_new_pin: shouldSendPin ? newPin : null,
      p_permissions: permissionsToSend,
    })

    const result = updateResult as { success: boolean; error?: string } | null

    if (updateError || !result?.success) {
      setLoading(false)
      onError(translateDbError(result?.error ?? updateError?.message ?? '', ERR.OPR1))
      return
    }

    const { data: updatedRows, error: fetchError } = await supabase
      .from('operators')
      .select('id, name, role, permissions')
      .eq('business_id', businessId)
      .eq('id', operator.id)
      .limit(1)

    const fallbackOperator: SettingsOperator = {
      ...operator,
      name: nextName,
      permissions: {
        ...operator.permissions,
        ...(permissionsToSend ?? {}),
      },
    }

    const refreshedOperator = fetchError
      ? fallbackOperator
      : (updatedRows ?? []).filter(isSettingsOperator)[0] ?? fallbackOperator

    setLoading(false)
    onUpdated(refreshedOperator)
    onClose()
    onSuccess('Operario actualizado correctamente.')
    router.refresh()
  }

  return (
    <Dialog open onOpenChange={nextOpen => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden bg-card flex flex-col" showCloseButton={false}>
        <VisuallyHidden><DialogTitle>Editar operario</DialogTitle></VisuallyHidden>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-heading">Editar operario</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="overflow-y-auto px-5 py-4 flex-1 space-y-5">
            {isOwner && (
              <section className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-label text-subtle">
                    Nombre actual
                  </label>
                  <Input
                    value={name}
                    onChange={event => {
                      setName(event.target.value)
                      setError(null)
                    }}
                    placeholder="Nombre del operario"
                    required
                  />
                  <p className="text-xs text-hint">
                    Solo el dueño puede actualizar el nombre del operario.
                  </p>
                </div>
              </section>
            )}

            {isOwner && (
              <section className="space-y-3">
                <div>
                  <h3 className="text-label text-subtle">Resetear PIN</h3>
                  <p className="mt-1 text-sm text-hint">
                    Solo se enviará un nuevo PIN si completas ambos campos.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-label text-subtle">Nuevo PIN</label>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={newPin}
                      onChange={event => {
                        setNewPin(normalizePin(event.target.value))
                        setError(null)
                      }}
                      placeholder="4 o 6 dígitos"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-label text-subtle">Confirmar PIN</label>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      value={confirmPin}
                      onChange={event => {
                        setConfirmPin(normalizePin(event.target.value))
                        setError(null)
                      }}
                      placeholder="Repite el PIN"
                    />
                  </div>
                </div>
              </section>
            )}

            {canEditPermissions && (
              <section className="space-y-3">
                <div>
                  <h3 className="text-label text-subtle">Permisos</h3>
                  <p className="mt-1 text-sm text-hint">
                    Al guardar se envía el estado completo de permisos del operario.
                  </p>
                </div>

                <PermissionsFields permissions={permissions} onToggle={handleTogglePermission} defaultExpanded />
              </section>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="border-t border-edge px-5 py-4 flex items-center justify-end gap-2.5 shrink-0">
            <Button type="button" variant="cancel" onClick={onClose} disabled={loading} className="h-9 rounded-lg text-sm">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || !hasChanges} className="h-9 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground">
              {loading ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
