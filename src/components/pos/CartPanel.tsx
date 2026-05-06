'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Pencil, Plus, Printer, ShoppingCart, Trash2, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCartStore } from '@/lib/store/cart.store'
import { getCartItemId } from '@/lib/types'
import PaymentModal from '@/components/pos/PaymentModal'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import EditSalePanel from '@/components/pos/EditSalePanel'
import type { ProductWithCategory, SaleRow, SaleDetail } from '@/components/pos/types'
import { buildReceiptData } from '@/lib/printer/receipt'
import type { ReceiptData, ReceiptItemInput } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import { calculateProductPrice } from '@/lib/price-lists'
import type { PaymentMethod } from '@/lib/constants/domain'
import { isPaymentMethod, normalizePayment } from '@/lib/payments'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { Permissions } from '@/lib/operator'
import { useToast } from '@/hooks/useToast'
import { useCurrency, useFormatMoney } from '@/lib/context/CurrencyContext'
import Toast from '@/components/shared/Toast'

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

interface SaleItemQueryRow {
  id: string
  product_id: string | null
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
  free_line_description: string | null
}

interface FreeLineForm {
  description: string
  price: string
  quantity: string
}

interface Props {
  businessId: string | null
  businessName: string
  freeLineEnabled: boolean
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  operatorId: string | null
  permissions: Permissions | null
}

