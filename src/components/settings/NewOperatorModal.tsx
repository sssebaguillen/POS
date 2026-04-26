'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import { isSettingsOperator, type SettingsOperator } from '@/components/settings/types'
import { OPERATOR_ROLES, OPERATOR_ROLE_LABELS, type OperatorRole } from '@/lib/constants/domain'
import type { Permissions } from '@/lib/operator'

type VisiblePermissionKey = Exclude<keyof Permissions, 'operators_write' | 'stock_write' | 'price_lists_write'>
type BaseRole = Exclude<OperatorRole, 'custom'>

const PERMISSION_LABELS: { key: VisiblePermissionKey; label: string }[] = [
  { key: 'sales',              label: 'Ventas' },
  { key: 'stock',              label: 'Ver inventario' },
  { key: 'stats',              label: 'Estadísticas' },
  { key: 'expenses',           label: 'Gastos' },
  { key: 'price_lists',        label: 'Ver listas de precios' },
  { key: 'price_override',     label: 'Editar precio en venta' },
  { key: 'settings',           label: 'Configuración' },
]

const ROLE_DEFAULTS: Record<BaseRole, Permissions> = {
  manager: { sales: true, stock: true, stock_write: true,  stats: true,  expenses: true,  price_lists: true,  price_lists_write: true,  settings: false, operators_write: false, price_override: false },
  cashier: { sales: true, stock: true, stock_write: false, stats: false, expenses: false, price_lists: false, price_lists_write: false, settings: false, operators_write: false, price_override: false },
}

const BASE_ROLES: BaseRole[] = OPERATOR_ROLES.filter((role): role is BaseRole => role !== 'custom')

function permissionsMatch(a: Permissions, b: Permissions): boolean {
  return (Object.keys(a) as (keyof Permissions)[]).every(key => a[key] === b[key])
}

interface NewOperatorModalProps {
  /** When true, renders only the form (no Dialog). */
  embedded?: boolean
  open?: boolean
  onClose: () => void
  businessId: string
  onCreated: (operator: SettingsOperator) => void
  onSuccess?: (operator: SettingsOperator) => void
}

export default function NewOperatorModal({
  embedded = false,
  open = false,
  onClose,
  businessId,
  onCreated,
  onSuccess,
}: NewOperatorModalProps) {
  const [name, setName] = useState('')
  const [baseRole, setBaseRole] = useState<BaseRole>('cashier')
  const [permissions, setPermissions] = useState<Permissions>(ROLE_DEFAULTS.cashier)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (embedded) return
    if (!open) return
    setName('')
    setBaseRole('cashier')
    setPermissions(ROLE_DEFAULTS.cashier)
    setPin('')
    setError(null)
  }, [open, embedded])

  function handleRoleSelect(role: BaseRole) {
    setBaseRole(role)
    setPermissions(ROLE_DEFAULTS[role])
  }

  function togglePermission(key: keyof Permissions) {
    setPermissions(prev => {
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

      return { ...prev, [key]: !prev[key] }
    })
  }

  function normalizePin(value: string): string {
    return value.replace(/\D/g, '').slice(0, 6)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('El nombre es obligatorio.')
      return
    }

    if (!/^\d{4}$|^\d{6}$/.test(pin)) {
      setError('El PIN debe contener exactamente 4 o 6 dígitos.')
      return
    }

    const roleToSend = permissionsMatch(permissions, ROLE_DEFAULTS.manager)
      ? 'manager'
      : permissionsMatch(permissions, ROLE_DEFAULTS.cashier)
      ? 'cashier'
      : 'custom'

    setLoading(true)
    setError(null)

    const { data: createData, error: createError } = await supabase.rpc('create_operator', {
      p_business_id: businessId,
      p_name: trimmedName,
      p_role: roleToSend,
      p_pin: pin,
      p_permissions: permissions,
    })

    if (createError || !createData?.success) {
      setError(createData?.error ?? createError?.message ?? 'Error al crear el operador.')
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
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    baseRole === role
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
            <div className="rounded-lg border border-edge divide-y divide-edge">
              {PERMISSION_LABELS.map(({ key, label }) => (
                <div key={key}>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm text-body">{label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={permissions[key]}
                      onClick={() => togglePermission(key)}
                      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${permissions[key] ? 'bg-primary' : 'bg-muted-foreground'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${permissions[key] ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                  </div>

                  {key === 'stock' && permissions.stock && (
                    <div className="flex items-center justify-between border-t border-edge px-3 py-2.5 pl-8">
                      <span className="text-sm text-subtle">Modificar inventario</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={permissions.stock_write}
                        onClick={() => togglePermission('stock_write')}
                        className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${permissions.stock_write ? 'bg-primary' : 'bg-muted-foreground'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${permissions.stock_write ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  )}

                  {key === 'price_lists' && permissions.price_lists && (
                    <div className="flex items-center justify-between border-t border-edge px-3 py-2.5 pl-8">
                      <span className="text-sm text-subtle">Modificar listas de precios</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={permissions.price_lists_write}
                        onClick={() => togglePermission('price_lists_write')}
                        className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${permissions.price_lists_write ? 'bg-primary' : 'bg-muted-foreground'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${permissions.price_lists_write ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  )}

                  {key === 'settings' && permissions.settings && (
                    <div className="flex items-center justify-between border-t border-edge px-3 py-2.5 pl-8">
                      <span className="text-sm text-subtle">Gestionar operarios</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={permissions.operators_write}
                        onClick={() => togglePermission('operators_write')}
                        className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${permissions.operators_write ? 'bg-primary' : 'bg-muted-foreground'}`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${permissions.operators_write ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h2 className="text-base font-semibold text-heading">Nuevo operario</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
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
