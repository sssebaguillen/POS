'use client'

import { Trash2 } from 'lucide-react'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_LABELS, isPaymentMethod } from '@/lib/payments'
import { cn } from '@/lib/utils'
import type { ActivityLogRow } from '@/components/activity/types'

export interface ActivityLookups {
  categoryMap: Record<string, { name: string; icon: string | null; icon_color: string | null }>
  brandMap: Record<string, string>
  productMap: Record<string, string>
}

interface Props {
  row: ActivityLogRow
  lookups: ActivityLookups
}

interface SaleData {
  total?: number | string
  subtotal?: number | string
  status?: string
  customer_id?: string | null
  items?: SaleItem[]
  payments?: SalePayment[]
  // legacy create_sale payload shape (pre-2026-05-15_12)
  payment_methods?: string[]
  item_count?: number
}

interface SaleItem {
  product_id?: string | null
  variant_id?: string | null
  quantity?: number | string
  unit_price?: number | string
  total?: number | string
}

interface SalePayment {
  method?: string
  amount?: number | string
}

interface ProductData {
  name?: string
  price?: number | string
  cost?: number | string
  stock?: number | string
  min_stock?: number | string | null
  is_active?: boolean
  category_id?: string | null
  brand_id?: string | null
}

interface CategoryData {
  name?: string
  icon?: string | null
  icon_color?: string | null
}

interface BrandData {
  name?: string
}

interface BulkData {
  product_ids?: string[]
  count?: number
  is_active?: boolean
  category_id?: string | null
  brand_id?: string | null
}

const PRODUCT_FIELD_LABELS: Record<string, string> = {
  name:        'Nombre',
  price:       'Precio',
  cost:        'Costo',
  stock:       'Stock',
  min_stock:   'Stock mínimo',
  is_active:   'Estado',
  category_id: 'Categoría',
  brand_id:    'Marca',
}

const PRODUCT_FIELD_ORDER = ['name', 'price', 'cost', 'stock', 'min_stock', 'is_active', 'category_id', 'brand_id']

const CATEGORY_FIELD_LABELS: Record<string, string> = {
  name:       'Nombre',
  icon:       'Ícono',
  icon_color: 'Color',
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ActivityDetail({ row, lookups }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 pb-2 border-b border-edge/40">
        <p className="text-xs text-hint">
          <span className="text-body font-medium">{row.actor_name}</span>
          <span className="mx-1.5">·</span>
          {formatFullTimestamp(row.created_at)}
        </p>
      </div>
      <ActivityBody row={row} lookups={lookups} />
    </div>
  )
}

function ActivityBody({ row, lookups }: Props) {
  switch (row.action) {
    case 'sale_created':
      return <SaleSummary data={row.new_data as SaleData | null} lookups={lookups} />
    case 'sale_deleted':
      return <SaleSummary data={row.old_data as SaleData | null} lookups={lookups} deleted />
    case 'sale_updated':
      return <SaleDiff oldData={row.old_data as SaleData | null} newData={row.new_data as SaleData | null} lookups={lookups} />

    case 'product_created':
      return <ProductSummary data={row.new_data as ProductData | null} lookups={lookups} />
    case 'product_deleted':
      return <ProductSummary data={row.old_data as ProductData | null} lookups={lookups} deleted />
    case 'product_updated':
      return <ProductDiff oldData={row.old_data as ProductData | null} newData={row.new_data as ProductData | null} lookups={lookups} />

    case 'product_bulk_deleted':
      return <BulkProductDeleted data={row.old_data as BulkData | null} />
    case 'product_bulk_status':
      return <BulkProductStatus oldData={row.old_data as BulkData | null} newData={row.new_data as BulkData | null} />
    case 'product_bulk_category':
      return <BulkProductCategory oldData={row.old_data as BulkData | null} newData={row.new_data as BulkData | null} lookups={lookups} />
    case 'product_bulk_brand':
      return <BulkProductBrand oldData={row.old_data as BulkData | null} newData={row.new_data as BulkData | null} lookups={lookups} />

    case 'category_created':
      return <CategorySummary data={row.new_data as CategoryData | null} />
    case 'category_deleted':
      return <CategorySummary data={row.old_data as CategoryData | null} deleted />
    case 'category_updated':
      return <CategoryDiff oldData={row.old_data as CategoryData | null} newData={row.new_data as CategoryData | null} />

    case 'brand_created':
      return <BrandSummary data={row.new_data as BrandData | null} />
    case 'brand_deleted':
      return <BrandSummary data={row.old_data as BrandData | null} deleted />
    case 'brand_updated':
      return <BrandDiff oldData={row.old_data as BrandData | null} newData={row.new_data as BrandData | null} />

    default:
      return <p className="text-sm text-hint">Sin datos adicionales.</p>
  }
}

