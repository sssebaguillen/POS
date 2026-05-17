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
  customerMap: Record<string, string>
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

interface ExpenseLineItem {
  product_id?: string | null
  product_name?: string | null
  quantity?: number | string
  unit_cost?: number | string
  update_cost?: boolean
}

interface ExpenseData {
  category?: string | null
  amount?: number | string
  description?: string | null
  date?: string | null
  supplier_id?: string | null
  notes?: string | null
  items?: ExpenseLineItem[]
  item_count?: number
}

interface SupplierData {
  name?: string | null
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  is_active?: boolean
}

interface PriceListData {
  id?: string
  name?: string | null
  description?: string | null
  multiplier?: number | string
  is_default?: boolean
}

interface PriceListCreateData {
  list?: PriceListData | null
  overrides_count?: number
}

interface PriceListUpdateData {
  list?: PriceListData | null
  overrides_upserted?: unknown[]
  overrides_deleted?: unknown[]
}

interface SettingsData {
  name?: string | null
  description?: string | null
  whatsapp?: string | null
  logo_url?: string | null
  settings?: Record<string, unknown> | null
}

interface OperatorData {
  name?: string | null
  role?: string | null
  permissions?: Record<string, boolean> | null
  is_active?: boolean
}

interface OperatorUpdateData extends OperatorData {
  pin_changed?: boolean
}

interface CustomerData {
  name?: string | null
  phone?: string | null
  email?: string | null
  dni?: string | null
  credit_limit?: number | string | null
  credit_balance?: number | string | null
  is_credit_enabled?: boolean
  notes?: string | null
}

interface CustomerSettlementOld {
  credit_balance?: number | string | null
}

interface CustomerSettlementNew {
  credit_balance?: number | string | null
  amount?: number | string | null
  method?: string | null
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

const SETTINGS_FIELD_LABELS: Record<string, string> = {
  primary_color:     'Color principal',
  currency:          'Moneda',
  free_line_enabled: 'Producto libre',
}

function formatSettingsValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean' || key === 'free_line_enabled') {
    return value === true || value === 'true' ? 'Habilitado' : 'Deshabilitado'
  }
  return String(value)
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

    case 'expense_created':
      return <ExpenseSummary data={row.new_data as ExpenseData | null} />
    case 'expense_deleted':
      return <ExpenseSummary data={row.old_data as ExpenseData | null} deleted />
    case 'expense_updated':
      return <ExpenseDiff oldData={row.old_data as ExpenseData | null} newData={row.new_data as ExpenseData | null} />

    case 'supplier_created':
      return <SupplierSummary data={row.new_data as SupplierData | null} />
    case 'supplier_deactivated':
      return <SupplierSummary data={row.old_data as SupplierData | null} deactivated />
    case 'supplier_updated':
      return <SupplierDiff oldData={row.old_data as SupplierData | null} newData={row.new_data as SupplierData | null} />

    case 'price_list_created':
      return <PriceListSummary data={(row.new_data as PriceListCreateData | null)?.list ?? null} />
    case 'price_list_deleted':
      return <PriceListSummary data={row.old_data as PriceListData | null} deleted />
    case 'price_list_updated':
      return <PriceListDiff oldData={row.old_data as PriceListData | null} newData={(row.new_data as PriceListUpdateData | null)?.list ?? null} />
    case 'price_list_default_changed':
      return <PriceListDefaultChanged label={row.entity_label} />

    case 'settings_updated':
      return <SettingsDiff oldData={row.old_data as SettingsData | null} newData={row.new_data as SettingsData | null} />
    case 'settings_slug_updated':
      return <SettingsSlugDiff oldData={row.old_data as { slug?: string } | null} newData={row.new_data as { slug?: string } | null} />

    case 'operator_created':
      return <OperatorSummary data={row.new_data as OperatorData | null} />
    case 'operator_deleted':
      return <OperatorSummary data={row.old_data as OperatorData | null} deleted />
    case 'operator_updated':
      return <OperatorDiff oldData={row.old_data as OperatorData | null} newData={row.new_data as OperatorUpdateData | null} />

    case 'customer_created':
      return <CustomerSummary data={row.new_data as CustomerData | null} />
    case 'customer_updated':
      return <CustomerDiff oldData={row.old_data as CustomerData | null} newData={row.new_data as CustomerData | null} />
    case 'customer_credit_settled':
      return <CustomerSettlement oldData={row.old_data as CustomerSettlementOld | null} newData={row.new_data as CustomerSettlementNew | null} />

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
  const customerName = customerId ? lookups.customerMap[customerId] ?? null : null

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
        <Stat label="Cliente" value={customerId ? customerName ?? 'Cliente eliminado' : 'Sin cliente'} />
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
// Expense panels
// =============================================================================

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  mercaderia:  'Mercadería',
  alquiler:    'Alquiler',
  servicios:   'Servicios',
  seguros:     'Seguros',
  proveedores: 'Proveedores',
  sueldos:     'Sueldos',
  otro:        'Otro',
}

