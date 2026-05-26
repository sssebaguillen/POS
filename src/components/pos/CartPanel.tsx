'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Minus, Pencil, Plus, ShoppingCart, Trash2, PenLine, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCartStore } from '@/lib/store/cart.store'
import { getCartItemId } from '@/lib/types'
import PaymentModal from '@/components/pos/PaymentModal'
import SalesHistoryPanel from '@/components/pos/SalesHistoryPanel'
import type { ProductWithCategory } from '@/components/pos/types'
import type { ReceiptItemInput } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import { resolveCartItemPrice, resolveDisplayPrice } from '@/lib/price-lists'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { CustomerSelection } from '@/lib/types/pos'
import type { Permissions } from '@/lib/operator'
import { useToast } from '@/hooks/useToast'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
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

interface FreeLineForm {
  description: string
  price: string
  quantity: string
}

export interface CartPanelHandle {
  openPaymentModal: () => void
  isPaymentOpen: () => boolean
}

interface Props {
  businessId: string | null
  businessName: string
  freeLineEnabled: boolean
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  operatorId: string | null
  permissions: Permissions | null
  sessionId?: string | null
  confirmingClear?: boolean
  onVaciar?: () => void
  onSaleCompleted?: () => void
}

const CartPanel = forwardRef<CartPanelHandle, Props>(function CartPanel({ businessId, businessName, freeLineEnabled, activePriceList, priceListOverrides, operatorId, permissions, sessionId = null, confirmingClear: externalConfirming, onVaciar, onSaleCompleted }: Props, ref) {
  const formatMoney = useFormatMoney()
  const router = useRouter()
  const { items, removeItem, updateQuantity, updatePrice, addFreeLineItem, discount, clearCart, restoreCart } = useCartStore()
  const [showFreeLineForm, setShowFreeLineForm] = useState(false)
  const [freeLineForm, setFreeLineForm] = useState<FreeLineForm>({ description: '', price: '', quantity: '1' })
  const [showPayment, setShowPayment] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSelection | null>(null)
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerSelection[]>([])
  const [customerSearching, setCustomerSearching] = useState(false)
  const { toast, showToast, dismissToast } = useToast()
  const [activeTab, setActiveTab] = useState<RightTab>('current')
  const [editingPrice, setEditingPrice] = useState<{ productId: string; mode: 'unit' | 'total' } | null>(null)
  const [editPriceValue, setEditPriceValue] = useState('')
  const priceEditResolvedRef = useRef(false)
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  const isEmpty = items.length === 0

  useImperativeHandle(ref, () => ({
    openPaymentModal: () => { if (!isEmpty && !showPayment) setShowPayment(true) },
    isPaymentOpen: () => showPayment,
  }), [isEmpty, showPayment])

  const adjustedItems = useMemo(() => {
    return items.map(item => {
      if (item.product === null) {
        return {
          product_id: null,
          variant_id: null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
          unit_price_override: item.unit_price,
          override_reason: 'free_line',
          free_line_description: item.free_line_description,
        }
      }
      const unitPrice = resolveCartItemPrice({ item, priceList: activePriceList, overrides: priceListOverrides })
      return {
        product_id: item.product.id,
        variant_id: item.variant_id ?? null,
        quantity: item.quantity,
        unit_price: unitPrice,
        total: item.quantity * unitPrice,
        unit_price_override: item.priceIsManual ? unitPrice : null,
        override_reason: null,
        free_line_description: null,
      }
    })
  }, [items, activePriceList, priceListOverrides])

  // Key is variant_id when present, otherwise product_id
  const adjustedByItemKey = useMemo(() => {
    const map = new Map<string, { unit_price: number; total: number }>()
    for (const ai of adjustedItems) {
      if (ai.product_id !== null) {
        const key = ai.variant_id ?? ai.product_id
        map.set(key, { unit_price: ai.unit_price, total: ai.total })
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
          variant_id: null,
          name: item.free_line_description ?? 'Producto Libre',
          icon: null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total: item.quantity * item.unit_price,
          unit_price_override: item.unit_price,
          override_reason: 'free_line',
          free_line_description: item.free_line_description,
          variant_label: null,
        }
      }
      const itemKey = item.variant_id ?? item.product.id
      const adjusted = adjustedByItemKey.get(itemKey)
      const product = item.product as ProductWithCategory
      return {
        product_id: item.product.id,
        variant_id: item.variant_id ?? null,
        name: item.product.name,
        icon: product.categories?.icon ?? null,
        quantity: item.quantity,
        unit_price: adjusted?.unit_price ?? item.unit_price,
        total: adjusted?.total ?? item.total,
        unit_price_override: item.priceIsManual ? (adjusted?.unit_price ?? item.unit_price) : null,
        override_reason: null,
        free_line_description: null,
        variant_label: item.variant_label ?? null,
      }
    })
  }, [adjustedByItemKey, items])

  const hasStockWarning = items.some(item => {
    if (item.product === null) return false
    const availableStock = item.variant_id
      ? (item.variant_stock ?? item.product.stock)
      : item.product.stock
    return item.quantity >= availableStock
  })

  useEffect(() => {
    if (!businessId) return
    const q = customerQuery.trim()
    if (q.length < 2) {
      setCustomerResults([])
      setCustomerSearching(false)
      return
    }
    setCustomerSearching(true)
    const handle = setTimeout(async () => {
      const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone, credit_balance, credit_limit, is_credit_enabled')
        .eq('business_id', businessId)
        .or(`name.ilike.${pattern},phone.ilike.${pattern}`)
        .order('name', { ascending: true })
        .limit(5)
      setCustomerResults(
        (data ?? []).map(row => ({
          id: row.id as string,
          name: row.name as string,
          phone: (row.phone as string | null) ?? null,
          credit_balance: Number(row.credit_balance ?? 0),
          credit_limit: Number(row.credit_limit ?? 0),
          is_credit_enabled: Boolean(row.is_credit_enabled),
        }))
      )
      setCustomerSearching(false)
    }, 300)
    return () => clearTimeout(handle)
  }, [customerQuery, businessId, supabase])

  function selectCustomer(customer: CustomerSelection) {
    setSelectedCustomer(customer)
    setShowCustomerSearch(false)
    setCustomerQuery('')
    setCustomerResults([])
  }

  const [localConfirming, setLocalConfirming] = useState(false)
  const confirmClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isConfirmingClear = externalConfirming ?? localConfirming

  function handleCancelSale() {
    if (onVaciar) {
      // estado controlado desde POSView — delegar toda la lógica
      onVaciar()
      return
    }
    // modo autónomo (sin prop onVaciar)
    if (!localConfirming) {
      setLocalConfirming(true)
      confirmClearTimerRef.current = setTimeout(() => setLocalConfirming(false), 3000)
      return
    }
    if (confirmClearTimerRef.current) clearTimeout(confirmClearTimerRef.current)
    setLocalConfirming(false)
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

  return (
    <>
      <div className="flex flex-col h-full relative">
        {/* Tabs */}
        <div className="border-b border-edge/60">
          <div className="grid grid-cols-2">
            <button
              onClick={e => { setActiveTab('current'); e.currentTarget.blur() }}
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
              onClick={e => { setActiveTab('history'); e.currentTarget.blur() }}
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
                  <ShoppingCart size={48} className="mb-3 opacity-50" />
                  <p className="text-sm text-hint leading-tight">
                    Escanea un producto o selecciónalo
                    <br />
                    del panel para comenzar
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-edge-soft">
                  {items.map(item => {
                    const itemId = getCartItemId(item)
                    const isFreeLine = item.product === null
                    const adjustedKey = isFreeLine ? '' : (item.variant_id ?? item.product!.id)
                    const effectivePrice = isFreeLine
                      ? item.unit_price
                      : (adjustedByItemKey.get(adjustedKey)?.unit_price ?? item.unit_price)
                    const effectiveTotal = isFreeLine
                      ? item.quantity * item.unit_price
                      : (adjustedByItemKey.get(adjustedKey)?.total ?? item.total)
                    const isEditingUnit = editingPrice?.productId === itemId && editingPrice.mode === 'unit'
                    const isEditingTotal = editingPrice?.productId === itemId && editingPrice.mode === 'total'
                    const canOverridePrice = !isFreeLine && permissions?.price_override === true

                    const originalPrice = !isFreeLine && item.priceIsManual
                      ? resolveDisplayPrice({
                          cost: item.variant_id ? (item.variant_cost ?? 0) : item.product!.cost,
                          price: item.variant_id ? (item.variant_base_price ?? item.unit_price) : item.product!.price,
                          productId: item.product!.id,
                          brandId: item.product!.brand_id,
                          priceList: activePriceList,
                          overrides: priceListOverrides,
                          variantPrice: item.variant_id ? (item.variant_base_price ?? item.unit_price) : null,
                        })
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
                          {!isFreeLine && item.variant_label && (
                            <p className="text-[11px] text-subtle leading-tight truncate">
                              {item.variant_label}
                            </p>
                          )}
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
                              const availableStock = item.variant_id
                                ? (item.variant_stock ?? item.product!.stock)
                                : item.product!.stock
                              const indicator = getStockIndicator(item.quantity, availableStock, item.product!.min_stock)
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

              {selectedCustomer ? (
                <div className="flex items-center justify-between gap-2 w-full rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <User size={14} className="text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-heading truncate">{selectedCustomer.name}</p>
                      {selectedCustomer.is_credit_enabled && (
                        <p className="text-[10px] text-hint tabular-nums">
                          Crédito disponible: {formatMoney(Math.max(0, selectedCustomer.credit_limit - selectedCustomer.credit_balance))}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCustomer(null)}
                    aria-label="Quitar cliente asignado"
                    className="text-hint hover:text-red-500 transition-colors shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : showCustomerSearch ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-primary">Asignar cliente</p>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar por nombre o teléfono..."
                    value={customerQuery}
                    onChange={e => setCustomerQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        setShowCustomerSearch(false)
                        setCustomerQuery('')
                        setCustomerResults([])
                      }
                    }}
                    className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-heading placeholder:text-hint focus:outline-none focus:border-primary"
                  />
                  <div className="min-h-[1.5rem]">
                    {customerSearching ? (
                      <p className="text-xs text-hint px-1">Buscando...</p>
                    ) : customerQuery.trim().length >= 2 && customerResults.length === 0 ? (
                      <p className="text-xs text-hint px-1">Sin resultados</p>
                    ) : customerResults.length > 0 ? (
                      <ul className="divide-y divide-edge-soft rounded-lg border border-edge bg-surface overflow-hidden">
                        {customerResults.map(customer => (
                          <li key={customer.id}>
                            <button
                              type="button"
                              onClick={() => selectCustomer(customer)}
                              className="w-full text-left px-3 py-1.5 hover:bg-hover-bg transition-colors"
                            >
                              <p className="text-xs font-semibold text-heading truncate">{customer.name}</p>
                              {customer.phone && (
                                <p className="text-[10px] text-hint truncate">{customer.phone}</p>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerSearch(false)
                      setCustomerQuery('')
                      setCustomerResults([])
                    }}
                    className="h-8 w-full rounded-lg border border-edge text-sm text-hint hover:text-body hover:bg-hover-bg transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCustomerSearch(true)}
                  className="flex items-center justify-center gap-1.5 w-full h-8 rounded-xl border border-primary/40 text-xs text-primary/70 hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors"
                >
                  <User size={12} />
                  Asignar cliente
                </button>
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
                  variant={isConfirmingClear ? 'destructive' : 'cancel'}
                  className="h-10 rounded-xl text-sm font-medium transition-colors"
                  disabled={isEmpty}
                  onClick={e => { handleCancelSale(); e.currentTarget.blur() }}
                >
                  {isConfirmingClear ? '¿Vaciar carrito?' : 'Vaciar'}
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
          <SalesHistoryPanel
            businessId={businessId}
            businessName={businessName}
            operatorId={operatorId}
            onSaleCompleted={onSaleCompleted}
          />
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
          sessionId={sessionId}
          customer={selectedCustomer}
          onSaleCompleted={(message) => {
            showToast({ message })
            setSelectedCustomer(null)
            router.refresh()
            void queryClient.invalidateQueries({ queryKey: ['pos-daily-history'] })
            onSaleCompleted?.()
          }}
          onClose={() => setShowPayment(false)}
        />
      )}

      {toast && <Toast message={toast.message} duration={toast.duration} variant={toast.variant} onUndo={toast.onUndo} onDismiss={dismissToast} />}
    </>
  )
})

export default CartPanel
