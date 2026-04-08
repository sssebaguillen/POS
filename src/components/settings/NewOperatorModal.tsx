'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { isSettingsOperator, type SettingsOperator } from '@/components/settings/types'
import type { Permissions } from '@/lib/operator'

const PERMISSION_LABELS: { key: keyof Permissions; label: string }[] = [
  { key: 'sales',              label: 'Ventas' },
  { key: 'stock',              label: 'Ver inventario' },
  { key: 'stock_write',        label: 'Modificar inventario' },
  { key: 'stats',              label: 'Estadísticas' },
  { key: 'expenses',           label: 'Gastos' },
  { key: 'price_lists',        label: 'Ver listas de precios' },
  { key: 'price_lists_write',  label: 'Modificar listas de precios' },
  { key: 'price_override',     label: 'Editar precio en venta' },
  { key: 'settings',           label: 'Configuración' },
]

const ROLE_DEFAULTS: Record<'manager' | 'cashier', Permissions> = {
  manager: { sales: true, stock: true, stock_write: true,  stats: true,  expenses: true,  price_lists: true,  price_lists_write: true,  settings: false, price_override: false },
  cashier: { sales: true, stock: true, stock_write: false, stats: false, expenses: false, price_lists: false, price_lists_write: false, settings: false, price_override: false },
}

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
  const [baseRole, setBaseRole] = useState<'manager' | 'cashier'>('cashier')
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

  function handleRoleSelect(role: 'manager' | 'cashier') {
    setBaseRole(role)
    setPermissions(ROLE_DEFAULTS[role])
  }

  function togglePermission(key: keyof Permissions) {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }))
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
        .select('id, name, role')
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
              {(['cashier', 'manager'] as const).map(role => (
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
                  {role === 'cashier' ? 'Cashier' : 'Manager'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-label text-muted-foreground">Permisos</p>
            <div className="rounded-lg border border-border/60 divide-y divide-border/60">
              {PERMISSION_LABELS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between px-3 py-2.5">
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
