'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Permissions } from '@/lib/operator'

// Modelo de permisos de operario: 8 capacidades agrupadas en 4 áreas. Compartido por
// New/EditOperatorModal. Ver docs/todo/permisos-operario-redesign.md.

export type RolePreset = 'manager' | 'cashier'

export const ROLE_DEFAULTS: Record<RolePreset, Permissions> = {
  manager: {
    online_orders: true, pos_pricing: true, inventory_read: true, inventory_write: true,
    reports: true, expenses: true, settings: false, manage_operators: false,
  },
  cashier: {
    online_orders: true, pos_pricing: false, inventory_read: true, inventory_write: false,
    reports: false, expenses: false, settings: false, manage_operators: false,
  },
}

const PERMISSION_AREAS: { area: string; items: { key: keyof Permissions; label: string }[] }[] = [
  {
    area: 'Mostrador',
    items: [
      { key: 'pos_pricing', label: 'Ajustar precios en la venta' },
      { key: 'online_orders', label: 'Pedidos online' },
    ],
  },
  {
    area: 'Inventario',
    items: [
      { key: 'inventory_read', label: 'Ver inventario' },
      { key: 'inventory_write', label: 'Editar inventario' },
    ],
  },
  {
    area: 'Reportes',
    items: [
      { key: 'reports', label: 'Ver reportes y estadísticas' },
      { key: 'expenses', label: 'Registrar gastos' },
    ],
  },
  {
    area: 'Administración',
    items: [
      { key: 'settings', label: 'Configuración' },
      { key: 'manage_operators', label: 'Gestionar operarios' },
    ],
  },
]

export function permissionsMatch(a: Permissions, b: Permissions): boolean {
  return (Object.keys(a) as (keyof Permissions)[]).every(key => a[key] === b[key])
}

export function presetForPermissions(p: Permissions): RolePreset | 'custom' {
  if (permissionsMatch(p, ROLE_DEFAULTS.manager)) return 'manager'
  if (permissionsMatch(p, ROLE_DEFAULTS.cashier)) return 'cashier'
  return 'custom'
}

/**
 * Aplica un toggle respetando las dependencias lógicas: editar inventario implica verlo
 * (la ruta /inventory se gatea por inventory_read), y gestionar operarios implica acceso a
 * configuración (/settings se gatea por settings). Sin esto un operario podría quedar con
 * un permiso inalcanzable.
 */
export function applyPermissionToggle(prev: Permissions, key: keyof Permissions): Permissions {
  const next: Permissions = { ...prev, [key]: !prev[key] }
  if (key === 'inventory_read' && !next.inventory_read) next.inventory_write = false
  if (key === 'inventory_write' && next.inventory_write) next.inventory_read = true
  if (key === 'settings' && !next.settings) next.manage_operators = false
  if (key === 'manage_operators' && next.manage_operators) next.settings = true
  return next
}

function ToggleSwitch({ checked, disabled = false, onToggle, label }: {
  checked: boolean
  disabled?: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
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
  )
}

export function PermissionsFields({ permissions, onToggle, disabled = false, defaultExpanded = false }: {
  permissions: Permissions
  onToggle: (key: keyof Permissions) => void
  disabled?: boolean
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-sm font-medium text-body transition-colors hover:text-heading"
      >
        Ver permisos individuales
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="rounded-lg border border-edge divide-y divide-edge">
          {PERMISSION_AREAS.map(({ area, items }) => (
            <div key={area}>
              <p className="bg-hover-bg/40 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">{area}</p>
              {items.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="text-sm text-body">{label}</span>
                  <ToggleSwitch
                    checked={permissions[key]}
                    disabled={disabled}
                    onToggle={() => onToggle(key)}
                    label={label}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
