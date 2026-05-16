'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight, ChevronLeft, Inbox } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import SelectDropdown from '@/components/ui/SelectDropdown'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import { periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_LABELS, isPaymentMethod } from '@/lib/payments'
import { cn } from '@/lib/utils'
import type {
  ActivityActionTone,
  ActivityEntityFilter,
  ActivityFilterOperator,
  ActivityLogRow,
} from '@/components/activity/types'
import ActivityDetail, { type ActivityLookups } from '@/components/activity/ActivityDetail'

interface Props {
  rows: ActivityLogRow[]
  total: number
  page: number
  pageSize: number
  operators: ActivityFilterOperator[]
  entity: ActivityEntityFilter
  operatorFilter: string | null
  period: string
  from: string | undefined
  to: string | undefined
  categoryMap: ActivityLookups['categoryMap']
  brandMap: ActivityLookups['brandMap']
  productMap: ActivityLookups['productMap']
}

// Entity options have grown to 9 (8 entity types + "Todas") with Phase 2.
// At that count chips wrap awkwardly and the longest label ("Listas de
// precios") dominates the row, so we render entity as a dropdown instead —
// it sits next to the operator dropdown for a clean two-control filter bar.
const ENTITY_OPTIONS: { value: ActivityEntityFilter; label: string }[] = [
  { value: 'all',        label: 'Todas las entidades' },
  { value: 'sale',       label: 'Ventas' },
  { value: 'product',    label: 'Productos' },
  { value: 'category',   label: 'Categorías' },
  { value: 'brand',      label: 'Marcas' },
  { value: 'expense',    label: 'Gastos' },
  { value: 'supplier',   label: 'Proveedores' },
  { value: 'price_list', label: 'Listas de precios' },
  { value: 'setting',    label: 'Configuración' },
  { value: 'operator',   label: 'Operarios' },
]

const ENTITY_TYPE_LABELS: Record<ActivityLogRow['entity_type'], string> = {
  sale:       'Venta',
  product:    'Producto',
  category:   'Categoría',
  brand:      'Marca',
  expense:    'Gasto',
  supplier:   'Proveedor',
  price_list: 'Lista de precios',
  setting:    'Configuración',
  operator:   'Operario',
}

const ACTION_LABELS: Record<string, string> = {
  sale_created:               'Venta creada',
  sale_updated:               'Venta editada',
  sale_deleted:               'Venta eliminada',
  product_created:            'Producto creado',
  product_updated:            'Producto editado',
  product_deleted:            'Producto eliminado',
  product_bulk_deleted:       'Productos eliminados (masivo)',
  product_bulk_status:        'Estado de productos (masivo)',
  product_bulk_category:      'Categoría de productos (masivo)',
  product_bulk_brand:         'Marca de productos (masivo)',
  category_created:           'Categoría creada',
  category_updated:           'Categoría editada',
  category_deleted:           'Categoría eliminada',
  brand_created:              'Marca creada',
  brand_updated:              'Marca editada',
  brand_deleted:              'Marca eliminada',
  expense_created:            'Gasto creado',
  expense_updated:            'Gasto editado',
  expense_deleted:            'Gasto eliminado',
  supplier_created:           'Proveedor creado',
  supplier_updated:           'Proveedor editado',
  supplier_deactivated:       'Proveedor desactivado',
  price_list_created:         'Lista creada',
  price_list_updated:         'Lista editada',
  price_list_deleted:         'Lista eliminada',
  price_list_default_changed: 'Lista predeterminada cambiada',
  settings_updated:           'Configuración editada',
  settings_slug_updated:      'URL del catálogo cambiada',
  operator_created:           'Operario creado',
  operator_updated:           'Operario editado',
  operator_deleted:           'Operario eliminado',
}

const TONE_CLASSES: Record<ActivityActionTone, string> = {
  created: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  updated: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  deleted: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  bulk:    'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
}