function ExpenseSummary({ data, deleted = false }: { data: ExpenseData | null; deleted?: boolean }) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const category = typeof data.category === 'string' ? EXPENSE_CATEGORY_LABELS[data.category] ?? data.category : '—'
  const items = Array.isArray(data.items) ? data.items : []

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <Trash2 size={12} />
          Eliminado
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Categoría" value={category} />
        <Stat label="Monto" value={formatMoney(toNumber(data.amount))} emphasis />
        {data.date && <Stat label="Fecha" value={String(data.date)} />}
        {data.description && <Stat label="Descripción" value={String(data.description)} />}
      </div>

      {items.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Items ({items.length})</p>
          <div className="rounded-lg border border-edge/60 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-edge/40 last:border-0">
                    <td className="px-3 py-2 align-middle text-body">
                      {it.product_name ?? <span className="text-hint italic">Sin nombre</span>}
                    </td>
                    <td className="px-3 py-2 align-middle text-right text-hint tabular-nums">
                      {toNumber(it.quantity)} × {formatMoney(toNumber(it.unit_cost))}
                    </td>
                    <td className="px-3 py-2 align-middle text-right text-body font-medium tabular-nums w-28">
                      {formatMoney(toNumber(it.quantity) * toNumber(it.unit_cost))}
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

function ExpenseDiff({ oldData, newData }: { oldData: ExpenseData | null; newData: ExpenseData | null }) {
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
    rows.push({ label: 'Proveedor', before: oldData.supplier_id ? `#${oldData.supplier_id.slice(0, 8)}` : '—', after: newData.supplier_id ? `#${newData.supplier_id.slice(0, 8)}` : '—' })
  }

  const oldItems = Array.isArray(oldData.items) ? oldData.items.length : 0
  const newItems = Array.isArray(newData.items) ? newData.items.length : 0
  if (oldItems !== newItems) {
    rows.push({ label: 'Items', before: String(oldItems), after: String(newItems) })
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => <DiffRow key={i} label={r.label} before={r.before} after={r.after} />)}
    </div>
  )
}

// =============================================================================
// Supplier panels
// =============================================================================

const SUPPLIER_FIELD_LABELS: Record<keyof SupplierData, string> = {
  name:         'Nombre',
  contact_name: 'Contacto',
  phone:        'Teléfono',
  email:        'Email',
  address:      'Dirección',
  notes:        'Notas',
  is_active:    'Activo',
}

