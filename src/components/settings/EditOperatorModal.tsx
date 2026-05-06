'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import { isSettingsOperator, type SettingsOperator } from '@/components/settings/types'
import {
  OPERATOR_MANAGEMENT_PERMISSION_KEYS,
  toOperatorManagementPermissions,
  type OperatorManagementPermissionKey,
  type OperatorManagementPermissions,
} from '@/lib/operator'
import { translateDbError } from '@/lib/errors'

interface EditOperatorModalProps {
  operator: SettingsOperator
  businessId: string
  isOwner: boolean
  canManageOperators: boolean
  onClose: () => void
  onUpdated: (operator: SettingsOperator) => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

interface PermissionField {
  key: Exclude<OperatorManagementPermissionKey, 'operators_write' | 'stock_write' | 'price_lists_write' | 'price_override'>
  label: string
  description?: string
}

interface PermissionToggleRowProps {
  label: string
  checked: boolean
  disabled?: boolean
  indented?: boolean
  onToggle: () => void
}

const PERMISSION_FIELDS: PermissionField[] = [
  { key: 'sales', label: 'Ventas' },
  { key: 'stock', label: 'Ver inventario' },
  { key: 'stats', label: 'Estadísticas' },
  { key: 'price_lists', label: 'Ver listas de precios' },
  { key: 'expenses', label: 'Gastos' },
  { key: 'settings', label: 'Configuración' },
  { key: 'free_line', label: 'Producto Libre', description: 'Puede agregar líneas de venta sin producto' },
]

function PermissionToggleRow({
  label,
  checked,
  disabled = false,
  indented = false,
  onToggle,
}: PermissionToggleRowProps) {
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 ${indented ? 'pl-8' : ''}`}>
      <span className={`text-sm ${indented ? 'text-hint' : 'text-body'}`}>{label}</span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          disabled
            ? 'cursor-not-allowed bg-muted opacity-60'
            : checked
              ? 'cursor-pointer bg-primary'
              : 'cursor-pointer bg-muted-foreground'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
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
    setPermissions(prev => {
      if (key === 'sales') {
        const nextSales = !prev.sales
        return {
          ...prev,
          sales: nextSales,
          price_override: nextSales ? prev.price_override : false,
        }
      }

      if (key === 'stock') {
        const nextStock = !prev.stock

        return {
          ...prev,
          stock: nextStock,
          stock_write: nextStock ? prev.stock_write : false,
        }
      }

      if (key === 'price_lists') {
        const nextPriceLists = !prev.price_lists

        return {
          ...prev,
          price_lists: nextPriceLists,
          price_lists_write: nextPriceLists ? prev.price_lists_write : false,
        }
      }

      if (key === 'settings') {
        const nextSettings = !prev.settings

        return {
          ...prev,
          settings: nextSettings,
          operators_write: nextSettings ? prev.operators_write : false,
        }
      }

      return {
        ...prev,
        [key]: !prev[key],
      }
    })
    setError(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isOwner && !trimmedName) {
      setError('El nombre es obligatorio.')
      return
    }

    if (isOwner && (newPin.length > 0 || confirmPin.length > 0)) {
      if (!newPin || !confirmPin) {
        setError('Completa ambos campos de PIN para continuar.')
        return
      }

      if (newPin !== confirmPin) {
        setError('Los PIN ingresados no coinciden.')
        return
      }

      if (!/^\d{4}$|^\d{6}$/.test(newPin)) {
        setError('El PIN debe contener exactamente 4 o 6 dígitos.')
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

    const { error: updateError } = await supabase.rpc('update_operator', {
      p_operator_id: operator.id,
      p_name: shouldSendName ? trimmedName : null,
      p_new_pin: shouldSendPin ? newPin : null,
      p_permissions: permissionsToSend,
    })

    if (updateError) {
      setLoading(false)
      onError(translateDbError(updateError.message, 'No se pudo actualizar el operario.'))
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-heading">Editar operario</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
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

                <div className="rounded-lg border border-edge divide-y divide-edge">
                  {PERMISSION_FIELDS.map(({ key, label }) => (
                    <div key={key}>
                      <PermissionToggleRow
                        label={label}
                        checked={permissions[key]}
                        onToggle={() => handleTogglePermission(key)}
                      />

                      {key === 'sales' && permissions.sales && (
                        <div className="border-t border-edge">
                          <PermissionToggleRow
                            label="Editar precio en venta"
                            checked={permissions.price_override}
                            indented
                            onToggle={() => handleTogglePermission('price_override')}
                          />
                        </div>
                      )}

                      {key === 'stock' && permissions.stock && (
                        <div className="border-t border-edge">
                          <PermissionToggleRow
                            label="Modificar inventario"
                            checked={permissions.stock_write}
                            indented
                            onToggle={() => handleTogglePermission('stock_write')}
                          />
                        </div>
                      )}

                      {key === 'price_lists' && permissions.price_lists && (
                        <div className="border-t border-edge">
                          <PermissionToggleRow
                            label="Modificar listas de precios"
                            checked={permissions.price_lists_write}
                            indented
                            onToggle={() => handleTogglePermission('price_lists_write')}
                          />
                        </div>
                      )}

                      {key === 'settings' && permissions.settings && (
                        <div className="border-t border-edge">
                          <PermissionToggleRow
                            label="Gestionar operarios"
                            checked={permissions.operators_write}
                            indented
                            onToggle={() => handleTogglePermission('operators_write')}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