export default function CartPanel({ businessId, businessName, freeLineEnabled, activePriceList, priceListOverrides, operatorId, permissions }: Props) {
  const currency = useCurrency()
  const formatMoney = useFormatMoney()
  const router = useRouter()
  const { items, removeItem, updateQuantity, updatePrice, addFreeLineItem, discount, clearCart, restoreCart } = useCartStore()
  const [showFreeLineForm, setShowFreeLineForm] = useState(false)
  const [freeLineForm, setFreeLineForm] = useState<FreeLineForm>({ description: '', price: '', quantity: '1' })
  const [showPayment, setShowPayment] = useState(false)
  const { toast, showToast, dismissToast } = useToast()
  const [activeTab, setActiveTab] = useState<RightTab>('current')
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
  const [editingPrice, setEditingPrice] = useState<{ productId: string; mode: 'unit' | 'total' } | null>(null)
  const [editPriceValue, setEditPriceValue] = useState('')
  const priceEditResolvedRef = useRef(false)
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  const isEmpty = items.length === 0

  const adjustedItems = useMemo(() => {
    return items.map(item => {
      if (item.product === null) {
        return {
          product_id: null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
          unit_price_override: item.unit_price,
          override_reason: 'free_line',
          free_line_description: item.free_line_description,
        }
      }
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
        unit_price_override: item.priceIsManual ? unitPrice : null,
        override_reason: null,
        free_line_description: null,
      }
    })
  }, [items, activePriceList, priceListOverrides])

  const adjustedByProductId = useMemo(() => {
    const map = new Map<string, { unit_price: number; total: number }>()
    for (const ai of adjustedItems) {
      if (ai.product_id !== null) {
        map.set(ai.product_id, { unit_price: ai.unit_price, total: ai.total })
      }
    }
    return map
  }, [adjustedItems])

  const adjustedSubtotal = adjustedItems.reduce((sum, i) => sum + i.total, 0)
  const adjustedTotal = Math.max(0, adjustedSubtotal - discount)
  const receiptItems = useMemo<ReceiptItemInput[]>(() => {
    return items.map(item => {
      if (item.product === null) {
        return {
          product_id: null,
          name: item.free_line_description ?? 'Producto Libre',
          icon: null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
          unit_price_override: item.unit_price,
          override_reason: 'free_line',
          free_line_description: item.free_line_description,
        }
      }
      const adjusted = adjustedByProductId.get(item.product.id)
      const product = item.product as ProductWithCategory
      return {
        product_id: item.product.id,
        name: item.product.name,
        icon: product.categories?.icon ?? null,
        quantity: item.quantity,
        unit_price: adjusted?.unit_price ?? item.unit_price,
        total: adjusted?.total ?? item.total,
        unit_price_override: item.priceIsManual ? (adjusted?.unit_price ?? item.unit_price) : null,
        override_reason: null,
        free_line_description: null,
      }
    })
  }, [adjustedByProductId, items])

  const hasStockWarning = items.some(
    item => item.product !== null && item.quantity >= item.product.stock
  )

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

      if (saleIds.length > 0) {
        const { data: payments } = await supabase
          .from('payments')
          .select('sale_id, method, created_at')
          .in('sale_id', saleIds)
          .order('created_at', { ascending: false })

        paymentsBySaleId = (payments ?? []).reduce<Record<string, PaymentMethod>>((acc, payment) => {
          if (!acc[payment.sale_id] && isPaymentMethod(payment.method)) {
            acc[payment.sale_id] = payment.method
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
      }))
    },
    enabled: activeTab === 'history' && !!businessId,
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

  const historyTotal = (() =>
    filteredHistory.reduce((acc, sale) => acc + sale.total, 0)
  )()

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
      payment_method: isPaymentMethod(data.payment_method) ? data.payment_method : null,
      operator_name: data.operator_name ?? null,
      items: (data.items ?? []).map((row: SaleItemQueryRow) => ({
        id: row.id,
        product_id: row.product_id,
        product_name: row.product_name,
        product_icon: row.product_icon ?? null,
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
    const { data, error } = await supabase.rpc('delete_sale', {
      p_sale_id: saleId,
      p_business_id: businessId,
    })
    if (!error && data?.success) {
      queryClient.setQueryData<SaleRow[]>(['pos-daily-history', businessId], (prev) =>
        prev ? prev.filter(s => s.id !== saleId) : prev
      )
      setSaleDetails(prev => { const next = { ...prev }; delete next[saleId]; return next })
      if (expandedSaleId === saleId) setExpandedSaleId(null)
      showToast({ message: 'Venta eliminada' })
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
    } else {
      showToast({ message: error?.message ?? data?.error ?? 'No se pudo eliminar la venta.' })
    }
    setDeletingId(null)
  }

  async function handleUpdateSale(
    saleId: string,
    items: { product_id: string | null; quantity: number; unit_price: number }[],
    paymentMethod: PaymentMethod
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
              const found = existing.items.find(ei => ei.product_id === i.product_id)
              return {
                id: found?.id ?? '',
                product_id: i.product_id,
                product_name: found?.product_name ?? '',
                product_icon: found?.product_icon ?? null,
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
      showToast({ message: error?.message ?? data?.error ?? 'No se pudo actualizar la venta.' })
    }
  }

  function handleCancelSale() {
    const snapshot = items.slice()
    const discountSnapshot = discount
    clearCart()
    showToast({
      message: 'Carrito vaciado',
      duration: 5500,
      onUndo: () => restoreCart(snapshot, discountSnapshot),
    })
  }

  function startPriceEdit(itemId: string, currentValue: number, mode: 'unit' | 'total') {
    if (permissions?.price_override !== true) return
    priceEditResolvedRef.current = false
    setEditingPrice({ productId: itemId, mode })
    setEditPriceValue(String(currentValue))
  }

  function commitPriceEdit(itemId: string, quantity: number) {
    if (priceEditResolvedRef.current) return
    priceEditResolvedRef.current = true
    const parsed = parseFloat(editPriceValue)
    if (!isNaN(parsed) && parsed > 0) {
      const unitPrice = editingPrice?.mode === 'total' ? parsed / quantity : parsed
      updatePrice(itemId, unitPrice)
    }
    setEditingPrice(null)
    setEditPriceValue('')
  }

  function cancelPriceEdit() {
    priceEditResolvedRef.current = true
    setEditingPrice(null)
    setEditPriceValue('')
  }

  function handleAddFreeLine() {
    const description = freeLineForm.description.trim()
    const price = parseFloat(freeLineForm.price)
    const quantity = Math.max(1, parseInt(freeLineForm.quantity, 10) || 1)

    if (!description || isNaN(price) || price < 0) return

    const id = `fl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    addFreeLineItem(id, description, price, quantity)
    setFreeLineForm({ description: '', price: '', quantity: '1' })
    setShowFreeLineForm(false)
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
              className={`h-11 text-sm font-medium border-b-2 transition-colors inline-flex items-center justify-center gap-2 ${
                activeTab === 'current'
                  ? 'text-[var(--primary-active-text)] border-primary'
                  : 'text-hint border-transparent hover:text-body'
              }`}
            >
              Venta actual
              {items.length > 0 && (
                <span className="rounded-full bg-primary/10 text-[var(--primary-active-text)] text-[10px] px-1.5 py-0.5 font-semibold tabular-nums leading-none">
                  {items.length}
                </span>
              )}
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
            {/* Items */}
            <div className="flex-1 overflow-y-auto">
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
                  {items.map(item => {
                    const itemId = getCartItemId(item)
                    const isFreeLine = item.product === null
                    const effectivePrice = isFreeLine
                      ? item.unit_price
                      : (adjustedByProductId.get(item.product!.id)?.unit_price ?? item.unit_price)
                    const effectiveTotal = isFreeLine
                      ? item.quantity * item.unit_price
                      : (adjustedByProductId.get(item.product!.id)?.total ?? item.total)
                    const isEditingUnit = editingPrice?.productId === itemId && editingPrice.mode === 'unit'
                    const isEditingTotal = editingPrice?.productId === itemId && editingPrice.mode === 'total'
                    const canOverridePrice = !isFreeLine && permissions?.price_override === true

                    const originalPrice = !isFreeLine && item.priceIsManual
                      ? !activePriceList
                        ? item.product!.price
                        : calculateProductPrice(
                            item.product!.cost,
                            item.product!.price,
                            item.product!.id,
                            item.product!.brand_id,
                            activePriceList,
                            priceListOverrides
                          )
                      : null

                    return (
                      <li key={itemId} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {isFreeLine && (
                              <PenLine size={12} className="text-primary shrink-0" />
                            )}
                            <p className="text-sm font-medium text-heading leading-tight truncate">
                              {isFreeLine ? item.free_line_description : item.product!.name}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                              <div className="flex items-center gap-1">
                                {originalPrice !== null && originalPrice !== effectivePrice && (
                                  <span className="text-[10px] text-muted-foreground line-through tabular-nums">
                                    {formatMoney(originalPrice)}
                                  </span>
                                )}
                                {isEditingUnit ? (
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    autoFocus
                                    value={editPriceValue}
                                    onChange={e => setEditPriceValue(e.target.value)}
                                    onBlur={() => commitPriceEdit(itemId, item.quantity)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitPriceEdit(itemId, item.quantity)
                                      if (e.key === 'Escape') cancelPriceEdit()
                                    }}
                                    className="w-20 text-right text-xs bg-surface border border-primary rounded px-1 py-0.5 tabular-nums focus:outline-none"
                                  />
                                ) : (
                                  <>
                                    <p
                                      className={`text-xs tabular-nums ${
                                        item.priceIsManual || isFreeLine ? 'text-primary font-medium' : 'text-hint'
                                      }`}
                                    >
                                      {formatMoney(effectivePrice)} c/u
                                    </p>
                                    {canOverridePrice && (
                                      <button
                                        type="button"
                                        onClick={() => startPriceEdit(itemId, effectivePrice, 'unit')}
                                        className="text-faint hover:text-primary transition-colors"
                                        aria-label="Editar precio unitario"
                                      >
                                        <Pencil size={10} />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            {!isFreeLine && (() => {
                              const indicator = getStockIndicator(item.quantity, item.product!.stock, item.product!.min_stock)
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
                            onClick={() => updateQuantity(itemId, item.quantity - 1)}
                            aria-label={`Quitar una unidad`}
                            className="w-8 h-8 rounded-md bg-surface hover:bg-hover-bg flex items-center justify-center transition-colors"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="text-sm font-semibold w-6 text-center tabular-nums" aria-label={`${item.quantity} unidades`}>
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(itemId, item.quantity + 1)}
                            aria-label={`Agregar una unidad`}
                            className="w-8 h-8 rounded-md bg-surface hover:bg-hover-bg flex items-center justify-center transition-colors"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <div className="text-right shrink-0 min-w-[60px]">
                          {isEditingTotal ? (
                            <input
                              type="number"
                              min={0}
                              step="any"
                              autoFocus
                              value={editPriceValue}
                              onChange={e => setEditPriceValue(e.target.value)}
                              onBlur={() => commitPriceEdit(itemId, item.quantity)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitPriceEdit(itemId, item.quantity)
                                if (e.key === 'Escape') cancelPriceEdit()
                              }}
                              className="w-20 text-right text-sm bg-surface border border-primary rounded px-1 py-0.5 tabular-nums focus:outline-none"
                            />
                          ) : (
                            <p className={`text-sm font-semibold tabular-nums ${item.priceIsManual || isFreeLine ? 'text-primary' : 'text-heading'}`}>
                              {formatMoney(effectiveTotal)}
                            </p>
                          )}
                          <div className="flex items-center justify-end gap-1.5 mt-1">
                            {canOverridePrice && !isEditingTotal && (
                              <button
                                type="button"
                                onClick={() => startPriceEdit(itemId, effectiveTotal, 'total')}
                                className="text-faint hover:text-primary transition-colors"
                                aria-label="Editar total"
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                            <button
                              onClick={() => removeItem(itemId)}
                              aria-label="Quitar del carrito"
                              className="text-faint hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Footer totals */}
            <div className="border-t border-edge-soft p-4 space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-subtle">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatMoney(adjustedSubtotal)}</span>
                </div>
                <div className="flex justify-between text-subtle">
                  <span>Ítems</span>
                  <span className="tabular-nums">{items.length === 0 ? '—' : items.length}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-[var(--primary-active-text)]">
                    <span>Descuento</span>
                    <span className="tabular-nums">-{formatMoney(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-heading text-2xl pt-2 border-t border-edge-soft leading-none">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMoney(adjustedTotal)}</span>
                </div>
              </div>

              {hasStockWarning && (
                <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                  Hay ítems con stock insuficiente
                </p>
              )}

              {freeLineEnabled && permissions?.free_line === true && (
                showFreeLineForm ? (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <p className="text-xs font-medium text-primary">Producto Libre</p>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Descripción (ej: Envío, servicio…)"
                      value={freeLineForm.description}
                      onChange={e => setFreeLineForm(prev => ({ ...prev, description: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddFreeLine()
                        if (e.key === 'Escape') setShowFreeLineForm(false)
                      }}
                      className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-heading placeholder:text-hint focus:outline-none focus:border-primary"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-0.5">
                        <label className="text-[10px] text-hint uppercase tracking-wide">Precio</label>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          placeholder="0"
                          value={freeLineForm.price}
                          onChange={e => setFreeLineForm(prev => ({ ...prev, price: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleAddFreeLine()
                            if (e.key === 'Escape') setShowFreeLineForm(false)
                          }}
                          className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-heading placeholder:text-hint focus:outline-none focus:border-primary tabular-nums"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[10px] text-hint uppercase tracking-wide">Cantidad</label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          placeholder="1"
                          value={freeLineForm.quantity}
                          onChange={e => setFreeLineForm(prev => ({ ...prev, quantity: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleAddFreeLine()
                            if (e.key === 'Escape') setShowFreeLineForm(false)
                          }}
                          className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-heading placeholder:text-hint focus:outline-none focus:border-primary tabular-nums"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => { setShowFreeLineForm(false); setFreeLineForm({ description: '', price: '', quantity: '1' }) }}
                        className="h-8 rounded-lg border border-edge text-sm text-hint hover:text-body hover:bg-hover-bg transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleAddFreeLine}
                        disabled={!freeLineForm.description.trim() || !freeLineForm.price}
                        className="h-8 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                      >
                        Agregar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowFreeLineForm(true)}
                    className="flex items-center justify-center gap-1.5 w-full h-8 rounded-xl border border-dashed border-primary/40 text-xs text-primary/70 hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors"
                  >
                    <PenLine size={12} />
                    Producto Libre
                  </button>
                )
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="cancel"
                  className="h-10 rounded-xl text-sm font-medium"
                  disabled={isEmpty}
                  onClick={handleCancelSale}
                >
                  Vaciar
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
                            {detail && (
                              <>
                                <span className="text-[11px] text-hint">
                                  {detail.items.reduce((sum, i) => sum + i.quantity, 0)} item{detail.items.reduce((sum, i) => sum + i.quantity, 0) !== 1 ? 's' : ''}
                                </span>
                                {detail.items.slice(0, 4).map(item =>
                                  item.product_icon ? (
                                    <span key={item.id} className="text-xs leading-none">{item.product_icon}</span>
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
                                  onClick={() => requestDeleteSale(sale.id)}
                                  disabled={isDeleting}
                                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
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
                    {formatMoney(Math.round(historyTotal / filteredHistory.length))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-hint">Total del día</p>
                  <p className="text-sm font-semibold text-heading tabular-nums">
                    {formatMoney(historyTotal)}
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
          onSaleCompleted={(message) => {
            showToast({ message })
            // Re-run server components to refresh stock after sale
            router.refresh()
            void queryClient.invalidateQueries({ queryKey: ['pos-daily-history'] })
          }}
          onClose={() => setShowPayment(false)}
        />
      )}

      {toast && <Toast message={toast.message} duration={toast.duration} onUndo={toast.onUndo} onDismiss={dismissToast} />}

      {receiptPreview && (
        <ReceiptPreviewModal
          receipt={receiptPreview}
          onClose={() => setReceiptPreview(null)}
        />
      )}
    </>
  )
}
