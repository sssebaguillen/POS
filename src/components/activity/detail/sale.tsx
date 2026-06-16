'use client'

import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_LABELS, isPaymentMethod } from '@/lib/payments'
import { cn } from '@/lib/utils'
import type { SaleData, SaleItem } from '@/components/activity/payloads'
import type { ActivityLogRow, ActivityLookups } from '@/components/activity/types'
import { DeletedBadge, DiffRow, PaymentBadge, Stat, toNumber } from '@/components/activity/detail/shared'

interface SaleSummaryProps {
  data: SaleData | null
  lookups: ActivityLookups
  deleted?: boolean
}

export function SaleSummary({ data, lookups, deleted = false }: SaleSummaryProps) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const items = Array.isArray(data.items) ? data.items : []
  const payments = Array.isArray(data.payments) ? data.payments : []
  const legacyMethods = !payments.length && Array.isArray(data.payment_methods) ? data.payment_methods : null
  const total = toNumber(data.total)
  const subtotal = toNumber(data.subtotal)
  const discount = toNumber(data.discount)
  const hasDiscount = discount > 0
  const customerId = typeof data.customer_id === 'string' ? data.customer_id : null
  const customerName = customerId ? lookups.customerMap[customerId] ?? null : null

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && <DeletedBadge label="Eliminada" />}

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {hasDiscount && <Stat label="Subtotal" value={formatMoney(subtotal)} />}
        {hasDiscount && <Stat label="Descuento" value={`- ${formatMoney(discount)}`} />}
        <Stat label="Total" value={formatMoney(total)} emphasis />
        <Stat label="Cliente" value={customerId ? customerName ?? 'Cliente eliminado' : 'Sin cliente'} />
      </div>

      {(payments.length > 0 || legacyMethods) && (
        <div>
          <p className="text-label text-hint mb-1.5">Métodos de pago</p>
          <div className="flex flex-wrap gap-1.5">
            {payments.length > 0
              ? payments.map((payment, index) => (
                  <PaymentBadge
                    key={index}
                    method={payment.method}
                    amount={toNumber(payment.amount)}
                  />
                ))
              : legacyMethods!.map((method, index) => (
                  <PaymentBadge key={index} method={method} />
                ))}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div>
          <p className="text-label text-hint mb-1.5">Items ({items.length})</p>
          <div className="rounded-lg border border-edge/60 overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {items.map((item, index) => {
                  const productName = item.product_id ? lookups.productMap[item.product_id] : null
                  const quantity = toNumber(item.quantity)
                  const unitPrice = toNumber(item.unit_price)
                  const lineTotal = toNumber(item.total)
                  return (
                    <tr key={index} className="border-b border-edge/40 last:border-0">
                      <td className="px-3 py-2 align-middle">
                        {productName ? (
                          <span className="text-body">{productName}</span>
                        ) : (
                          <span className="text-hint italic">Producto eliminado</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-middle text-right text-hint tabular-nums">
                        {quantity} × {formatMoney(unitPrice)}
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
        <p className="text-sm text-hint">
          {data.item_count} item(s) — sin detalle disponible (registro antiguo).
        </p>
      )}
    </div>
  )
}

interface SaleDiffProps {
  oldData: SaleData | null
  newData: SaleData | null
  lookups: ActivityLookups
}

export function SaleDiff({ oldData, newData, lookups }: SaleDiffProps) {
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
      after: isPaymentMethod(newMethod) ? PAYMENT_LABELS[newMethod] : newMethod,
    })
  }

  const itemDiff = computeItemDiff(oldData.items ?? [], newData.items ?? [], lookups)

  return (
    <div className="space-y-3">
      {changes.length > 0 && (
        <div className="space-y-1.5">
          {changes.map((change, index) => (
            <DiffRow
              key={index}
              label={change.label}
              before={change.before}
              after={change.after}
            />
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

interface SaleSummaryInlineProps {
  row: ActivityLogRow
  customerMap: ActivityLookups['customerMap']
}

export function SaleSummaryInline({ row, customerMap }: SaleSummaryInlineProps) {
  const formatMoney = useFormatMoney()
  const oldData = row.old_data as SaleData | null
  const newData = row.new_data as SaleData | null
  const pieces: string[] = []
  const shortId = `#${row.entity_id.slice(0, 8)}`

  if (row.action === 'sale_updated') {
    const oldTotal = toNumber(oldData?.total)
    const newTotal = toNumber(newData?.total)
    if (oldTotal !== newTotal) {
      pieces.push(`${formatMoney(oldTotal)} → ${formatMoney(newTotal)}`)
    } else if (newTotal !== 0) {
      pieces.push(formatMoney(newTotal))
    } else if (oldTotal !== 0) {
      pieces.push(formatMoney(oldTotal))
    }

    const oldPaymentLabel = getFirstPaymentLabel(oldData)
    const newPaymentLabel = getFirstPaymentLabel(newData)
    if (newPaymentLabel && newPaymentLabel !== oldPaymentLabel) {
      pieces.push(newPaymentLabel)
    }

    const oldCount = getItemCount(oldData)
    const newCount = getItemCount(newData)
    if (newCount !== null && newCount !== oldCount) {
      pieces.push(`${newCount} ${newCount === 1 ? 'item' : 'items'}`)
    }
  } else {
    const data = row.action === 'sale_deleted' ? oldData : newData
    const total = data?.total == null ? null : toNumber(data.total)
    if (total !== null) pieces.push(formatMoney(total))

    const paymentLabel = getFirstPaymentLabel(data)
    if (paymentLabel) pieces.push(paymentLabel)

    const count = getItemCount(data)
    if (count !== null) pieces.push(`${count} ${count === 1 ? 'item' : 'items'}`)

    if (data?.customer_id) {
      pieces.push(customerMap[data.customer_id] ?? 'Cliente asignado')
    }
  }

  return (
    <>
      <span className="text-hint mx-1.5">·</span>
      <span className="text-hint">{shortId}</span>
      {pieces.length > 0 && (
        <>
          <span className="text-hint mx-1.5">·</span>
          <span className="text-heading font-medium">{pieces.join(' · ')}</span>
        </>
      )}
    </>
  )
}

interface DiffItem {
  productName: string
  quantity: number
  unitPrice: number
}

function getItemCount(data: SaleData | null | undefined): number | null {
  if (!data) return null
  if (Array.isArray(data.items)) return data.items.length
  if (typeof data.item_count === 'number') return data.item_count
  return null
}

function getFirstPaymentLabel(data: SaleData | null | undefined): string | null {
  const method = data?.payments?.[0]?.method
  if (!method) return null
  return isPaymentMethod(method) ? PAYMENT_LABELS[method] : method
}

function computeItemDiff(oldItems: SaleItem[], newItems: SaleItem[], lookups: ActivityLookups) {
  function key(item: SaleItem): string {
    return `${item.product_id ?? 'null'}|${item.variant_id ?? 'null'}|${toNumber(item.unit_price)}`
  }

  const oldQuantities: Record<string, { item: SaleItem; quantity: number }> = {}
  const newQuantities: Record<string, { item: SaleItem; quantity: number }> = {}

  for (const item of oldItems) {
    const itemKey = key(item)
    oldQuantities[itemKey] = {
      item,
      quantity: (oldQuantities[itemKey]?.quantity ?? 0) + toNumber(item.quantity),
    }
  }

  for (const item of newItems) {
    const itemKey = key(item)
    newQuantities[itemKey] = {
      item,
      quantity: (newQuantities[itemKey]?.quantity ?? 0) + toNumber(item.quantity),
    }
  }

  const added: DiffItem[] = []
  const removed: DiffItem[] = []
  const allKeys = new Set([...Object.keys(oldQuantities), ...Object.keys(newQuantities)])

  for (const itemKey of allKeys) {
    const oldQuantity = oldQuantities[itemKey]?.quantity ?? 0
    const newQuantity = newQuantities[itemKey]?.quantity ?? 0
    const item = newQuantities[itemKey]?.item ?? oldQuantities[itemKey]?.item
    if (!item) continue

    const productName = item.product_id
      ? lookups.productMap[item.product_id] ?? 'Producto eliminado'
      : 'Producto eliminado'
    const unitPrice = toNumber(item.unit_price)
    const delta = newQuantity - oldQuantity

    if (delta > 0) {
      added.push({ productName, quantity: delta, unitPrice })
    } else if (delta < 0) {
      removed.push({ productName, quantity: -delta, unitPrice })
    }
  }

  return { added, removed }
}

interface ItemListProps {
  items: DiffItem[]
  tone: 'added' | 'removed'
}

function ItemList({ items, tone }: ItemListProps) {
  const formatMoney = useFormatMoney()
  return (
    <ul
      className={cn(
        'rounded-lg border overflow-hidden divide-y',
        tone === 'added'
          ? 'border-success/40 divide-success/20'
          : '',
        tone === 'removed'
          ? 'border-destructive/40 divide-destructive/20'
          : '',
      )}
    >
      {items.map((item, index) => (
        <li key={index} className="px-3 py-2 text-sm flex items-center justify-between gap-3">
          <span className="text-body">{item.productName}</span>
          <span className="text-hint tabular-nums">
            {item.quantity} × {formatMoney(item.unitPrice)}
          </span>
        </li>
      ))}
    </ul>
  )
}
