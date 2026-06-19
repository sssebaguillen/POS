'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Minus, PencilSimple, Percent, Plus, ShoppingCart, Trash, User, X } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { useCartStore, resolveDiscountAmount, type DiscountMode } from '@/lib/store/cart.store'
import { getCartItemId } from '@/lib/types/cart'
import PaymentModal from '@/components/pos/PaymentModal'
import SalesHistoryPanel from '@/components/pos/SalesHistoryPanel'
import type { ProductWithCategory } from '@/components/pos/types'
import type { ReceiptItemInput } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import { resolveCartItemPrice, resolveDisplayPrice } from '@/lib/price-lists'
import { round2 } from '@/lib/format'
import { findApplicablePromo, promoBadgeLabel, resolvePromoLine, type Promotion } from '@/lib/promotions'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { CustomerSelection } from '@/lib/types/pos'
import type { Permissions } from '@/lib/operator'
import { useToast } from '@/hooks/useToast'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import PopNumber from '@/components/shared/PopNumber'

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
  promotions: Promotion[]
  operatorId: string | null
  permissions: Permissions | null
  sessionId?: string | null
  confirmingClear?: boolean
  onVaciar?: () => void
  onSaleCompleted?: () => void
}

const CartPanel = forwardRef<CartPanelHandle, Props>(function CartPanel({ businessId, businessName, freeLineEnabled, activePriceList, priceListOverrides, promotions, operatorId, permissions, sessionId = null, confirmingClear: externalConfirming, onVaciar, onSaleCompleted }: Props, ref) {
  const formatMoney = useFormatMoney()
  const router = useRouter()
  const { items, removeItem, updateQuantity, updatePrice, addFreeLineItem, discountMode, discountValue, setDiscount, clearDiscount, clearCart, restoreCart } = useCartStore()
  const [showFreeLineForm, setShowFreeLineForm] = useState(false)
  const [freeLineForm, setFreeLineForm] = useState<FreeLineForm>({ description: '', price: '', quantity: '1' })
  const [showDiscountForm, setShowDiscountForm] = useState(false)
  const [discountForm, setDiscountForm] = useState<{ mode: DiscountMode; value: string }>({ mode: 'fixed', value: '' })
  const [showPayment, setShowPayment] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSelection | null>(null)
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerSelection[]>([])
  const [customerSearching, setCustomerSearching] = useState(false)
  const { showToast } = useToast()
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
          promotion_id: null,
          promo_discount: 0,
          original_unit_price: item.unit_price,
          promo_label: null,
        }
      }
      const baseUnitPrice = resolveCartItemPrice({ item, priceList: activePriceList, overrides: priceListOverrides })
      // El override manual gana sobre todo: excluye la línea de listas Y de promos.
      const promo = item.priceIsManual
        ? null
        : findApplicablePromo({
            promotions,
            productId: item.product.id,
            categoryId: item.product.category_id,
            brandId: item.product.brand_id,
          })
      const line = resolvePromoLine({ promo, unitPrice: baseUnitPrice, quantity: item.quantity })
      return {
        product_id: item.product.id,
        variant_id: item.variant_id ?? null,
        quantity: item.quantity,
        unit_price: line.unitPrice,
        total: round2(item.quantity * line.unitPrice - (promo?.kind === 'quantity' ? line.promoDiscount : 0)),
        unit_price_override: item.priceIsManual ? baseUnitPrice : null,
        override_reason: null,
        free_line_description: null,
        promotion_id: line.promotionId,
        promo_discount: line.promoDiscount,
        original_unit_price: line.originalUnitPrice,
        promo_label: line.promotionId && promo ? promoBadgeLabel(promo) : null,
      }
    })
  }, [items, activePriceList, priceListOverrides, promotions])

  // Key is variant_id when present, otherwise product_id
  const adjustedByItemKey = useMemo(() => {
    const map = new Map<string, {
      unit_price: number
      total: number
      original_unit_price: number
      promo_label: string | null
      promo_discount: number
      promotion_id: string | null
    }>()
    for (const ai of adjustedItems) {
      if (ai.product_id !== null) {
        const key = ai.variant_id ?? ai.product_id
        map.set(key, {
          unit_price: ai.unit_price,
          total: ai.total,
          original_unit_price: ai.original_unit_price,
          promo_label: ai.promo_label,
          promo_discount: ai.promo_discount,
          promotion_id: ai.promotion_id,
        })
      }
    }
    return map
  }, [adjustedItems])

  const adjustedSubtotal = round2(adjustedItems.reduce((sum, i) => sum + i.total, 0))
  const discountAmount = resolveDiscountAmount(adjustedSubtotal, discountMode, discountValue)
  const adjustedTotal = Math.max(0, adjustedSubtotal - discountAmount)
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
          promotion_id: null,
          promo_discount: 0,
          promo_label: null,
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
        promotion_id: adjusted?.promotion_id ?? null,
        promo_discount: adjusted?.promo_discount ?? 0,
        promo_label: adjusted?.promo_label ?? null,
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
    const discountSnapshot = { mode: discountMode, value: discountValue }
    setShowDiscountForm(false)
    clearCart()
    showToast({
      message: 'Carrito vaciado',
      duration: 5500,
      onUndo: () => restoreCart(snapshot, discountSnapshot),
    })
  }

  function openDiscountForm() {
    setShowCustomerSearch(false)
    setShowFreeLineForm(false)
    setDiscountForm(
      discountValue > 0
        ? { mode: discountMode, value: String(discountValue) }
        : { mode: 'fixed', value: '' }
    )
    setShowDiscountForm(prev => !prev)
  }

  function applyDiscount() {
    const parsed = parseFloat(discountForm.value)
    if (isNaN(parsed) || parsed <= 0) return
    const value = discountForm.mode === 'percent' ? Math.min(parsed, 100) : parsed
    setDiscount(discountForm.mode, value)
    setShowDiscountForm(false)
  }

  function removeDiscount() {
    clearDiscount()
    setShowDiscountForm(false)
    setDiscountForm({ mode: 'fixed', value: '' })
  }

  function startPriceEdit(itemId: string, currentValue: number, mode: 'unit' | 'total') {
    if (permissions?.pos_pricing !== true) return
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
                    const adjusted = isFreeLine ? undefined : adjustedByItemKey.get(adjustedKey)
                    const effectivePrice = isFreeLine
                      ? item.unit_price
                      : (adjusted?.unit_price ?? item.unit_price)
                    const effectiveTotal = isFreeLine
                      ? item.quantity * item.unit_price
                      : (adjusted?.total ?? item.total)
                    const promoLabel = adjusted?.promo_label ?? null
                    const isEditingUnit = editingPrice?.productId === itemId && editingPrice.mode === 'unit'
                    const isEditingTotal = editingPrice?.productId === itemId && editingPrice.mode === 'total'
                    const canOverridePrice = !isFreeLine && permissions?.pos_pricing === true

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
                      : promoLabel && adjusted
                        ? adjusted.original_unit_price
                        : null

                    return (
                      <li key={itemId} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {isFreeLine && (
                              <PencilSimple size={12} className="text-primary shrink-0" />
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
                                    {canOverridePrice ? (
                                      <button
                                        type="button"
                                        onClick={() => startPriceEdit(itemId, effectivePrice, 'unit')}
                                        aria-label="Editar precio unitario"
                                        className="flex items-center gap-1 rounded-md px-1.5 py-2 -mx-1.5 -my-2 hover:bg-hover-bg transition-[background-color] duration-150 ease-[var(--ease-out)]"
                                      >
                                        <span
                                          className={`text-xs tabular-nums ${
                                            item.priceIsManual ? 'text-primary font-medium' : promoLabel ? 'text-promo font-medium' : 'text-hint'
                                          }`}
                                        >
                                          {formatMoney(effectivePrice)} c/u
                                        </span>
                                        <PencilSimple size={10} className="text-faint shrink-0" />
                                      </button>
                                    ) : (
                                      <p
                                        className={`text-xs tabular-nums ${
                                          item.priceIsManual || isFreeLine ? 'text-primary font-medium' : promoLabel ? 'text-promo font-medium' : 'text-hint'
                                        }`}
                                      >
                                        {formatMoney(effectivePrice)} c/u
                                      </p>
                                    )}
                                    {promoLabel && (
                                      <span className="text-[9px] font-semibold leading-none px-1 py-0.5 rounded bg-promo/10 text-promo whitespace-nowrap">
                                        {promoLabel}
                                      </span>
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
                                <span className={`inline-flex items-center gap-1 leading-none ${isRed ? 'text-destructive' : 'text-warning'}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isRed ? 'bg-destructive' : 'bg-warning'}`} />
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
                            className="w-8 h-8 rounded-md bg-surface hover:bg-hover-bg flex items-center justify-center transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="text-sm font-semibold w-6 text-center tabular-nums" aria-label={`${item.quantity} unidades`}>
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(itemId, item.quantity + 1)}
                            aria-label={`Agregar una unidad`}
                            className="w-8 h-8 rounded-md bg-surface hover:bg-hover-bg flex items-center justify-center transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95"
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
                          ) : canOverridePrice ? (
                            <button
                              type="button"
                              onClick={() => startPriceEdit(itemId, effectiveTotal, 'total')}
                              aria-label="Editar total"
                              className="inline-flex items-center justify-end gap-1 rounded-md px-1.5 py-1.5 -mx-1.5 -my-1.5 hover:bg-hover-bg transition-[background-color] duration-150 ease-[var(--ease-out)]"
                            >
                              <span className={`text-sm font-semibold tabular-nums ${item.priceIsManual ? 'text-primary' : 'text-heading'}`}>
                                <PopNumber value={formatMoney(effectiveTotal)} />
                              </span>
                              <PencilSimple size={10} className="text-faint shrink-0" />
                            </button>
                          ) : (
                            <p className={`text-sm font-semibold tabular-nums ${item.priceIsManual || isFreeLine ? 'text-primary' : 'text-heading'}`}>
                              <PopNumber value={formatMoney(effectiveTotal)} />
                            </p>
                          )}
                          <div className="flex justify-end mt-0.5">
                            <button
                              onClick={() => removeItem(itemId)}
                              aria-label="Quitar del carrito"
                              className="w-8 h-8 -mr-1.5 -mb-1.5 rounded-md flex items-center justify-center text-faint hover:text-destructive hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95"
                            >
                              <Trash size={14} />
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
                {!isEmpty && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={e => { handleCancelSale(); e.currentTarget.blur() }}
                      className={`text-xs py-1 transition-colors duration-150 ease-[var(--ease-out)] ${
                        isConfirmingClear
                          ? 'text-destructive font-medium'
                          : 'text-hint hover:text-destructive'
                      }`}
                    >
                      {isConfirmingClear ? '¿Vaciar carrito?' : 'Vaciar carrito'}
                    </button>
                  </div>
                )}
                <div className="flex justify-between text-subtle">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatMoney(adjustedSubtotal)}</span>
                </div>
                <div className="flex justify-between text-subtle">
                  <span>Ítems</span>
                  <span className="tabular-nums">{items.length === 0 ? '—' : items.length}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-[var(--primary-active-text)]">
                    <span>Descuento{discountMode === 'percent' ? ` (${discountValue}%)` : ''}</span>
                    <span className="tabular-nums">-{formatMoney(discountAmount)}</span>
                  </div>
                )}
              </div>

              {hasStockWarning && (
                <p className="text-xs text-warning text-center">
                  Hay ítems con stock insuficiente
                </p>
              )}

              {/* Modifier triggers — compact icon+label row */}
              {(() => {
                const canDiscount = permissions?.pos_pricing === true
                const canFreeLine = freeLineEnabled && permissions?.pos_pricing === true
                const count = 1 + (canDiscount ? 1 : 0) + (canFreeLine ? 1 : 0)
                const cols = count === 3 ? 'grid-cols-3' : count === 2 ? 'grid-cols-2' : 'grid-cols-1'
                const base = 'flex flex-col items-center justify-center gap-1 h-14 rounded-xl border text-[11px] font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]'
                const cls = (active: boolean) =>
                  `${base} ${active
                    ? 'border-primary bg-primary/10 text-[var(--primary-active-text)]'
                    : 'border-edge text-hint hover:text-body hover:border-primary/40 hover:bg-primary/5'}`
                return (
                  <div className={`grid ${cols} gap-2`}>
                    <button
                      type="button"
                      onClick={() => { setShowDiscountForm(false); setShowFreeLineForm(false); setShowCustomerSearch(v => !v) }}
                      className={cls(!!selectedCustomer || showCustomerSearch)}
                    >
                      <User size={18} />
                      Cliente
                    </button>
                    {canDiscount && (
                      <button
                        type="button"
                        onClick={openDiscountForm}
                        className={cls(discountValue > 0 || showDiscountForm)}
                      >
                        <Percent size={18} />
                        Desc.
                      </button>
                    )}
                    {canFreeLine && (
                      <button
                        type="button"
                        onClick={() => { setShowCustomerSearch(false); setShowDiscountForm(false); setShowFreeLineForm(v => !v) }}
                        className={cls(showFreeLineForm)}
                      >
                        <PencilSimple size={18} />
                        Libre
                      </button>
                    )}
                  </div>
                )
              })()}

              {/* Customer — active chip */}
              {selectedCustomer && !showCustomerSearch && (
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
                    className="w-8 h-8 -my-1.5 -mr-1.5 rounded-md flex items-center justify-center text-hint hover:text-destructive hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Customer — search form */}
              {showCustomerSearch && (
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
                              className="w-full text-left px-3 py-1.5 hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
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
                    className="h-8 w-full rounded-lg border border-edge text-sm text-hint hover:text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Discount — active chip */}
              {discountValue > 0 && discountAmount > 0 && !showDiscountForm && (
                <div className="flex items-center justify-between gap-2 w-full rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Percent size={14} className="text-primary shrink-0" />
                    <p className="text-xs font-medium text-heading truncate">
                      Descuento {discountMode === 'percent' ? `${discountValue}%` : formatMoney(discountValue)}
                      <span className="text-hint"> · -{formatMoney(discountAmount)}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={removeDiscount}
                    aria-label="Quitar descuento"
                    className="w-8 h-8 -my-1.5 -mr-1.5 rounded-md flex items-center justify-center text-hint hover:text-destructive hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Discount — form */}
              {showDiscountForm && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <p className="text-xs font-medium text-primary">Descuento</p>
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-edge bg-surface p-0.5">
                    <button
                      type="button"
                      onClick={() => setDiscountForm(f => ({ ...f, mode: 'percent' }))}
                      className={`h-7 rounded-md text-xs font-medium transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${discountForm.mode === 'percent' ? 'bg-primary text-primary-foreground' : 'text-hint hover:text-body'}`}
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountForm(f => ({ ...f, mode: 'fixed' }))}
                      className={`h-7 rounded-md text-xs font-medium transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${discountForm.mode === 'fixed' ? 'bg-primary text-primary-foreground' : 'text-hint hover:text-body'}`}
                    >
                      $
                    </button>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    autoFocus
                    placeholder="0"
                    value={discountForm.value}
                    onChange={e => setDiscountForm(f => ({ ...f, value: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') applyDiscount()
                      if (e.key === 'Escape') setShowDiscountForm(false)
                    }}
                    className="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-heading placeholder:text-hint focus:outline-none focus:border-primary tabular-nums"
                  />
                  {(() => {
                    const preview = resolveDiscountAmount(adjustedSubtotal, discountForm.mode, parseFloat(discountForm.value) || 0)
                    return (
                      <div className="space-y-0.5 text-xs">
                        <div className="flex justify-between text-subtle">
                          <span>Subtotal</span>
                          <span className="tabular-nums">{formatMoney(adjustedSubtotal)}</span>
                        </div>
                        <div className="flex justify-between text-[var(--primary-active-text)]">
                          <span>Descuento</span>
                          <span className="tabular-nums">-{formatMoney(preview)}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-heading">
                          <span>Total</span>
                          <span className="tabular-nums">{formatMoney(Math.max(0, adjustedSubtotal - preview))}</span>
                        </div>
                      </div>
                    )
                  })()}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDiscountForm(false)}
                      className="h-8 rounded-lg border border-edge text-sm text-hint hover:text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={applyDiscount}
                      disabled={!discountForm.value || parseFloat(discountForm.value) <= 0}
                      className="h-8 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-40"
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              )}

              {/* Free line — form */}
              {showFreeLineForm && freeLineEnabled && permissions?.pos_pricing === true && (
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
                      className="h-8 rounded-lg border border-edge text-sm text-hint hover:text-body hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleAddFreeLine}
                      disabled={!freeLineForm.description.trim() || !freeLineForm.price}
                      className="h-8 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-40"
                    >
                      Agregar
                    </button>
                  </div>
                </div>
              )}

              <Button
                className={`h-14 w-full rounded-xl px-5 flex items-center justify-between text-base font-semibold ${
                  hasStockWarning
                    ? 'bg-warning hover:bg-warning/90 text-warning-foreground'
                    : 'bg-primary hover:bg-primary/90 text-primary-foreground'
                }`}
                disabled={isEmpty}
                onClick={() => setShowPayment(true)}
              >
                <span>Cobrar</span>
                <PopNumber
                  className="tabular-nums text-lg font-bold"
                  value={isEmpty ? '—' : formatMoney(adjustedTotal)}
                />
              </Button>
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
          discount={discountAmount}
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

    </>
  )
})

export default CartPanel