// =============================================================================
// Sale panels
// =============================================================================

function SaleSummary({ data, lookups, deleted = false }: { data: SaleData | null; lookups: ActivityLookups; deleted?: boolean }) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const items = Array.isArray(data.items) ? data.items : []
  const payments = Array.isArray(data.payments) ? data.payments : []
  const legacyMethods = !payments.length && Array.isArray(data.payment_methods) ? data.payment_methods : null
  const total = toNumber(data.total)
  const customerId = typeof data.customer_id === 'string' ? data.customer_id : null

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <Trash2 size={12} />
          Eliminada
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Stat label="Total" value={formatMoney(total)} emphasis />
        <Stat label="Cliente" value={customerId ? `Cliente #${customerId.slice(0, 8)}` : 'Sin cliente'} />
      </div>

      {(payments.length > 0 || legacyMethods) && (
        <div>
          <p className="text-label text-hint mb-1.5">Métodos de pago</p>
          <div className="flex flex-wrap gap-1.5">
            {payments.length > 0
              ? payments.map((p, i) => (
                  <PaymentBadge key={i} method={p.method} amount={toNumber(p.amount)} />
                ))
              : legacyMethods!.map((m, i) => <PaymentBadge key={i} method={m} />)}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Items ({items.length})</p>
          <div className="rounded-lg border border-edge/60 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {items.map((item, i) => {
                  const productName = item.product_id ? lookups.productMap[item.product_id] : null
                  const qty = toNumber(item.quantity)
                  const unit = toNumber(item.unit_price)
                  const lineTotal = toNumber(item.total)
                  return (
                    <tr key={i} className="border-b border-edge/40 last:border-0">
                      <td className="px-3 py-2 align-middle">
                        {productName ? (
                          <span className="text-body">{productName}</span>
                        ) : (
                          <span className="text-hint italic">Producto eliminado</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle text-right text-hint tabular-nums">
                        {qty} × {formatMoney(unit)}
                      </td>
                      <td className="px-3 py-2 align-middle text-right text-body font-medium tabular-nums w-28">
                        {formatMoney(lineTotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.item_count !== undefined && items.length === 0 && (
        <p className="text-sm text-hint">{data.item_count} item(s) — sin detalle disponible (registro antiguo).</p>
      )}
    </div>
  )
}

function SaleDiff({ oldData, newData, lookups }: { oldData: SaleData | null; newData: SaleData | null; lookups: ActivityLookups }) {
  const formatMoney = useFormatMoney()
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const changes: { label: string; before: string; after: string }[] = []

  const oldTotal = toNumber(oldData.total)
  const newTotal = toNumber(newData.total)
  if (oldTotal !== newTotal) {
    changes.push({ label: 'Total', before: formatMoney(oldTotal), after: formatMoney(newTotal) })
  }

  if (oldData.status !== newData.status && oldData.status && newData.status) {
    changes.push({ label: 'Estado', before: oldData.status, after: newData.status })
  }

  const oldMethod = oldData.payments?.[0]?.method
  const newMethod = newData.payments?.[0]?.method
  if (oldMethod && newMethod && oldMethod !== newMethod) {
    changes.push({
      label: 'Método de pago',
      before: isPaymentMethod(oldMethod) ? PAYMENT_LABELS[oldMethod] : oldMethod,
      after:  isPaymentMethod(newMethod) ? PAYMENT_LABELS[newMethod] : newMethod,
    })
  }

  const itemDiff = computeItemDiff(oldData.items ?? [], newData.items ?? [], lookups)

  return (
    <div className="space-y-3">
      {changes.length > 0 && (
        <div className="space-y-1.5">
          {changes.map((c, i) => (
            <DiffRow key={i} label={c.label} before={c.before} after={c.after} />
          ))}
        </div>
      )}

      {(itemDiff.added.length > 0 || itemDiff.removed.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {itemDiff.removed.length > 0 && (
            <div>
              <p className="text-label text-hint mb-1.5">Items quitados</p>
              <ItemList items={itemDiff.removed} tone="removed" />
            </div>
          )}
          {itemDiff.added.length > 0 && (
            <div>
              <p className="text-label text-hint mb-1.5">Items agregados</p>
              <ItemList items={itemDiff.added} tone="added" />
            </div>
          )}
        </div>
      )}

      {changes.length === 0 && itemDiff.added.length === 0 && itemDiff.removed.length === 0 && (
        <p className="text-sm text-hint">Sin cambios visibles.</p>
      )}
    </div>
  )
}

interface DiffItem {
  productName: string
  quantity: number
  unitPrice: number
}

function computeItemDiff(oldItems: SaleItem[], newItems: SaleItem[], lookups: ActivityLookups) {
  function key(i: SaleItem): string {
    return `${i.product_id ?? 'null'}|${i.variant_id ?? 'null'}|${toNumber(i.unit_price)}`
  }
  const oldQty: Record<string, { item: SaleItem; qty: number }> = {}
  const newQty: Record<string, { item: SaleItem; qty: number }> = {}
  for (const i of oldItems) {
    const k = key(i)
    oldQty[k] = { item: i, qty: (oldQty[k]?.qty ?? 0) + toNumber(i.quantity) }
  }
  for (const i of newItems) {
    const k = key(i)
    newQty[k] = { item: i, qty: (newQty[k]?.qty ?? 0) + toNumber(i.quantity) }
  }
  const added: DiffItem[] = []
  const removed: DiffItem[] = []
  const allKeys = new Set([...Object.keys(oldQty), ...Object.keys(newQty)])
  for (const k of allKeys) {
    const oQ = oldQty[k]?.qty ?? 0
    const nQ = newQty[k]?.qty ?? 0
    const item = newQty[k]?.item ?? oldQty[k]?.item
    if (!item) continue
    const productName = item.product_id ? lookups.productMap[item.product_id] ?? 'Producto eliminado' : 'Producto eliminado'
    const unitPrice = toNumber(item.unit_price)
    const delta = nQ - oQ
    if (delta > 0) added.push({ productName, quantity: delta, unitPrice })
    else if (delta < 0) removed.push({ productName, quantity: -delta, unitPrice })
  }
  return { added, removed }
}

function ItemList({ items, tone }: { items: DiffItem[]; tone: 'added' | 'removed' }) {
  const formatMoney = useFormatMoney()
  return (
    <ul className={cn(
      'rounded-lg border overflow-hidden divide-y',
      tone === 'added'   ? 'border-emerald-200 divide-emerald-100 dark:border-emerald-500/30 dark:divide-emerald-500/20' : '',
      tone === 'removed' ? 'border-red-200 divide-red-100 dark:border-red-500/30 dark:divide-red-500/20' : '',
    )}>
      {items.map((it, i) => (
        <li key={i} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
          <span className="text-body">{it.productName}</span>
          <span className="text-hint tabular-nums">
            {it.quantity} × {formatMoney(it.unitPrice)}
          </span>
        </li>
      ))}
    </ul>
  )
}

// =============================================================================
// Product panels
// =============================================================================

function ProductSummary({ data, lookups, deleted = false }: { data: ProductData | null; lookups: ActivityLookups; deleted?: boolean }) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const categoryName = data.category_id ? lookups.categoryMap[data.category_id]?.name ?? null : null
  const brandName = data.brand_id ? lookups.brandMap[data.brand_id] ?? null : null

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <Trash2 size={12} />
          Eliminado
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={String(data.name)} />}
        {data.price !== undefined && <Stat label="Precio" value={formatMoney(toNumber(data.price))} />}
        {data.cost !== undefined && <Stat label="Costo" value={formatMoney(toNumber(data.cost))} />}
        {data.stock !== undefined && <Stat label="Stock" value={String(toNumber(data.stock))} />}
        {categoryName !== null && <Stat label="Categoría" value={categoryName} />}
        {brandName !== null && <Stat label="Marca" value={brandName} />}
      </div>
    </div>
  )
}

function ProductDiff({ oldData, newData, lookups }: { oldData: ProductData | null; newData: ProductData | null; lookups: ActivityLookups }) {
  const formatMoney = useFormatMoney()
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const oldObj = oldData as unknown as Record<string, unknown>
  const newObj = newData as unknown as Record<string, unknown>

  const changes: { label: string; before: string; after: string }[] = []

  for (const key of PRODUCT_FIELD_ORDER) {
    if (!(key in newObj)) continue
    if (!Object.prototype.hasOwnProperty.call(newObj, key)) continue
    const before = oldObj[key]
    const after = newObj[key]
    if (before === after) continue
    if (before === undefined && after === undefined) continue

    const fmt = formatProductField(key, before, after, lookups, formatMoney)
    if (fmt) changes.push({ label: PRODUCT_FIELD_LABELS[key], before: fmt.before, after: fmt.after })
  }

  if (changes.length === 0) {
    return <p className="text-sm text-hint">Sin cambios visibles.</p>
  }

  return (
    <div className="space-y-1.5">
      {changes.map((c, i) => (
        <DiffRow key={i} label={c.label} before={c.before} after={c.after} />
      ))}
    </div>
  )
}

function formatProductField(
  key: string,
  before: unknown,
  after: unknown,
  lookups: ActivityLookups,
  formatMoney: (n: number) => string,
): { before: string; after: string } | null {
  if (key === 'is_active') {
    return {
      before: before === true ? 'Activo' : before === false ? 'Inactivo' : '—',
      after:  after  === true ? 'Activo' : after  === false ? 'Inactivo' : '—',
    }
  }
  if (key === 'price' || key === 'cost') {
    return { before: before == null ? '—' : formatMoney(toNumber(before)), after: after == null ? '—' : formatMoney(toNumber(after)) }
  }
  if (key === 'stock' || key === 'min_stock') {
    return { before: before == null ? '—' : String(toNumber(before)), after: after == null ? '—' : String(toNumber(after)) }
  }
  if (key === 'category_id') {
    return {
      before: typeof before === 'string' ? lookups.categoryMap[before]?.name ?? 'Sin categoría' : 'Sin categoría',
      after:  typeof after  === 'string' ? lookups.categoryMap[after]?.name  ?? 'Sin categoría' : 'Sin categoría',
    }
  }
  if (key === 'brand_id') {
    return {
      before: typeof before === 'string' ? lookups.brandMap[before] ?? 'Sin marca' : 'Sin marca',
      after:  typeof after  === 'string' ? lookups.brandMap[after]  ?? 'Sin marca' : 'Sin marca',
    }
  }
  // name
  return { before: String(before ?? '—'), after: String(after ?? '—') }
}

// =============================================================================
// Bulk product panels
// =============================================================================

function BulkProductDeleted({ data }: { data: BulkData | null }) {
  const count = data?.count ?? data?.product_ids?.length ?? 0
  const ids = data?.product_ids ?? []
  return (
    <div className="space-y-2">
      <p className="text-body">
        <span className="font-semibold text-heading">{count}</span>{' '}
        {count === 1 ? 'producto eliminado' : 'productos eliminados'}
      </p>
      {ids.length > 0 && (
        <details className="text-xs text-hint">
          <summary className="cursor-pointer select-none hover:text-body">Ver IDs</summary>
          <ul className="mt-1.5 space-y-0.5 font-mono">
            {ids.map(id => <li key={id}>#{id.slice(0, 8)}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

function BulkProductStatus({ oldData, newData }: { oldData: BulkData | null; newData: BulkData | null }) {
  const count = oldData?.count ?? oldData?.product_ids?.length ?? 0
  const isActive = newData?.is_active === true
  return (
    <p className="text-body">
      <span className="font-semibold text-heading">{count}</span>{' '}
      {count === 1 ? 'producto marcado como' : 'productos marcados como'}{' '}
      <span className="font-semibold text-heading">{isActive ? 'Activo' : 'Inactivo'}</span>
    </p>
  )
}

function BulkProductCategory({ oldData, newData, lookups }: { oldData: BulkData | null; newData: BulkData | null; lookups: ActivityLookups }) {
  const count = oldData?.count ?? oldData?.product_ids?.length ?? 0
  const categoryName = newData?.category_id ? lookups.categoryMap[newData.category_id]?.name ?? 'Sin categoría' : 'Sin categoría'
  return (
    <p className="text-body">
      <span className="font-semibold text-heading">{count}</span>{' '}
      {count === 1 ? 'producto movido a' : 'productos movidos a'}{' '}
      <span className="font-semibold text-heading">{categoryName}</span>
    </p>
  )
}

function BulkProductBrand({ oldData, newData, lookups }: { oldData: BulkData | null; newData: BulkData | null; lookups: ActivityLookups }) {
  const count = oldData?.count ?? oldData?.product_ids?.length ?? 0
  const brandName = newData?.brand_id ? lookups.brandMap[newData.brand_id] ?? 'Sin marca' : 'Sin marca'
  return (
    <p className="text-body">
      <span className="font-semibold text-heading">{count}</span>{' '}
      {count === 1 ? 'producto asignado a' : 'productos asignados a'}{' '}
      <span className="font-semibold text-heading">{brandName}</span>
    </p>
  )
}

// =============================================================================
// Category panels
// =============================================================================

function CategorySummary({ data, deleted = false }: { data: CategoryData | null; deleted?: boolean }) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>
  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <Trash2 size={12} />
          Eliminada
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={String(data.name)} />}
        {data.icon && (
          <div>
            <p className="text-label text-hint mb-0.5">Ícono</p>
            <p className="text-base text-body">{data.icon}</p>
          </div>
        )}
        {data.icon_color && (
          <div>
            <p className="text-label text-hint mb-0.5">Color</p>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-md border border-edge/60" style={{ backgroundColor: data.icon_color }} />
              <span className="text-sm text-body font-mono">{data.icon_color}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryDiff({ oldData, newData }: { oldData: CategoryData | null; newData: CategoryData | null }) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const changes: { label: string; before: React.ReactNode; after: React.ReactNode }[] = []

  for (const key of Object.keys(CATEGORY_FIELD_LABELS) as (keyof CategoryData)[]) {
    const before = oldData[key]
    const after = newData[key]
    if (before === after) continue
    if (before == null && after == null) continue

    if (key === 'icon_color') {
      changes.push({
        label: CATEGORY_FIELD_LABELS[key],
        before: <ColorSwatch value={before as string | null | undefined} />,
        after:  <ColorSwatch value={after  as string | null | undefined} />,
      })
    } else {
      changes.push({
        label: CATEGORY_FIELD_LABELS[key],
        before: <span>{(before as string | null | undefined) ?? '—'}</span>,
        after:  <span>{(after  as string | null | undefined) ?? '—'}</span>,
      })
    }
  }

  if (changes.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>

  return (
    <div className="space-y-1.5">
      {changes.map((c, i) => (
        <DiffRow key={i} label={c.label} before={c.before} after={c.after} />
      ))}
    </div>
  )
}

function ColorSwatch({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-hint">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded-md border border-edge/60" style={{ backgroundColor: value }} />
      <span className="font-mono text-xs">{value}</span>
    </span>
  )
}

// =============================================================================
// Brand panels
// =============================================================================

function BrandSummary({ data, deleted = false }: { data: BrandData | null; deleted?: boolean }) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>
  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <Trash2 size={12} />
          Eliminada
        </div>
      )}
      {data.name && <Stat label="Nombre" value={String(data.name)} />}
    </div>
  )
}

function BrandDiff({ oldData, newData }: { oldData: BrandData | null; newData: BrandData | null }) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>
  if (oldData.name === newData.name) return <p className="text-sm text-hint">Sin cambios visibles.</p>
  return (
    <DiffRow label="Nombre" before={oldData.name ?? '—'} after={newData.name ?? '—'} />
  )
}

// =============================================================================
// Primitives
// =============================================================================

function Stat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-label text-hint mb-0.5">{label}</p>
      <p className={cn('text-body', emphasis && 'text-lg font-bold text-heading font-display')}>{value}</p>
    </div>
  )
}

function DiffRow({ label, before, after }: { label: string; before: React.ReactNode; after: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-label text-hint min-w-[120px]">{label}</span>
      <span className="text-body line-through opacity-70">{before}</span>
      <span className="text-hint">→</span>
      <span className="text-heading font-medium">{after}</span>
    </div>
  )
}

function PaymentBadge({ method, amount }: { method: string | undefined; amount?: number }) {
  const formatMoney = useFormatMoney()
  const label = method && isPaymentMethod(method) ? PAYMENT_LABELS[method] : method ?? '—'
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30">
      {label}
      {amount !== undefined && (
        <span className="text-hint">· {formatMoney(amount)}</span>
      )}
    </span>
  )
}