function SupplierSummary({ data, deactivated = false }: { data: SupplierData | null; deactivated?: boolean }) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>
  return (
    <div className={cn('space-y-3', deactivated && 'opacity-90')}>
      {deactivated && (
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <Trash2 size={12} />
          Desactivado
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={String(data.name)} />}
        {data.contact_name && <Stat label="Contacto" value={String(data.contact_name)} />}
        {data.phone && <Stat label="Teléfono" value={String(data.phone)} />}
        {data.email && <Stat label="Email" value={String(data.email)} />}
        {data.address && <Stat label="Dirección" value={String(data.address)} />}
      </div>
    </div>
  )
}

function SupplierDiff({ oldData, newData }: { oldData: SupplierData | null; newData: SupplierData | null }) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []
  for (const key of Object.keys(SUPPLIER_FIELD_LABELS) as (keyof SupplierData)[]) {
    const before = oldData[key]
    const after = newData[key]
    if (before === after) continue
    if (before == null && after == null) continue
    rows.push({
      label: SUPPLIER_FIELD_LABELS[key],
      before: before == null || before === '' ? '—' : String(before),
      after:  after  == null || after  === '' ? '—' : String(after),
    })
  }
  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => <DiffRow key={i} label={r.label} before={r.before} after={r.after} />)}
    </div>
  )
}

// =============================================================================
// Price list panels
// =============================================================================

function multiplierToMarginText(value: unknown): string {
  const num = toNumber(value)
  if (!Number.isFinite(num) || num <= 0) return '—'
  const pct = (num - 1) * 100
  return `${pct.toFixed(0)}% (×${num})`
}

function PriceListSummary({ data, deleted = false }: { data: PriceListData | null; deleted?: boolean }) {
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
        {data.multiplier !== undefined && <Stat label="Margen" value={multiplierToMarginText(data.multiplier)} />}
        {data.is_default !== undefined && <Stat label="Predeterminada" value={data.is_default ? 'Sí' : 'No'} />}
        {data.description && <Stat label="Descripción" value={String(data.description)} />}
      </div>
    </div>
  )
}

function PriceListDiff({ oldData, newData }: { oldData: PriceListData | null; newData: PriceListData | null }) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []

  if (oldData.name !== newData.name) {
    rows.push({ label: 'Nombre', before: String(oldData.name ?? '—'), after: String(newData.name ?? '—') })
  }
  if (oldData.description !== newData.description) {
    rows.push({ label: 'Descripción', before: String(oldData.description ?? '—'), after: String(newData.description ?? '—') })
  }
  if (toNumber(oldData.multiplier) !== toNumber(newData.multiplier)) {
    rows.push({ label: 'Margen', before: multiplierToMarginText(oldData.multiplier), after: multiplierToMarginText(newData.multiplier) })
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles en la lista. (Pueden haberse modificado overrides por producto.)</p>
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => <DiffRow key={i} label={r.label} before={r.before} after={r.after} />)}
    </div>
  )
}

function PriceListDefaultChanged({ label }: { label: string | null }) {
  return (
    <p className="text-body">
      Lista predeterminada cambiada a{' '}
      <span className="font-semibold text-heading">{label ?? 'una lista nueva'}</span>.
    </p>
  )
}

// =============================================================================
// Settings panels
// =============================================================================

function SettingsDiff({ oldData, newData }: { oldData: SettingsData | null; newData: SettingsData | null }) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []

  if (oldData.name !== newData.name) {
    rows.push({ label: 'Nombre', before: String(oldData.name ?? '—'), after: String(newData.name ?? '—') })
  }
  if (oldData.description !== newData.description) {
    rows.push({ label: 'Descripción', before: String(oldData.description ?? '—'), after: String(newData.description ?? '—') })
  }
  if (oldData.whatsapp !== newData.whatsapp) {
    rows.push({ label: 'WhatsApp', before: String(oldData.whatsapp ?? '—'), after: String(newData.whatsapp ?? '—') })
  }
  if (oldData.logo_url !== newData.logo_url) {
    rows.push({ label: 'Logo', before: oldData.logo_url ? 'Configurado' : '—', after: newData.logo_url ? 'Configurado' : '—' })
  }

  const oldSettings = oldData.settings ?? {}
  const newSettings = newData.settings ?? {}
  const settingsKeys = new Set([...Object.keys(oldSettings), ...Object.keys(newSettings)])
  for (const key of settingsKeys) {
    const before = (oldSettings as Record<string, unknown>)[key]
    const after = (newSettings as Record<string, unknown>)[key]
    if (before === after) continue
    rows.push({
      label:  SETTINGS_FIELD_LABELS[key] ?? key,
      before: formatSettingsValue(key, before),
      after:  formatSettingsValue(key, after),
    })
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => <DiffRow key={i} label={r.label} before={r.before} after={r.after} />)}
    </div>
  )
}

