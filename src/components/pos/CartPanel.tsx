'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Minus, Plus, Printer, ShoppingCart, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCartStore } from '@/lib/store/cart.store'
import PaymentModal from '@/components/pos/PaymentModal'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import type { ProductWithCategory } from '@/components/pos/types'
import { buildReceiptData } from '@/lib/printer/receipt'
import type { ReceiptData, ReceiptItemInput } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import { calculateProductPrice } from '@/lib/price-lists'
import { normalizePayment, PAYMENT_LABELS } from '@/lib/payments'
import type { PriceList, PriceListOverride } from '@/lib/types'

function getStockIndicator(
  quantity: number,
  stock: number,
  minStock: number
): { type: 'low' | 'zero' | 'negative'; label?: string } | null {
  const remaining = stock - quantity
  if (remaining < 0) return { type: 'negative', label: String(remaining) }
  if (remaining === 0) return { type: 'zero', label: '0' }
  if (remaining > 0 && remaining <= minStock) return { type: 'low' }
  return null
}

type RightTab = 'current' | 'history'

interface SaleRow {
  id: string
  subtotal: number
  discount: number
  created_at: string
  total: number
  status: string | null
  payment_method: string | null
}

interface SaleItem {
  id: string
  product_id: string
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
}

interface SaleDetail extends SaleRow {
  items: SaleItem[]
  operator_name: string | null
}

interface SaleItemQueryRow {
  id: string
  product_id: string
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
}

interface Props {
  businessId: string | null
  businessName: string
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  operatorId: string | null
}

