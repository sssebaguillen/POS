'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import EditSalePanel from '@/components/pos/EditSalePanel'
import { DynamicIcon } from '@/components/inventory/CategoryIconPreview'
import PopNumber from '@/components/shared/PopNumber'
import { unwrapRelation } from '@/lib/mappers'
import { buildReceiptData } from '@/lib/printer/receipt'
import type { ReceiptData } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import { getSaleDetail, updateSale, deleteSale } from '@/lib/api/sales'
import { isPaymentMethod, normalizePayment } from '@/lib/payments'
import type { PaymentMethod } from '@/lib/constants/domain'
import { useCurrency, useFormatMoney } from '@/lib/context/CurrencyContext'
import { useToast } from '@/hooks/useToast'
import Toast from '@/components/shared/Toast'
import type { SaleRow, SaleDetail } from '@/components/pos/types'

type CategoryIcon = { icon: string | null; icon_color: string | null }
type ProductIconRelation =
  | { categories: CategoryIcon | CategoryIcon[] | null }
  | { categories: CategoryIcon | CategoryIcon[] | null }[]
  | null

interface SaleItemQueryRow {
  id: string
  product_id: string | null
  variant_id: string | null
  variant_label: string | null
  product_name: string
  product_icon: string | null
  product_icon_color: string | null
  quantity: number
  unit_price: number
  free_line_description: string | null
}