function getActionTone(action: string): ActivityActionTone {
  if (action.includes('bulk')) return 'bulk'
  if (action.endsWith('_created')) return 'created'
  if (action.endsWith('_updated')) return 'updated'
  if (action.endsWith('_deleted')) return 'deleted'
  return 'updated'
}

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)

  if (diffSec < 5) return 'ahora'
  if (diffSec < 60) return `hace ${diffSec} s`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const diffD = Math.round(diffH / 24)
  if (diffD < 7) return `hace ${diffD} d`
  const diffW = Math.round(diffD / 7)
  if (diffW < 5) return `hace ${diffW} sem`
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function ActivityView({
  rows,
  total,
  page,
  pageSize,
  operators,
  entity,
  operatorFilter,
  period,
  from,
  to,
  categoryMap,
  brandMap,
  productMap,
}: Props) {
  const lookups: ActivityLookups = { categoryMap, brandMap, productMap }
  const router = useRouter()
  const pathname = usePathname()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  // Optimistic filter state — chip clicks update local state instantly so the
  // active chip / pill animates without waiting for the Server Component
  // refetch. The URL push happens inside startTransition; `isPending` drives
  // the subtle fade on the results table while data is in flight.
  const [entityLocal, setEntityLocal] = useState<ActivityEntityFilter>(entity)
  const [operatorLocal, setOperatorLocal] = useState<string | null>(operatorFilter)
  const [periodLocal, setPeriodLocal] = useState<DateRangePeriod>(period as DateRangePeriod)
  const [fromLocal, setFromLocal] = useState<string | undefined>(from)
  const [toLocal, setToLocal] = useState<string | undefined>(to)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const operatorValue = operatorLocal ?? 'all'

  const operatorOptions = useMemo(() => {
    const base = [
      { value: 'all',   label: 'Todos los operadores' },
      { value: 'owner', label: 'Dueño' },
    ]
    return [
      ...base,
      ...operators.map(o => ({ value: o.id, label: o.name })),
    ]
  }, [operators])

  interface NavigateInput {
    entity?: ActivityEntityFilter
    operator?: string | null
    period?: DateRangePeriod
    from?: string
    to?: string
    page?: number
  }

  function navigate(next: NavigateInput) {
    const finalEntity = next.entity ?? entityLocal
    const finalOperator = next.operator !== undefined ? next.operator : operatorLocal
    const finalPeriod = next.period ?? periodLocal
    const finalFrom = next.from !== undefined ? next.from : fromLocal
    const finalTo = next.to !== undefined ? next.to : toLocal
    const finalPage = next.page ?? 1

    // 1. Optimistic local state — chips/pills flip immediately.
    setEntityLocal(finalEntity)
    setOperatorLocal(finalOperator)
    setPeriodLocal(finalPeriod)
    setFromLocal(finalFrom || undefined)
    setToLocal(finalTo || undefined)

    // 2. URL push (drives the Server Component refetch); wrapped in
    //    startTransition so React reports `isPending` while the new RSC
    //    payload is in flight.
    const params = new URLSearchParams()
    if (finalEntity !== 'all') params.set('entity', finalEntity)
    if (finalOperator && finalOperator !== 'all') params.set('operator', finalOperator)
    if (finalPeriod && finalPeriod !== 'mes') params.set('period', finalPeriod)
    if (periodNeedsCustomDates(finalPeriod) && finalFrom && finalTo) {
      params.set('from', finalFrom)
      params.set('to', finalTo)
    }
    if (finalPage > 1) params.set('page', String(finalPage))

    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function handleDateChange(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    navigate({
      period: newPeriod,
      from: newFrom ?? '',
      to: newTo ?? '',
      page: 1,
    })
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isEmpty = rows.length === 0

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Actividad" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          {/* Row 1: Date range (pill tabs — reserved for date filter) */}
          <DateRangeFilter
            value={periodLocal}
            from={fromLocal}
            to={toLocal}
            onChange={handleDateChange}
          />

          {/* Row 2: Entity dropdown + actor dropdown */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[220px]">
              <SelectDropdown
                value={entityLocal}
                onChange={(v) => navigate({ entity: v as ActivityEntityFilter, page: 1 })}
                options={ENTITY_OPTIONS}
                usePortal
              />
            </div>

            <div className="min-w-[200px] ml-auto">
              <SelectDropdown
                value={operatorValue}
                onChange={(v) => navigate({ operator: v === 'all' ? null : v, page: 1 })}
                options={operatorOptions}
                usePortal
              />
            </div>
          </div>

          {/* Table */}
          <div
            className={cn(
              'surface-card overflow-hidden transition-opacity duration-150',
              isPending && 'opacity-60 pointer-events-none',
            )}
          >
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
                <Inbox size={36} className="text-hint" />
                <p className="text-heading font-semibold">Sin actividad registrada</p>
                <p className="text-sm text-body max-w-sm">
                  Cuando se modifiquen ventas, productos, gastos, proveedores, listas de precios, configuración u operarios, vas a verlas acá.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-edge/60 text-left text-hint">
                  <tr>
                    <th className="px-4 py-3 w-8"></th>
                    <th className="px-4 py-3 w-32">Fecha</th>
                    <th className="px-4 py-3">Acción</th>
                    <th className="px-4 py-3">Entidad</th>
                    <th className="px-4 py-3 w-40">Operador</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const isOpen = expanded.has(row.id)
                    const tone = getActionTone(row.action)
                    return (
                      <ActivityRow
                        key={row.id}
                        row={row}
                        isOpen={isOpen}
                        tone={tone}
                        lookups={lookups}
                        onToggle={() => toggleExpand(row.id)}
                      />
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {!isEmpty && total > pageSize && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-hint">
                Página {page} de {totalPages} · {total.toLocaleString('es-AR')} eventos
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => navigate({ page: page - 1 })}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-border bg-surface hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Página anterior"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => navigate({ page: page + 1 })}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-border bg-surface hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Página siguiente"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface RowProps {
  row: ActivityLogRow
  isOpen: boolean
  tone: ActivityActionTone
  lookups: ActivityLookups
  onToggle: () => void
}

function ActivityRow({ row, isOpen, tone, lookups, onToggle }: RowProps) {
  return (
    <>
      <tr
        className="border-b border-edge/40 hover:bg-hover-bg/40 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3 align-middle">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            className="p-0.5 rounded hover:bg-hover-bg text-hint"
            aria-label={isOpen ? 'Cerrar detalle' : 'Abrir detalle'}
          >
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td className="px-4 py-3 align-middle">
          <span title={formatFullTimestamp(row.created_at)} className="text-body cursor-default">
            {formatRelativeTime(row.created_at)}
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', TONE_CLASSES[tone])}>
            {getActionLabel(row.action)}
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <span className="text-hint">{ENTITY_TYPE_LABELS[row.entity_type]}</span>
          {row.entity_label && (
            <>
              <span className="text-hint mx-1.5">·</span>
              <span className="text-heading font-medium">{row.entity_label}</span>
            </>
          )}
          {row.entity_type === 'sale' && <SaleSummaryInline row={row} />}
        </td>
        <td className="px-4 py-3 align-middle text-body">{row.actor_name}</td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-alt/40 border-b border-edge/40">
          <td colSpan={5} className="px-4 py-4">
            <ActivityDetail row={row} lookups={lookups} />
          </td>
        </tr>
      )}
    </>
  )
}

interface SaleSummaryData {
  total?: number | string
  customer_id?: string | null
  items?: unknown[]
  item_count?: number
  payments?: { method?: string }[]
}

function toNumber(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function getItemCount(d: SaleSummaryData | null | undefined): number | null {
  if (!d) return null
  if (Array.isArray(d.items)) return d.items.length
  if (typeof d.item_count === 'number') return d.item_count
  return null
}

function getFirstPaymentLabel(d: SaleSummaryData | null | undefined): string | null {
  const method = d?.payments?.[0]?.method
  if (!method) return null
  return isPaymentMethod(method) ? PAYMENT_LABELS[method] : method
}

function SaleSummaryInline({ row }: { row: ActivityLogRow }) {
  const formatMoney = useFormatMoney()
  const oldData = row.old_data as SaleSummaryData | null
  const newData = row.new_data as SaleSummaryData | null
  const pieces: string[] = []

  if (row.action === 'sale_updated') {
    const oldTotal = toNumber(oldData?.total)
    const newTotal = toNumber(newData?.total)
    if (oldTotal !== null && newTotal !== null && oldTotal !== newTotal) {
      pieces.push(`${formatMoney(oldTotal)} → ${formatMoney(newTotal)}`)
    } else if (newTotal !== null) {
      pieces.push(formatMoney(newTotal))
    } else if (oldTotal !== null) {
      pieces.push(formatMoney(oldTotal))
    }

    const oldPay = getFirstPaymentLabel(oldData)
    const newPay = getFirstPaymentLabel(newData)
    if (newPay && newPay !== oldPay) pieces.push(newPay)

    const oldCount = getItemCount(oldData)
    const newCount = getItemCount(newData)
    if (newCount !== null && newCount !== oldCount) {
      pieces.push(`${newCount} ${newCount === 1 ? 'item' : 'items'}`)
    }
  } else {
    const data = row.action === 'sale_deleted' ? oldData : newData
    const total = toNumber(data?.total)
    if (total !== null) pieces.push(formatMoney(total))

    const pay = getFirstPaymentLabel(data)
    if (pay) pieces.push(pay)

    const count = getItemCount(data)
    if (count !== null) pieces.push(`${count} ${count === 1 ? 'item' : 'items'}`)

    if (data?.customer_id) pieces.push('Cliente asignado')
  }

  if (pieces.length === 0) return null

  return (
    <>
      <span className="text-hint mx-1.5">·</span>
      <span className="text-heading font-medium">{pieces.join(' · ')}</span>
    </>
  )
}
