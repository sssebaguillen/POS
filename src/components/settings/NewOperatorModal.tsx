'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
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
  open: boolean
  onClose: () => void
  businessId: string
  onCreated: (operator: SettingsOperator) => void
}

export default function NewOperatorModal({ open, onClose, businessId, onCreated }: NewOperatorModalProps) {
  const [name, setName] = useState('')
  const [baseRole, setBaseRole] = useState<BaseRole>('cashier')
  const [permissions, setPermissions] = useState<Permissions>(ROLE_DEFAULTS.cashier)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) return
    setName('')
    setBaseRole('cashier')
    setPermissions(ROLE_DEFAULTS.cashier)
    setPin('')
    setError(null)
  }, [open])

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
      }
    } catch {
      // re-query failed — operator was created, just couldn't fetch it
    } finally {
      setLoading(false)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <h2 className="text-base font-semibold text-foreground">Nuevo operario</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-label text-muted-foreground">
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
            <p className="text-label text-muted-foreground">Rol base</p>
            <div className="flex gap-2">
              {BASE_ROLES.map(role => (
                <button
                  key={role}
                  type="button"
                  onClick={() => handleRoleSelect(role)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    baseRole === role
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-transparent text-foreground border-border hover:bg-muted/40'
                  }`}
                >
                  {OPERATOR_ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-label text-muted-foreground">Permisos</p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/60">
              {PERMISSION_LABELS.map(({ key, label }) => (
                <div key={key}>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm text-foreground">{label}</span>
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
                    <div className="flex items-center justify-between border-t border-border/60 px-3 py-2.5 pl-8">
                      <span className="text-sm text-muted-foreground">Modificar inventario</span>
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
                    <div className="flex items-center justify-between border-t border-border/60 px-3 py-2.5 pl-8">
                      <span className="text-sm text-muted-foreground">Modificar listas de precios</span>
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
                    <div className="flex items-center justify-between border-t border-border/60 px-3 py-2.5 pl-8">
                      <span className="text-sm text-muted-foreground">Gestionar operarios</span>
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
            <label className="text-label text-muted-foreground">
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

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creando...' : 'Crear operario'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
