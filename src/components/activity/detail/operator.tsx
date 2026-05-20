'use client'

import { getPermissionLabel } from '@/lib/operator'
import { cn } from '@/lib/utils'
import type { OperatorData, OperatorUpdateData } from '@/components/activity/payloads'
import { DeletedBadge, DiffRow, Stat, getOperatorRoleLabel } from '@/components/activity/detail/shared'

interface OperatorSummaryProps {
  data: OperatorData | null
  deleted?: boolean
}

export function OperatorSummary({ data, deleted = false }: OperatorSummaryProps) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const permissions = data.permissions ?? {}
  const enabled = Object.entries(permissions)
    .filter(([, value]) => value === true)
    .map(([key]) => key)

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && <DeletedBadge label="Eliminado" />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={data.name} />}
        {data.role && <Stat label="Rol" value={getOperatorRoleLabel(data.role)} />}
      </div>
      {enabled.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Permisos habilitados</p>
          <div className="flex flex-wrap gap-1.5">
            {enabled.map(key => (
              <span key={key} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {getPermissionLabel(key)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface OperatorDiffProps {
  oldData: OperatorData | null
  newData: OperatorUpdateData | null
}

export function OperatorDiff({ oldData, newData }: OperatorDiffProps) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []
  if (oldData.name !== newData.name && newData.name != null) {
    rows.push({ label: 'Nombre', before: String(oldData.name ?? '—'), after: String(newData.name) })
  }
  if (oldData.role !== newData.role && newData.role != null) {
    rows.push({
      label: 'Rol',
      before: getOperatorRoleLabel(oldData.role),
      after: getOperatorRoleLabel(newData.role),
    })
  }

  const oldPermissions = oldData.permissions ?? {}
  const newPermissions = newData.permissions ?? {}
  const permissionChanges: { key: string; before: boolean; after: boolean }[] = []
  const allKeys = new Set([...Object.keys(oldPermissions), ...Object.keys(newPermissions)])
  for (const key of allKeys) {
    const before = oldPermissions[key] === true
    const after = newPermissions[key] === true
    if (before !== after) {
      permissionChanges.push({ key, before, after })
    }
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((row, index) => (
            <DiffRow key={index} label={row.label} before={row.before} after={row.after} />
          ))}
        </div>
      )}
      {newData.pin_changed && (
        <p className="text-sm text-body">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            PIN actualizado
          </span>
        </p>
      )}
      {permissionChanges.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Permisos modificados</p>
          <div className="space-y-1">
            {permissionChanges.map(change => (
              <DiffRow
                key={change.key}
                label={getPermissionLabel(change.key)}
                before={change.before ? 'Sí' : 'No'}
                after={change.after ? 'Sí' : 'No'}
              />
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 && permissionChanges.length === 0 && !newData.pin_changed && (
        <p className="text-sm text-hint">Sin cambios visibles.</p>
      )}
    </div>
  )
}