function SettingsSlugDiff({ oldData, newData }: { oldData: { slug?: string } | null; newData: { slug?: string } | null }) {
  return (
    <DiffRow
      label="URL del catálogo"
      before={oldData?.slug ?? '—'}
      after={newData?.slug ?? '—'}
    />
  )
}

// =============================================================================
// Operator panels
// =============================================================================

const OPERATOR_ROLE_LABELS_LOCAL: Record<string, string> = {
  owner:   'Dueño',
  manager: 'Encargado',
  cashier: 'Cajero',
  custom:  'Personalizado',
}

const PERMISSION_LABELS: Record<string, string> = {
  sales:             'Ventas',
  stock:             'Inventario (lectura)',
  stock_write:       'Inventario (edición)',
  analysis:          'Análisis',
  price_lists:       'Listas (lectura)',
  price_lists_write: 'Listas (edición)',
  expenses:          'Gastos',
  settings:          'Configuración',
  operators_write:   'Operarios',
  price_override:    'Override de precio',
  free_line:         'Línea libre',
}

function OperatorSummary({ data, deleted = false }: { data: OperatorData | null; deleted?: boolean }) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const permissions = data.permissions ?? {}
  const enabled = Object.entries(permissions).filter(([, v]) => v === true).map(([k]) => k)

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
        {data.role && <Stat label="Rol" value={OPERATOR_ROLE_LABELS_LOCAL[data.role] ?? data.role} />}
      </div>
      {enabled.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Permisos habilitados</p>
          <div className="flex flex-wrap gap-1.5">
            {enabled.map(k => (
              <span key={k} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {PERMISSION_LABELS[k] ?? k}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function OperatorDiff({ oldData, newData }: { oldData: OperatorData | null; newData: OperatorUpdateData | null }) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []

  if (oldData.name !== newData.name && newData.name != null) {
    rows.push({ label: 'Nombre', before: String(oldData.name ?? '—'), after: String(newData.name) })
  }
  if (oldData.role !== newData.role && newData.role != null) {
    rows.push({
      label: 'Rol',
      before: OPERATOR_ROLE_LABELS_LOCAL[oldData.role ?? ''] ?? oldData.role ?? '—',
      after:  OPERATOR_ROLE_LABELS_LOCAL[newData.role] ?? newData.role,
    })
  }

  const oldPerms = oldData.permissions ?? {}
  const newPerms = newData.permissions ?? {}
  const permChanges: { key: string; before: boolean; after: boolean }[] = []
  const allKeys = new Set([...Object.keys(oldPerms), ...Object.keys(newPerms)])
  for (const key of allKeys) {
    const before = oldPerms[key] === true
    const after = newPerms[key] === true
    if (before !== after) permChanges.push({ key, before, after })
  }

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r, i) => <DiffRow key={i} label={r.label} before={r.before} after={r.after} />)}
        </div>
      )}
      {newData.pin_changed && (
        <p className="text-sm text-body">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            PIN actualizado
          </span>
        </p>
      )}
      {permChanges.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Permisos modificados</p>
          <div className="space-y-1">
            {permChanges.map(c => (
              <DiffRow
                key={c.key}
                label={PERMISSION_LABELS[c.key] ?? c.key}
                before={c.before ? 'Sí' : 'No'}
                after={c.after ? 'Sí' : 'No'}
              />
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 && permChanges.length === 0 && !newData.pin_changed && (
        <p className="text-sm text-hint">Sin cambios visibles.</p>
      )}
    </div>
  )
}

// =============================================================================
// Customer panels
// =============================================================================

const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  name:              'Nombre',
  phone:             'Teléfono',
  email:             'Email',
  dni:               'DNI',
  credit_limit:      'Límite de crédito',
  is_credit_enabled: 'Crédito',
  notes:             'Notas',
}