export default function CartPanel({ businessId, businessName, activePriceList, priceListOverrides, operatorId }: Props) {
  const { items, removeItem, updateQuantity, discount, clearCart } = useCartStore()
  const [showPayment, setShowPayment] = useState(false)
  const [saleToast, setSaleToast] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<RightTab>('current')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [history, setHistory] = useState<SaleRow[]>([])
  const [historyQuery, setHistoryQuery] = useState('')
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [saleDetails, setSaleDetails] = useState<Record<string, SaleDetail>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [editingSale, setEditingSale] = useState<SaleDetail | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<ReceiptData | null>(null)
  const [receiptError, setReceiptError] = useState('')
  const supabase = useMemo(() => createClient(), [])

  const isEmpty = items.length === 0

  const adjustedItems = useMemo(() => {
    return items.map(item => {
      const unitPrice = item.priceIsManual || !activePriceList
        ? item.unit_price
        : calculateProductPrice(
            item.product.cost,
            item.product.price,
            item.product.id,
            item.product.brand_id,
            activePriceList,
            priceListOverrides
          )
      return {
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: unitPrice,
        total: item.quantity * unitPrice,
      }
    })
  }, [items, activePriceList, priceListOverrides])

  const adjustedByProductId = useMemo(() => {
    const map = new Map<string, { unit_price: number; total: number }>()
    for (const ai of adjustedItems) {
      map.set(ai.product_id, { unit_price: ai.unit_price, total: ai.total })
    }
    return map
  }, [adjustedItems])

  const adjustedSubtotal = adjustedItems.reduce((sum, i) => sum + i.total, 0)
  const adjustedTotal = Math.max(0, adjustedSubtotal - discount)
  const receiptItems = useMemo<ReceiptItemInput[]>(() => {
    return items.map(item => {
      const adjusted = adjustedByProductId.get(item.product.id)
      const product = item.product as ProductWithCategory
      return {
        product_id: item.product.id,
        name: item.product.name,
        icon: product.categories?.icon ?? null,
        quantity: item.quantity,
        unit_price: adjusted?.unit_price ?? item.unit_price,
        total: adjusted?.total ?? item.total,
      }
    })
  }, [adjustedByProductId, items])

  const hasStockWarning = items.some(
    item => item.quantity >= item.product.stock
  )

  const filteredHistory = (() => {
    const q = historyQuery.trim().toLowerCase()
    if (!q) return history
    return history.filter(sale =>
      sale.id.toLowerCase().includes(q) ||
      normalizePayment(sale.payment_method).toLowerCase().includes(q)
    )
  })()

  const historyTotal = (() =>
    filteredHistory.reduce((acc, sale) => acc + sale.total, 0)
  )()

  useEffect(() => {
    if (!saleToast) return

    const timer = setTimeout(() => setSaleToast(null), 3000)
    return () => clearTimeout(timer)
  }, [saleToast])

  useEffect(() => {
    if (activeTab !== 'history' || !businessId) return

    async function loadDailyHistory() {
      setHistoryLoading(true)
      const now = new Date()
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)

      const { data: sales } = await supabase
        .from('sales')
        .select('id, subtotal, discount, total, status, created_at')
        .eq('business_id', businessId)
        .gte('created_at', startOfDay.toISOString())
        .lte('created_at', endOfDay.toISOString())
        .order('created_at', { ascending: false })

      const saleIds = (sales ?? []).map(sale => sale.id)
      let paymentsBySaleId: Record<string, string> = {}

      if (saleIds.length > 0) {
        const { data: payments } = await supabase
          .from('payments')
          .select('sale_id, method, created_at')
          .in('sale_id', saleIds)
          .order('created_at', { ascending: false })

        paymentsBySaleId = (payments ?? []).reduce<Record<string, string>>((acc, payment) => {
          if (!acc[payment.sale_id]) {
            acc[payment.sale_id] = payment.method
          }
          return acc
        }, {})
      }

      setHistory(
        (sales ?? []).map(sale => ({
          id: sale.id,
          subtotal: Number(sale.subtotal),
          discount: Number(sale.discount ?? 0),
          created_at: sale.created_at,
          total: Number(sale.total),
          status: sale.status,
          payment_method: paymentsBySaleId[sale.id] ?? null,
        }))
      )
      setHistoryLoading(false)
    }

    loadDailyHistory()
  }, [activeTab, businessId, supabase])

  async function loadSaleDetail(saleId: string): Promise<SaleDetail | null> {
    if (saleDetails[saleId]) {
      return saleDetails[saleId]
    }

    setLoadingDetailId(saleId)
    const { data, error } = await supabase.rpc('get_sale_detail', {
      p_sale_id: saleId,
      p_business_id: businessId,
    })
    if (error || !data?.success) {
      setLoadingDetailId(null)
      setReceiptError(error?.message ?? 'No se pudo cargar el detalle de la venta.')
      return null
    }
    const sale = history.find(s => s.id === saleId)
    if (!sale) {
      setLoadingDetailId(null)
      return null
    }

    const detail: SaleDetail = {
      ...sale,
      payment_method: data.payment_method ?? null,
      operator_name: data.operator_name ?? null,
      items: (data.items ?? []).map((row: SaleItemQueryRow) => ({
        id: row.id,
        product_id: row.product_id,
        product_name: row.product_name,
        product_icon: row.product_icon ?? null,
        quantity: row.quantity,
        unit_price: Number(row.unit_price),
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

  async function handleDeleteSale(saleId: string) {
    if (!businessId) return
    setDeletingId(saleId)
    const { data, error } = await supabase.rpc('delete_sale', {
      p_sale_id: saleId,
      p_business_id: businessId,
    })
    if (!error && data?.success) {
      setHistory(prev => prev.filter(s => s.id !== saleId))
      setSaleDetails(prev => { const next = { ...prev }; delete next[saleId]; return next })
      if (expandedSaleId === saleId) setExpandedSaleId(null)
    }
    setDeletingId(null)
  }

  async function handleUpdateSale(
    saleId: string,
    items: { product_id: string; quantity: number; unit_price: number }[],
    paymentMethod: string
  ) {
    if (!businessId) return
    const { data, error } = await supabase.rpc('update_sale', {
      p_sale_id: saleId,
      p_business_id: businessId,
      p_items: items,
      p_payment_method: paymentMethod,
    })
    if (!error && data?.success) {
      const newTotal = Number(data.total)
      setHistory(prev => prev.map(s =>
        s.id === saleId
          ? { ...s, subtotal: newTotal, total: newTotal, payment_method: paymentMethod }
          : s
      ))
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
              const found = existing.items.find(ei => ei.product_id === i.product_id)
              return {
                id: found?.id ?? '',
                product_id: i.product_id,
                product_name: found?.product_name ?? '',
                product_icon: found?.product_icon ?? null,
                quantity: i.quantity,
                unit_price: i.unit_price,
              }
            }),
          },
        }
      })
      setEditingSale(null)
    }
  }

  function handleCancelSale() {
    clearCart()
  }

  function formatTime(dateString: string) {
    return new Date(dateString).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function exportHistoryCsv() {
    const headers = ['id', 'fecha', 'hora', 'total', 'metodo_pago', 'estado']
    const rows = filteredHistory.map(sale => {
      const date = new Date(sale.created_at)
      return [
        sale.id,
        date.toLocaleDateString('es-AR'),
        formatTime(sale.created_at),
        sale.total.toFixed(2),
        normalizePayment(sale.payment_method),
        sale.status ?? '',
      ]
    })

    const csv = [headers, ...rows]
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
  }

  return (
    <>
      <div className="flex flex-col h-full relative">
        {/* Tabs */}
        <div className="border-b border-edge/60">
          <div className="grid grid-cols-2">
            <button
              onClick={() => setActiveTab('current')}
              className={`h-11 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'current'
                  ? 'text-[var(--primary-active-text)] border-primary'
                  : 'text-hint border-transparent hover:text-body'
              }`}
            >
              Venta actual
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`h-11 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'history'
                  ? 'text-[var(--primary-active-text)] border-primary'
                  : 'text-hint border-transparent hover:text-body'
              }`}
            >
              Historial
            </button>
          </div>
        </div>

        {activeTab === 'current' ? (
          <>
            {/* Sub-header */}
            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
              <h2 className="text-base font-semibold text-heading">Venta actual</h2>
              <span className="rounded-full bg-primary/10 text-[var(--primary-active-text)] text-xs px-2.5 py-1 font-medium">
                {items.length} items
              </span>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto border-t border-edge-soft">
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full text-faint select-none px-6 text-center">
                  <ShoppingCart size={48} className="mb-3 opacity-30" />
                  <p className="text-sm text-hint leading-tight">
                    Escaneá un producto o seleccionalo
                    <br />
                    del panel para comenzar
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-edge-soft">
                  {items.map(item => (
                    <li key={item.product.id} className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-heading leading-tight truncate">
                          {item.product.name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-xs text-hint">
                            ${(adjustedByProductId.get(item.product.id)?.unit_price ?? item.unit_price).toLocaleString('es-AR')} c/u
                          </p>
                          {(() => {
                            const indicator = getStockIndicator(item.quantity, item.product.stock, item.product.min_stock)
                            if (!indicator) return null
                            const isRed = indicator.type === 'zero' || indicator.type === 'negative'
                            return (
                              <span className={`inline-flex items-center gap-1 leading-none ${isRed ? 'text-red-500 dark:text-red-400' : 'text-amber-500 dark:text-amber-400'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRed ? 'bg-red-500 dark:bg-red-400' : 'bg-amber-400 dark:bg-amber-400'}`} />
                                {indicator.label && (
                                  <span className="text-[10px] font-medium tabular-nums">{indicator.label}</span>
                                )}
                              </span>
                            )
                          })()}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                          className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="text-sm font-semibold w-6 text-center tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                          className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-heading tabular-nums">
                          ${(adjustedByProductId.get(item.product.id)?.total ?? item.total).toLocaleString('es-AR')}
                        </p>
                        <button
                          onClick={() => removeItem(item.product.id)}
                          className="text-faint hover:text-red-400 transition-colors mt-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer totals */}
            <div className="border-t border-edge-soft p-4 space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-subtle">
                  <span>Subtotal</span>
                  <span className="tabular-nums">${adjustedSubtotal.toLocaleString('es-AR')}</span>
                </div>
                <div className="flex justify-between text-subtle">
                  <span>Ítems</span>
                  <span className="tabular-nums">{items.length === 0 ? '—' : items.length}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-[var(--primary-active-text)]">
                    <span>Descuento</span>
                    <span className="tabular-nums">-${discount.toLocaleString('es-AR')}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-heading text-2xl pt-2 border-t border-edge-soft leading-none">
                  <span>Total</span>
                  <span className="tabular-nums">${adjustedTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="cancel"
                  className="h-10 rounded-xl text-sm font-medium"
                  disabled={isEmpty}
                  onClick={handleCancelSale}
                >
                  Cancelar
                </Button>
                <Button
                  className={`h-10 rounded-xl text-sm font-semibold text-primary-foreground transition-colors ${
                    hasStockWarning
                      ? 'bg-orange-500 hover:bg-orange-600'
                      : 'bg-primary hover:bg-primary/90'
                  }`}
                  disabled={isEmpty}
                  onClick={() => setShowPayment(true)}
                >
                  Cobrar
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* History tab */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-edge-soft space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-body">Ventas del día</h3>
                <Button size="sm" variant="outline" className="rounded-lg text-xs" onClick={exportHistoryCsv} disabled={filteredHistory.length === 0}>
                  Exportar CSV
                </Button>
              </div>
              <Input
                value={historyQuery}
                onChange={e => setHistoryQuery(e.target.value)}
                placeholder="Buscar por id o método..."
                className="h-9 text-sm rounded-lg"
              />
              <p className="text-xs text-subtle">
                {filteredHistory.length} ventas · ${historyTotal.toLocaleString('es-AR')}
              </p>
              {receiptError && (
                <p className="text-xs text-red-500">{receiptError}</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-hint">Cargando historial...</div>
              ) : filteredHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-hint">No hay ventas para mostrar</div>
              ) : (
                <ul className="p-3 space-y-1.5">
                  {filteredHistory.map((sale, index) => {
                    const isExpanded = expandedSaleId === sale.id
                    const detail = saleDetails[sale.id]
                    const isLoadingDetail = loadingDetailId === sale.id
                    const isDeleting = deletingId === sale.id
                    const saleNumber = filteredHistory.length - index

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
                              <span className="text-xs text-hint shrink-0">· Venta #{saleNumber}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`text-sm font-bold tabular-nums ${isExpanded ? 'text-[var(--primary-active-text)]' : 'text-heading'}`}>
                                ${sale.total.toLocaleString('es-AR')}
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
                            {detail && (
                              <>
                                <span className="text-[11px] text-hint">
                                  {detail.items.reduce((sum, i) => sum + i.quantity, 0)} item{detail.items.reduce((sum, i) => sum + i.quantity, 0) !== 1 ? 's' : ''}
                                </span>
                                {detail.items.slice(0, 4).map(item =>
                                  item.product_icon ? (
                                    <span key={item.product_id} className="text-xs leading-none">{item.product_icon}</span>
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
                                      <span className="text-sm leading-none shrink-0">{item.product_icon}</span>
                                    )}
                                    <span className="truncate text-xs">{item.product_name}</span>
                                    <span className="text-hint shrink-0 text-xs">×{item.quantity}</span>
                                  </span>
                                  <span className="text-xs font-semibold text-heading tabular-nums shrink-0 ml-3">
                                    ${(item.quantity * item.unit_price).toLocaleString('es-AR')}
                                  </span>
                                </li>
                              ))}
                            </ul>

                            <div className="flex justify-between items-center border-t border-dashed border-primary/20 dark:border-primary/15 pt-2 mb-1">
                              <span className="text-xs font-semibold text-heading">Total cobrado</span>
                              <span className="text-xs font-bold text-[var(--primary-active-text)] tabular-nums">
                                ${detail.total.toLocaleString('es-AR')}
                              </span>
                            </div>

                            {detail.operator_name && (
                              <p className="text-[11px] text-hint mb-2.5">Por: {detail.operator_name}</p>
                            )}

                            <div className="flex items-center justify-between gap-2 mt-2.5">
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => setEditingSale(detail)}
                                  className="text-[11px] px-2.5 py-1 rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleDeleteSale(sale.id)}
                                  disabled={isDeleting}
                                  className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-500 bg-surface hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:bg-transparent dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                >
                                  {isDeleting ? '…' : 'Eliminar'}
                                </button>
                              </div>
                              <button
                                onClick={() => handleOpenReceiptPreview(sale.id)}
                                className="text-[11px] px-2.5 py-1 rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors inline-flex items-center gap-1.5"
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
                  <p className="text-sm font-semibold text-heading tabular-nums">{filteredHistory.length}</p>
                </div>
                <div>
                  <p className="text-xs text-hint">Ticket promedio</p>
                  <p className="text-sm font-semibold text-heading tabular-nums">
                    ${Math.round(historyTotal / filteredHistory.length).toLocaleString('es-AR')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-hint">Total del día</p>
                  <p className="text-sm font-semibold text-heading tabular-nums">
                    ${historyTotal.toLocaleString('es-AR')}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {editingSale && (
          <div className="absolute inset-0 z-40 bg-card flex flex-col">
            <div className="flex items-center gap-3 px-4 h-12 border-b border-edge shrink-0">
              <button
                onClick={() => setEditingSale(null)}
                className="text-hint hover:text-body transition-colors text-sm"
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
      </div>

      {showPayment && (
        <PaymentModal
          businessName={businessName}
          subtotal={adjustedSubtotal}
          discount={discount}
          total={adjustedTotal}
          businessId={businessId}
          priceListId={activePriceList?.id ?? null}
          saleItems={adjustedItems}
          receiptItems={receiptItems}
          operatorId={operatorId}
          onSaleCompleted={setSaleToast}
          onClose={() => setShowPayment(false)}
        />
      )}

      {saleToast && (
        <div className="fixed bottom-4 right-4 z-[70] flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-2.5 shadow-lg text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/80 dark:text-emerald-200">
          <Check size={14} />
          <span>{saleToast}</span>
          <button
            type="button"
            onClick={() => setSaleToast(null)}
            aria-label="Cerrar notificacion"
            className="ml-1 rounded p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {receiptPreview && (
        <ReceiptPreviewModal
          receipt={receiptPreview}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </>
  )
}

function EditSalePanel({
  sale,
  onSave,
  onCancel,
}: {
  sale: SaleDetail
  onSave: (items: { product_id: string; quantity: number; unit_price: number }[], paymentMethod: string) => void
  onCancel: () => void
}) {
  const PAYMENT_OPTIONS: { value: string; label: string }[] = [
    { value: 'cash', label: PAYMENT_LABELS.cash },
    { value: 'card', label: PAYMENT_LABELS.card },
    { value: 'mercadopago', label: PAYMENT_LABELS.mercadopago },
    { value: 'transfer', label: PAYMENT_LABELS.transfer },
  ]
  const [items, setItems] = useState(sale.items.map(i => ({ ...i })))
  const [paymentMethod, setPaymentMethod] = useState(sale.payment_method ?? 'cash')

  function updateQty(productId: string, qty: number) {
    if (qty < 1) return
    setItems(prev => prev.map(i => i.product_id === productId ? { ...i, quantity: qty } : i))
  }

  function removeItem(productId: string) {
    setItems(prev => prev.filter(i => i.product_id !== productId))
  }

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {items.map(item => (
          <div key={item.product_id} className="flex items-center gap-3 py-2 border-b border-edge-soft">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-heading truncate">{item.product_name}</p>
              <p className="text-xs text-hint">${item.unit_price.toLocaleString('es-AR')} c/u</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => updateQty(item.product_id, item.quantity - 1)}
                className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors text-xs"
              >
                −
              </button>
              <span className="text-sm font-semibold w-6 text-center tabular-nums">{item.quantity}</span>
              <button
                onClick={() => updateQty(item.product_id, item.quantity + 1)}
                className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors text-xs"
              >
                +
              </button>
            </div>
            <p className="text-sm font-semibold text-heading tabular-nums w-20 text-right shrink-0">
              ${(item.quantity * item.unit_price).toLocaleString('es-AR')}
            </p>
            <button
              onClick={() => removeItem(item.product_id)}
              className="text-faint hover:text-red-400 transition-colors shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-edge space-y-3 shrink-0">
        <div>
          <p className="text-xs text-hint mb-1.5">Método de pago</p>
          <div className="flex flex-wrap gap-1.5">
            {PAYMENT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPaymentMethod(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  paymentMethod === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-edge text-body hover:bg-hover-bg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-baseline">
          <span className="text-sm text-subtle">Total</span>
          <span className="text-lg font-semibold text-heading tabular-nums">
            ${total.toLocaleString('es-AR')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="cancel"
            className="h-10 rounded-xl text-sm"
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button
            className="h-10 rounded-xl text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={items.length === 0}
            onClick={() => onSave(
              items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
              paymentMethod
            )}
          >
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  )
}