interface Props {
  businessId: string | null
  businessName: string
  operatorId: string | null
  onSaleCompleted?: () => void
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SalesHistoryPanel({ businessId, businessName, operatorId, onSaleCompleted }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const currency = useCurrency()
  const formatMoney = useFormatMoney()
  const { toast, showToast, dismissToast } = useToast()

  const [historyQuery, setHistoryQuery] = useState('')
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [saleDetails, setSaleDetails] = useState<Record<string, SaleDetail>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [editingSale, setEditingSale] = useState<SaleDetail | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const confirmDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<ReceiptData | null>(null)
  const [receiptError, setReceiptError] = useState('')
  const [exporting, setExporting] = useState(false)

  const dailyHistoryQuery = useQuery<SaleRow[]>({
    queryKey: ['pos-daily-history', businessId],
    queryFn: async () => {
      const now = new Date()
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)

      const { data: sales } = await supabase
        .from('sales')
        .select('id, subtotal, discount, total, status, created_at')
        .eq('business_id', businessId!)
        .gte('created_at', startOfDay.toISOString())
        .lte('created_at', endOfDay.toISOString())
        .order('created_at', { ascending: false })

      const saleIds = (sales ?? []).map(sale => sale.id)
      let paymentsBySaleId: Record<string, PaymentMethod> = {}
      let itemsBySaleId: Record<string, { count: number; icons: { icon: string | null; color: string | null }[] }> = {}

      if (saleIds.length > 0) {
        const [{ data: payments }, { data: saleItems }] = await Promise.all([
          supabase
            .from('payments')
            .select('sale_id, method, created_at')
            .in('sale_id', saleIds)
            .order('created_at', { ascending: false }),
          // Preview de items para la fila colapsada: ícono de categoría (vía products)
          // + suma de cantidades. Ordenado por id para tomar los primeros 4 estable.
          supabase
            .from('sale_items')
            .select('sale_id, quantity, products(categories(icon, icon_color))')
            .in('sale_id', saleIds)
            .order('id', { ascending: true }),
        ])

        paymentsBySaleId = (payments ?? []).reduce<Record<string, PaymentMethod>>((acc, payment) => {
          if (!acc[payment.sale_id] && isPaymentMethod(payment.method)) {
            acc[payment.sale_id] = payment.method
          }
          return acc
        }, {})

        itemsBySaleId = (saleItems ?? []).reduce<Record<string, { count: number; icons: { icon: string | null; color: string | null }[] }>>((acc, rawRow) => {
          const row = rawRow as unknown as { sale_id: string; quantity: number; products: ProductIconRelation }
          const entry = (acc[row.sale_id] ??= { count: 0, icons: [] })
          entry.count += row.quantity
          if (entry.icons.length < 4) {
            const product = unwrapRelation(row.products)
            const category = product ? unwrapRelation(product.categories) : null
            entry.icons.push({ icon: category?.icon ?? null, color: category?.icon_color ?? null })
          }
          return acc
        }, {})
      }

      return (sales ?? []).map(sale => ({
        id: sale.id,
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount ?? 0),
        created_at: sale.created_at,
        total: Number(sale.total),
        status: sale.status,
        payment_method: paymentsBySaleId[sale.id] ?? null,
        item_count: itemsBySaleId[sale.id]?.count ?? 0,
        item_icons: itemsBySaleId[sale.id]?.icons ?? [],
      }))
    },
    enabled: !!businessId,
  })

  const history = dailyHistoryQuery.data ?? []
  const historyLoading = dailyHistoryQuery.isLoading

  const filteredHistory = (() => {
    const q = historyQuery.trim().toLowerCase()
    if (!q) return history
    return history.filter(sale =>
      sale.id.toLowerCase().includes(q) ||
      normalizePayment(sale.payment_method).toLowerCase().includes(q)
    )
  })()

  const historyTotal = filteredHistory.reduce((acc, sale) => acc + sale.total, 0)

  async function loadSaleDetail(saleId: string): Promise<SaleDetail | null> {
    if (saleDetails[saleId]) return saleDetails[saleId]
    if (!businessId) return null

    setLoadingDetailId(saleId)
    const result = await getSaleDetail(supabase, { saleId, businessId })
    if (!result.ok) {
      setLoadingDetailId(null)
      setReceiptError(result.error)
      return null
    }
    const sale = history.find(s => s.id === saleId)
    if (!sale) {
      setLoadingDetailId(null)
      return null
    }

    const detail: SaleDetail = {
      ...sale,
      payment_method: isPaymentMethod(result.data.payment_method) ? result.data.payment_method : null,
      operator_name: result.data.operator_name ?? null,
      items: (result.data.items ?? []).map((row: SaleItemQueryRow) => ({
        id: row.id,
        product_id: row.product_id,
        variant_id: row.variant_id ?? null,
        variant_label: row.variant_label ?? null,
        product_name: row.product_name,
        product_icon: row.product_icon ?? null,
        product_icon_color: row.product_icon_color ?? null,
        quantity: row.quantity,
        unit_price: Number(row.unit_price),
        free_line_description: row.free_line_description ?? null,
      })),
    }
    setSaleDetails(prev => ({ ...prev, [saleId]: detail }))
    setLoadingDetailId(null)
    return detail
  }

  async function fetchSaleDetail(saleId: string) {
    if (saleDetails[saleId]) {
      setExpandedSaleId(prev => prev === saleId ? null : saleId)
      return
    }

    const detail = await loadSaleDetail(saleId)
    if (!detail) return
    setExpandedSaleId(saleId)
  }

  async function handleOpenReceiptPreview(saleId: string) {
    setReceiptError('')
    const detail = await loadSaleDetail(saleId)
    if (!detail) return

    try {
      setReceiptPreview(buildReceiptData({
        businessName,
        sale: {
          id: detail.id,
          created_at: detail.created_at,
          subtotal: detail.subtotal,
          discount: detail.discount,
          total: detail.total,
          paymentMethod: detail.payment_method,
        },
        items: detail.items,
        currency,
      }))
    } catch (receiptBuildError) {
      console.error(receiptBuildError)
      setReceiptError(
        receiptBuildError instanceof Error
          ? receiptBuildError.message
          : 'No se pudo preparar el ticket de la venta.'
      )
    }
  }

  function requestDeleteSale(saleId: string) {
    if (confirmingDeleteId === saleId) {
      if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current)
      setConfirmingDeleteId(null)
      void handleDeleteSale(saleId)
      return
    }
    if (confirmDeleteTimerRef.current) clearTimeout(confirmDeleteTimerRef.current)
    setConfirmingDeleteId(saleId)
    confirmDeleteTimerRef.current = setTimeout(() => setConfirmingDeleteId(null), 3000)
  }

  async function handleDeleteSale(saleId: string) {
    if (!businessId) return
    setDeletingId(saleId)
    const result = await deleteSale(supabase, { saleId, businessId, operatorId })
    if (result.ok) {
      queryClient.setQueryData<SaleRow[]>(['pos-daily-history', businessId], (prev) =>
        prev ? prev.filter(s => s.id !== saleId) : prev
      )
      setSaleDetails(prev => { const next = { ...prev }; delete next[saleId]; return next })
      if (expandedSaleId === saleId) setExpandedSaleId(null)
      showToast({ message: 'Venta eliminada' })
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      onSaleCompleted?.()
    } else {
      showToast({ message: result.error })
    }
    setDeletingId(null)
  }

  async function handleUpdateSale(
    saleId: string,
    items: { product_id: string | null; variant_id: string | null; quantity: number; unit_price: number }[],
    paymentMethod: PaymentMethod
  ) {
    if (!businessId) return
    const result = await updateSale(supabase, {
      saleId,
      businessId,
      items,
      paymentMethod,
      operatorId,
    })
    if (result.ok) {
      const newTotal = Number(result.data.total)
      queryClient.setQueryData<SaleRow[]>(['pos-daily-history', businessId], (prev) =>
        prev ? prev.map(s =>
          s.id === saleId
            ? { ...s, subtotal: newTotal, total: newTotal, payment_method: paymentMethod }
            : s
        ) : prev
      )
      setSaleDetails(prev => {
        const existing = prev[saleId]
        if (!existing) return prev
        return {
          ...prev,
          [saleId]: {
            ...existing,
            subtotal: newTotal,
            total: newTotal,
            payment_method: paymentMethod,
            items: items.map(i => {
              const found = existing.items.find(ei =>
                i.variant_id ? ei.variant_id === i.variant_id : ei.product_id === i.product_id
              )
              return {
                id: found?.id ?? '',
                product_id: i.product_id,
                variant_id: i.variant_id,
                variant_label: found?.variant_label ?? null,
                product_name: found?.product_name ?? '',
                product_icon: found?.product_icon ?? null,
                product_icon_color: found?.product_icon_color ?? null,
                quantity: i.quantity,
                unit_price: i.unit_price,
                free_line_description: found?.free_line_description ?? null,
              }
            }),
          },
        }
      })
      setEditingSale(null)
      showToast({ message: 'Venta actualizada' })
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
    } else {
      showToast({ message: result.error })
    }
  }

  async function exportHistoryCsv() {
    if (!businessId || filteredHistory.length === 0 || exporting) return
    setExporting(true)

    // Fetch details for any sale not yet cached. One row per item in the CSV.
    const detailMap: Record<string, SaleDetail> = {}
    await Promise.all(filteredHistory.map(async (sale) => {
      const cached = saleDetails[sale.id]
      if (cached) {
        detailMap[sale.id] = cached
        return
      }
      const result = await getSaleDetail(supabase, { saleId: sale.id, businessId })
      if (!result.ok) return
      detailMap[sale.id] = {
        ...sale,
        payment_method: isPaymentMethod(result.data.payment_method) ? result.data.payment_method : null,
        operator_name: result.data.operator_name ?? null,
        items: (result.data.items ?? []).map((row: SaleItemQueryRow) => ({
          id: row.id,
          product_id: row.product_id,
          variant_id: row.variant_id ?? null,
          variant_label: row.variant_label ?? null,
          product_name: row.product_name,
          product_icon: row.product_icon ?? null,
          product_icon_color: row.product_icon_color ?? null,
          quantity: row.quantity,
          unit_price: Number(row.unit_price),
          free_line_description: row.free_line_description ?? null,
        })),
      }
    }))

    const headers = [
      'id', 'fecha', 'hora', 'vendedor', 'estado',
      'producto', 'variante', 'cantidad', 'precio_unitario', 'subtotal_linea',
      'metodo_pago', 'total_venta',
    ]
    const rows: string[][] = []
    for (const sale of filteredHistory) {
      const detail = detailMap[sale.id]
      const dateStr = new Date(sale.created_at).toLocaleDateString('es-AR')
      const timeStr = formatTime(sale.created_at)
      const actor = detail?.operator_name ?? 'Dueño'
      const method = normalizePayment(sale.payment_method)
      const total = sale.total.toFixed(2)
      const items = detail?.items ?? []

      if (items.length === 0) {
        rows.push([sale.id, dateStr, timeStr, actor, sale.status ?? '', '', '', '', '', '', method, total])
        continue
      }

      for (const item of items) {
        const productLabel = item.free_line_description ?? item.product_name
        const variantLabel = item.variant_label ?? ''
        const lineTotal = (item.quantity * item.unit_price).toFixed(2)
        rows.push([
          sale.id, dateStr, timeStr, actor, sale.status ?? '',
          productLabel, variantLabel,
          String(item.quantity), item.unit_price.toFixed(2), lineTotal,
          method, total,
        ])
      }
    }

    // UTF-8 BOM so Excel opens the file with proper accents.
    const csv = '﻿' + [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ventas-dia-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setExporting(false)
  }

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-edge-soft space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-body">Ventas del día</h3>
            <Button size="sm" variant="outline" className="rounded-lg text-xs" onClick={exportHistoryCsv} disabled={filteredHistory.length === 0 || exporting}>
              {exporting ? 'Exportando...' : 'Exportar CSV'}
            </Button>
          </div>
          <Input
            value={historyQuery}
            onChange={e => setHistoryQuery(e.target.value)}
            placeholder="Filtrar por método de pago..."
            className="h-9 text-sm rounded-lg"
          />
          <p className="text-xs text-subtle">
            {filteredHistory.length} ventas · {formatMoney(historyTotal)}
          </p>
          {receiptError && (
            <p className="text-xs text-red-500">{receiptError}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {historyLoading ? (
            <div className="h-full flex items-center justify-center text-sm text-hint">Cargando historial...</div>
          ) : filteredHistory.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-hint px-6 text-center">
              {historyQuery.trim()
                ? 'Ninguna venta coincide con ese filtro'
                : 'Aún no hay ventas hoy'}
            </div>
          ) : (
            <ul className="p-3 space-y-1.5">
              {filteredHistory.map((sale) => {
                const isExpanded = expandedSaleId === sale.id
                const detail = saleDetails[sale.id]
                const isLoadingDetail = loadingDetailId === sale.id
                const isDeleting = deletingId === sale.id
                const itemCount = sale.item_count ?? 0

                return (
                  <li
                    key={sale.id}
                    className={`rounded-xl border transition-all overflow-hidden ${
                      isExpanded
                        ? 'bg-primary/5 border-primary/30 dark:bg-primary/10 dark:border-primary/20'
                        : 'bg-surface border-edge hover:border-primary/30 hover:bg-surface-alt/40'
                    }`}
                  >
                    {/* Clickable header — always visible */}
                    <button
                      className="w-full px-3.5 py-2.5 text-left"
                      onClick={() => fetchSaleDetail(sale.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-semibold text-heading tabular-nums shrink-0">
                            {formatTime(sale.created_at)}
                          </span>
                          <span className="text-xs text-hint shrink-0">· #{sale.id.slice(0, 8)}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-sm font-bold tabular-nums ${isExpanded ? 'text-[var(--primary-active-text)]' : 'text-heading'}`}>
                            {formatMoney(sale.total)}
                          </span>
                          {isLoadingDetail ? (
                            <span className="w-3 h-3 border-2 border-hint border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <span className={`text-[10px] text-hint transition-transform duration-150 inline-block ${isExpanded ? '-rotate-180' : ''}`}>
                              ▾
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                          isExpanded
                            ? 'bg-primary/10 border-primary/20 text-[var(--primary-active-text)] dark:bg-primary/20 dark:border-primary/30'
                            : 'bg-surface-alt border-edge text-body'
                        }`}>
                          {normalizePayment(sale.payment_method)}
                        </span>
                        {itemCount > 0 && (
                          <>
                            <span className="text-[11px] text-hint">
                              {itemCount} item{itemCount !== 1 ? 's' : ''}
                            </span>
                            {(sale.item_icons ?? []).map((ic, i) =>
                              ic.icon ? (
                                <DynamicIcon key={i} name={ic.icon} size={13} color={ic.color ?? undefined} />
                              ) : null
                            )}
                          </>
                        )}
                      </div>
                    </button>

                    {/* Expanded detail — inside the same card */}
                    {isExpanded && detail && (
                      <div className="px-3.5 pb-3 border-t border-dashed border-primary/20 dark:border-primary/15">
                        <ul className="space-y-1 pt-2.5 mb-2.5">
                          {detail.items.map(item => (
                            <li key={item.id} className="flex items-center justify-between text-sm">
                              <span className="flex items-center gap-1.5 text-body min-w-0">
                                {item.product_icon && (
                                  <DynamicIcon name={item.product_icon} size={14} color={item.product_icon_color ?? undefined} className="shrink-0" />
                                )}
                                <span className="truncate text-xs">
                                  {item.product_name}
                                  {item.variant_label && (
                                    <span className="text-hint"> · {item.variant_label}</span>
                                  )}
                                </span>
                                <span className="text-hint shrink-0 text-xs">×{item.quantity}</span>
                              </span>
                              <span className="text-xs font-semibold text-heading tabular-nums shrink-0 ml-3">
                                {formatMoney(item.quantity * item.unit_price)}
                              </span>
                            </li>
                          ))}
                        </ul>

                        <div className="flex justify-between items-center border-t border-dashed border-primary/20 dark:border-primary/15 pt-2 mb-1">
                          <span className="text-xs font-semibold text-heading">Total cobrado</span>
                          <span className="text-xs font-bold text-[var(--primary-active-text)] tabular-nums">
                            {formatMoney(detail.total)}
                          </span>
                        </div>

                        <p className="text-[11px] text-hint mb-2.5">Por: {detail.operator_name ?? 'Dueño'}</p>

                        <div className="flex items-center justify-between gap-2 mt-2.5">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setEditingSale(detail)}
                              className="text-[11px] px-2.5 py-1 rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => requestDeleteSale(sale.id)}
                              disabled={isDeleting}
                              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-50 ${
                                confirmingDeleteId === sale.id
                                  ? 'border-red-400 bg-red-500 text-white dark:bg-red-600 dark:border-red-600 font-medium'
                                  : 'border-red-200 text-red-500 bg-surface hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:bg-transparent dark:hover:bg-red-500/10'
                              }`}
                            >
                              {isDeleting ? '…' : confirmingDeleteId === sale.id ? '¿Eliminar?' : 'Eliminar'}
                            </button>
                          </div>
                          <button
                            onClick={() => handleOpenReceiptPreview(sale.id)}
                            className="text-[11px] px-2.5 py-1 rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] inline-flex items-center gap-1.5"
                          >
                            <Printer size={12} />
                            Imprimir
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* History footer summary */}
        {!historyLoading && filteredHistory.length > 0 && (
          <div className="border-t border-edge-soft px-4 py-3 grid grid-cols-3 gap-2 text-center shrink-0">
            <div>
              <p className="text-xs text-hint">Ventas hoy</p>
              <PopNumber value={String(filteredHistory.length)} className="block text-sm font-semibold text-heading tabular-nums" />
            </div>
            <div>
              <p className="text-xs text-hint">Ticket promedio</p>
              <PopNumber value={formatMoney(Math.round(historyTotal / filteredHistory.length))} className="block text-sm font-semibold text-heading tabular-nums" />
            </div>
            <div>
              <p className="text-xs text-hint">Total del día</p>
              <PopNumber value={formatMoney(historyTotal)} className="block text-sm font-semibold text-heading tabular-nums" />
            </div>
          </div>
        )}
      </div>

      {editingSale && (
        <div className="absolute inset-0 z-40 bg-card flex flex-col">
          <div className="flex items-center gap-3 px-4 h-12 border-b border-edge shrink-0">
            <button
              onClick={() => setEditingSale(null)}
              className="text-hint hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] text-sm"
            >
              ← Volver
            </button>
            <span className="text-sm font-semibold text-heading">
              Editar venta · {formatTime(editingSale.created_at)}
            </span>
          </div>
          <EditSalePanel
            sale={editingSale}
            onSave={(items, paymentMethod) =>
              handleUpdateSale(editingSale.id, items, paymentMethod)
            }
            onCancel={() => setEditingSale(null)}
          />
        </div>
      )}

      {toast && <Toast message={toast.message} duration={toast.duration} variant={toast.variant} onUndo={toast.onUndo} onDismiss={dismissToast} />}

      {receiptPreview && (
        <ReceiptPreviewModal
          receipt={receiptPreview}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </>
  )
}
