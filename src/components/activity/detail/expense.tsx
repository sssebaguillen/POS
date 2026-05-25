'use client'

import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@/components/expenses/types'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type { ExpenseData, SupplierData } from '@/components/activity/payloads'
import { DeletedBadge, DiffRow, Stat, toNumber } from '@/components/activity/detail/shared'

const SUPPLIER_FIELD_LABELS: Record<keyof SupplierData, string> = {
  name: 'Nombre',
  contact_name: 'Contacto',
  phone: 'Teléfono',
  email: 'Email',
  address: 'Dirección',
  notes: 'Notas',
  is_active: 'Activo',
}

interface ExpenseSummaryProps {
  data: ExpenseData | null
  deleted?: boolean
}

export function ExpenseSummary({ data, deleted = false }: ExpenseSummaryProps) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const category = typeof data.category === 'string'
    ? EXPENSE_CATEGORY_LABELS[data.category as ExpenseCategory] ?? data.category
    : '—'
  const items = Array.isArray(data.items) ? data.items : []

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && <DeletedBadge label="Eliminado" />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Categoría" value={category} />
        <Stat label="Monto" value={formatMoney(toNumber(data.amount))} emphasis />
        {data.date && <Stat label="Fecha" value={data.date} />}
        {data.description && <Stat label="Descripción" value={data.description} />}
      </div>

      {items.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Items ({items.length})</p>
          <div className="rounded-lg border border-edge/60 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {items.map((item, index) => (
                  <tr key={index} className="border-b border-edge/40 last:border-0">
                    <td className="px-3 py-2 align-middle text-body">
                      {item.product_name ?? <span className="text-hint italic">Sin nombre</span>}
                    </td>
                    <td className="px-3 py-2 align-middle text-right text-hint tabular-nums">
                      {toNumber(item.quantity)} × {formatMoney(toNumber(item.unit_cost))}
                    </td>
                    <td className="px-3 py-2 align-middle text-right text-body font-medium tabular-nums w-28">
                      {formatMoney(toNumber(item.quantity) * toNumber(item.unit_cost))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

interface ExpenseDiffProps {
  oldData: ExpenseData | null
  newData: ExpenseData | null
}

export function ExpenseDiff({ oldData, newData }: ExpenseDiffProps) {
  const formatMoney = useFormatMoney()
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []

  if (oldData.description !== newData.description) {
    rows.push({ label: 'Descripción', before: String(oldData.description ?? '—'), after: String(newData.description ?? '—') })
  }
  if (oldData.date !== newData.date) {
    rows.push({ label: 'Fecha', before: String(oldData.date ?? '—'), after: String(newData.date ?? '—') })
  }

  const oldAmount = toNumber(oldData.amount)
  const newAmount = toNumber(newData.amount)
  if (oldAmount !== newAmount) {
    rows.push({ label: 'Monto', before: formatMoney(oldAmount), after: formatMoney(newAmount) })
  }
  if (oldData.supplier_id !== newData.supplier_id) {
    rows.push({
      label: 'Proveedor',
      before: oldData.supplier_id ? `#${oldData.supplier_id.slice(0, 8)}` : '—',
      after: newData.supplier_id ? `#${newData.supplier_id.slice(0, 8)}` : '—',
    })
  }

  const oldItems = Array.isArray(oldData.items) ? oldData.items.length : 0
  const newItems = Array.isArray(newData.items) ? newData.items.length : 0
  if (oldItems !== newItems) {
    rows.push({ label: 'Items', before: String(oldItems), after: String(newItems) })
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>

  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <DiffRow key={index} label={row.label} before={row.before} after={row.after} />
      ))}
    </div>
  )
}

interface SupplierSummaryProps {
  data: SupplierData | null
  deactivated?: boolean
}

export function SupplierSummary({ data, deactivated = false }: SupplierSummaryProps) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  return (
    <div className={cn('space-y-3', deactivated && 'opacity-90')}>
      {deactivated && <DeletedBadge label="Desactivado" />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={data.name} />}
        {data.contact_name && <Stat label="Contacto" value={data.contact_name} />}
        {data.phone && <Stat label="Teléfono" value={data.phone} />}
        {data.email && <Stat label="Email" value={data.email} />}
        {data.address && <Stat label="Dirección" value={data.address} />}
      </div>
    </div>
  )
}

interface SupplierDiffProps {
  oldData: SupplierData | null
  newData: SupplierData | null
}

export function SupplierDiff({ oldData, newData }: SupplierDiffProps) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []
  for (const key of Object.keys(SUPPLIER_FIELD_LABELS) as (keyof SupplierData)[]) {
    if (!(key in newData)) continue
    const before = oldData[key]
    const after = newData[key]
    if (before === after) continue
    if (before == null && after == null) continue
    rows.push({
      label: SUPPLIER_FIELD_LABELS[key],
      before: before == null || before === '' ? '—' : String(before),
      after: after == null || after === '' ? '—' : String(after),
    })
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>

  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <DiffRow key={index} label={row.label} before={row.before} after={row.after} />
      ))}
    </div>
  )
}