const CUSTOMER_FIELD_ORDER = ['name', 'phone', 'email', 'dni', 'credit_limit', 'is_credit_enabled', 'notes']

function CustomerSummary({ data }: { data: CustomerData | null }) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={String(data.name)} />}
        {data.phone && <Stat label="Teléfono" value={String(data.phone)} />}
        {data.email && <Stat label="Email" value={String(data.email)} />}
        {data.dni && <Stat label="DNI" value={String(data.dni)} />}
        {data.credit_limit !== undefined && data.credit_limit !== null && (
          <Stat label="Límite de crédito" value={formatMoney(toNumber(data.credit_limit))} />
        )}
        {data.is_credit_enabled !== undefined && (
          <Stat label="Crédito" value={data.is_credit_enabled ? 'Habilitado' : 'Deshabilitado'} />
        )}
      </div>
    </div>
  )
}

function CustomerDiff({ oldData, newData }: { oldData: CustomerData | null; newData: CustomerData | null }) {
  const formatMoney = useFormatMoney()
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const oldObj = oldData as unknown as Record<string, unknown>
  const newObj = newData as unknown as Record<string, unknown>

  const rows: { label: string; before: string; after: string }[] = []

  for (const key of CUSTOMER_FIELD_ORDER) {
    const before = oldObj[key]
    const after = newObj[key]
    if (before === after) continue
    if (before == null && after == null) continue

    if (key === 'credit_limit') {
      rows.push({
        label:  CUSTOMER_FIELD_LABELS[key],
        before: before == null ? '—' : formatMoney(toNumber(before)),
        after:  after  == null ? '—' : formatMoney(toNumber(after)),
      })
    } else if (key === 'is_credit_enabled') {
      rows.push({
        label:  CUSTOMER_FIELD_LABELS[key],
        before: before === true ? 'Habilitado' : 'Deshabilitado',
        after:  after  === true ? 'Habilitado' : 'Deshabilitado',
      })
    } else {
      rows.push({
        label:  CUSTOMER_FIELD_LABELS[key],
        before: before == null || before === '' ? '—' : String(before),
        after:  after  == null || after  === '' ? '—' : String(after),
      })
    }
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => <DiffRow key={i} label={r.label} before={r.before} after={r.after} />)}
    </div>
  )
}

function CustomerSettlement({ oldData, newData }: { oldData: CustomerSettlementOld | null; newData: CustomerSettlementNew | null }) {
  const formatMoney = useFormatMoney()
  if (!newData) return <p className="text-sm text-hint">Sin datos.</p>

  const prev = oldData?.credit_balance != null ? toNumber(oldData.credit_balance) : null
  const next = newData.credit_balance != null ? toNumber(newData.credit_balance) : null
  const amount = newData.amount != null ? toNumber(newData.amount) : null
  const method = typeof newData.method === 'string' && isPaymentMethod(newData.method)
    ? PAYMENT_LABELS[newData.method]
    : newData.method ?? null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {amount !== null && <Stat label="Monto pagado" value={formatMoney(amount)} emphasis />}
        {method && <Stat label="Método" value={method} />}
      </div>
      {prev !== null && next !== null && (
        <DiffRow label="Saldo" before={formatMoney(prev)} after={formatMoney(next)} />
      )}
    </div>
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
