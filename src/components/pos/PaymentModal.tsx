'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CreditCard, Plus, Printer, X } from 'lucide-react'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { PaymentMethod } from '@/lib/constants/domain'
import type { ReceiptData, ReceiptItemInput, SaleItemInput } from '@/lib/printer/types'
import type { CustomerSelection } from '@/lib/types/pos'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@/lib/constants/domain'
import { useCurrency, useFormatMoney } from '@/lib/context/CurrencyContext'
import { useCartStore } from '@/lib/store/cart.store'
import { createClient } from '@/lib/supabase/client'
import { createSaleTransaction } from '@/lib/api/sales'
import { trackSale } from '@/lib/analytics'
import { ERR } from '@/lib/errors'

const PAYMENT_ICONS: Record<PaymentMethod, ReactNode> = {
  cash: '$',
  card: 'TC',
  transfer: 'TR',
  mercadopago: 'MP',
  credit: <CreditCard size={14} />,
}

const ALL_PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map(id => ({
  id,
  label: PAYMENT_METHOD_LABELS[id],
  icon: PAYMENT_ICONS[id],
  value: id,
}))

interface Props {
  businessName: string
  subtotal: number
  discount: number
  total: number
  businessId: string | null
  priceListId: string | null
  saleItems: SaleItemInput[]
  receiptItems: ReceiptItemInput[]
  operatorId: string | null
  sessionId?: string | null
  customer?: CustomerSelection | null
  onClose: () => void
  onSaleCompleted: (message: string) => void
}

export default function PaymentModal({
  businessName,
  subtotal,
  discount,
  total,
  businessId,
  priceListId,
  saleItems,
  receiptItems,
  operatorId,
  sessionId = null,
  customer = null,
  onClose,
  onSaleCompleted,
}: Props) {
  // Single-mode state
  const [primaryMethod, setPrimaryMethod] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState('')

  // Mixed-mode state
  const [isMixed, setIsMixed] = useState(false)
  const [primaryMixedAmount, setPrimaryMixedAmount] = useState('')
  const [secondaryMethod, setSecondaryMethod] = useState<PaymentMethod>('transfer')
  const [secondaryAmount, setSecondaryAmount] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)

  const { clearCart } = useCartStore()
  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()
  const currency = useCurrency()

  const creditEligible = customer?.is_credit_enabled === true
  const creditAvailable = creditEligible
    ? Math.max(0, customer!.credit_limit - customer!.credit_balance)
    : 0

  const availableMethods = useMemo(
    () => PAYMENT_METHODS.filter(method => method !== 'credit' || creditEligible),
    [creditEligible]
  )
  const availableMethodOptions = useMemo(
    () => ALL_PAYMENT_METHOD_OPTIONS.filter(m => availableMethods.includes(m.id)),
    [availableMethods]
  )
  // Mixed mode never uses credit
  const mixedAvailableMethods = useMemo(
    () => availableMethods.filter(m => m !== 'credit'),
    [availableMethods]
  )

  // Single-mode derived
  const parsedCash = Number(cashReceived)
  const validCash = Number.isFinite(parsedCash) ? parsedCash : 0
  const singleChange = primaryMethod === 'cash' && cashReceived ? Math.max(0, validCash - total) : 0
  const creditOverLimit = primaryMethod === 'credit' && total > creditAvailable
  const singleCanConfirm =
    primaryMethod === 'cash'
      ? cashReceived.trim() !== '' && validCash >= total
      : primaryMethod === 'credit'
        ? creditEligible && total > 0 && total <= creditAvailable
        : true

  // Mixed-mode derived
  const validPrimary = Number(primaryMixedAmount) || 0
  const validSecondary = Number(secondaryAmount) || 0
  const mixedTotal = validPrimary + validSecondary
  const mixedChange = Math.max(0, mixedTotal - total)
  const mixedCanConfirm = validPrimary > 0 && validSecondary > 0 && mixedTotal >= total

  const canConfirm = isMixed ? mixedCanConfirm : singleCanConfirm

  function handlePrimaryMethodChange(method: PaymentMethod) {
    setPrimaryMethod(method)
    setCashReceived('')
    if (method === secondaryMethod) {
      const next = mixedAvailableMethods.find(m => m !== method)
      if (next) setSecondaryMethod(next)
    }
  }

  function enterMixedMode() {
    setPrimaryMixedAmount('')
    setSecondaryAmount('')
    // Credit is not allowed in mixed mode
    const effectivePrimary: PaymentMethod = primaryMethod === 'credit' ? 'cash' : primaryMethod
    if (effectivePrimary !== primaryMethod) setPrimaryMethod(effectivePrimary)
    const defaultSecondary = mixedAvailableMethods.find(m => m !== effectivePrimary)!
    setSecondaryMethod(defaultSecondary)
    setIsMixed(true)
  }

  function exitMixedMode() {
    setIsMixed(false)
    setPrimaryMixedAmount('')
    setSecondaryAmount('')
  }

  const closeModal = useCallback(() => {
    clearCart()
    onClose()
  }, [clearCart, onClose])

  async function handleConfirm(openReceiptPreview: boolean, cashAmount?: number, methodOverride?: PaymentMethod) {
    if (!businessId) {
      setError(ERR.POS3)
      return
    }

    setError('')
    setLoading(true)

    const effectiveMethod = methodOverride ?? primaryMethod
    const effectiveCash = cashAmount ?? validCash
    const payments = isMixed
      ? [
          { method: primaryMethod, amount: validPrimary },
          { method: secondaryMethod, amount: validSecondary },
        ]
      : [{ method: effectiveMethod, amount: effectiveMethod === 'cash' ? effectiveCash : total }]

    try {
      const result = await createSaleTransaction(
        supabase,
        {
          businessId,
          subtotal,
          discount,
          total,
          status: 'completed',
          priceListId,
          operatorId: operatorId ?? null,
          items: saleItems.map(item => ({
            product_id: item.product_id,
            variant_id: item.variant_id ?? null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total: item.total,
            unit_price_override: item.unit_price_override,
            override_reason: item.override_reason,
            free_line_description: item.free_line_description,
          })),
          payments,
          customerId: customer?.id ?? null,
          sessionId: sessionId ?? null,
        },
        ERR.POS1
      )

      if (!result.ok) {
        setError(result.error)
        return
      }

      const change = isMixed ? mixedChange : (effectiveMethod === 'cash' ? Math.max(0, effectiveCash - total) : 0)
      const nextReceipt: ReceiptData = {
        saleId: result.data.sale_id ?? '',
        businessName,
        createdAt: result.data.created_at ?? new Date().toISOString(),
        items: receiptItems,
        subtotal,
        discount,
        total,
        paymentMethod: effectiveMethod,
        cashReceived: !isMixed && effectiveMethod === 'cash' ? effectiveCash : null,
        change,
        currency,
      }

      trackSale({
        total,
        itemCount: saleItems.length,
        paymentMethods: isMixed ? [primaryMethod, secondaryMethod] : [effectiveMethod],
        isMultiPayment: isMixed,
      })

      onSaleCompleted('Venta registrada')
      clearCart()

      if (openReceiptPreview) {
        setReceipt(nextReceipt)
      } else {
        onClose()
      }
    } catch {
      setError(ERR.POS1)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isInputFocused =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement

      if (e.key === 'Escape') {
        if (!loading) { e.preventDefault(); onClose() }
        return
      }

      // + entra al modo de pago mixto (antes del guard isMixed)
      if (e.key === '+' && !isMixed && !loading && !receipt && !isInputFocused) {
        e.preventDefault()
        enterMixedMode()
        return
      }

      if (loading || !!receipt || isMixed) return

      // Input enfocado: solo Enter confirma el monto escrito; el resto no interrumpe
      if (isInputFocused) {
        if (e.key === 'Enter') {
          e.preventDefault()
          void handleConfirm(false, validCash >= total ? validCash : total)
        }
        return
      }

      // Sin input enfocado — shortcuts completos
      // Para efectivo, Enter y P disparan aunque el campo esté vacío (monto exacto, sin vuelto)
      const cashAmt = primaryMethod === 'cash' ? (validCash >= total ? validCash : total) : undefined
      const canProceed = canConfirm || (primaryMethod === 'cash' && !isMixed)

      if (e.key === 'Enter') {
        e.preventDefault()
        if (canProceed) void handleConfirm(false, cashAmt)
        return
      }

      if (e.key === ' ') {
        e.preventDefault()
        void handleConfirm(false, undefined, 'card')
        return
      }

      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        if (canProceed) void handleConfirm(true, cashAmt)
        return
      }

      // 1–4 seleccionan método de pago
      const numIdx = parseInt(e.key) - 1
      if (numIdx >= 0 && numIdx < 4 && numIdx < availableMethods.length) {
        e.preventDefault()
        handlePrimaryMethodChange(availableMethods[numIdx])
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, receipt, isMixed, primaryMethod, validCash, total, canConfirm, availableMethods, onClose, enterMixedMode])

  return (
    <>
      {receipt ? (
        <ReceiptPreviewModal
          receipt={receipt}
          onClose={closeModal}
          autoPrintOnOpen
        />
      ) : (
        <div className="fixed inset-0 bg-foreground/40 g-black/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="surface-elevated rounded-2xl w-full max-w-sm max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
          <>
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-edge-soft">
              <div>
                <h3 className="text-base font-bold text-heading">Confirmar pago</h3>
                <p className="text-xl font-bold text-heading mt-0.5">
                  {formatMoney(total)}
                </p>
              </div>
              <button onClick={onClose} className="text-hint hover:text-body transition-colors" type="button">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <div className="p-5 space-y-4">

                {/* ── Single payment mode ── */}
                {!isMixed && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {availableMethodOptions.map((m, idx) => {
                        const isSelected = primaryMethod === m.id
                        const numKey = idx < 4 ? String(idx + 1) : null
                        const confirmKey = m.id === 'card' ? 'Esp.' : null
                        const kbdCls = `text-[10px] font-mono leading-none px-1 py-px rounded border opacity-50 border-current text-current`
                        return (
                          <button
                            key={m.id}
                            onClick={() => handlePrimaryMethodChange(m.id)}
                            type="button"
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-edge text-body hover:border-primary/40'
                            }`}
                          >
                            <span>{m.icon}</span>
                            {m.label}
                            <div className="ml-auto flex items-center gap-1">
                              {numKey && <kbd className={kbdCls}>{numKey}</kbd>}
                              {confirmKey && <kbd className={kbdCls}>{confirmKey}</kbd>}
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    {primaryMethod === 'cash' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-subtle">Monto recibido</label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={cashReceived}
                          onChange={e => setCashReceived(e.target.value)}
                          className="text-lg font-bold h-11"
                        />
                        {cashReceived && validCash >= total && (
                          <div className="flex justify-between text-sm px-1">
                            <span className="text-subtle">Vuelto</span>
                            <span className="font-bold text-emerald-600">{formatMoney(singleChange)}</span>
                          </div>
                        )}
                        {cashReceived && validCash < total && (
                          <p className="text-xs text-red-500 px-1">
                            Falta {formatMoney(total - validCash)}
                          </p>
                        )}
                      </div>
                    )}

                    {primaryMethod === 'credit' && customer && (
                      <div className="space-y-1 px-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-subtle">Crédito disponible</span>
                          <span className="font-semibold text-heading tabular-nums">{formatMoney(creditAvailable)}</span>
                        </div>
                        {creditOverLimit && (
                          <p className="text-xs text-red-500">
                            El monto supera el crédito disponible ({formatMoney(creditAvailable)})
                          </p>
                        )}
                      </div>
                    )}

                    {primaryMethod !== 'credit' && (
                      <button
                        type="button"
                        onClick={enterMixedMode}
                        className="flex items-center gap-1.5 text-sm text-primary hover:bg-primary/8 transition-colors font-medium px-2 py-1 rounded-lg -ml-2"
                      >
                        <Plus size={15} />
                        Agregar método
                        <kbd className="text-[10px] font-mono leading-none px-1 py-px rounded border opacity-50 border-current text-current">+</kbd>
                      </button>
                    )}
                  </>
                )}

                {/* ── Mixed payment mode ── */}
                {isMixed && (
                  <div className="space-y-3">
                    {/* Primary row */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-subtle">Método 1</label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <SelectDropdown
                            value={primaryMethod}
                            onChange={v => handlePrimaryMethodChange(v as PaymentMethod)}
                            options={mixedAvailableMethods.filter(m => m !== secondaryMethod).map(m => ({
                              value: m,
                              label: PAYMENT_METHOD_LABELS[m],
                            }))}
                            usePortal
                          />
                        </div>
                        <Input
                          type="number"
                          placeholder="0"
                          value={primaryMixedAmount}
                          onChange={e => setPrimaryMixedAmount(e.target.value)}
                          className="w-28 h-9 text-sm font-semibold text-right"
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Secondary row */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-subtle">Método 2</label>
                        <button
                          type="button"
                          onClick={exitMixedMode}
                          className="text-hint hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <SelectDropdown
                            value={secondaryMethod}
                            onChange={v => setSecondaryMethod(v as PaymentMethod)}
                            options={mixedAvailableMethods.filter(m => m !== primaryMethod).map(m => ({
                              value: m,
                              label: PAYMENT_METHOD_LABELS[m],
                            }))}
                            usePortal
                          />
                        </div>
                        <Input
                          type="number"
                          placeholder="0"
                          value={secondaryAmount}
                          onChange={e => setSecondaryAmount(e.target.value)}
                          className="w-28 h-9 text-sm font-semibold text-right"
                        />
                      </div>
                    </div>

                    {/* Mixed totals feedback */}
                    {(validPrimary > 0 || validSecondary > 0) && (
                      <div className="space-y-1 pt-1">
                        <div className="flex justify-between text-sm px-1">
                          <span className="text-subtle">Total recibido</span>
                          <span className="font-semibold text-heading">{formatMoney(mixedTotal)}</span>
                        </div>
                        {mixedChange > 0 && (
                          <div className="flex justify-between text-sm px-1">
                            <span className="text-subtle">Vuelto</span>
                            <span className="font-bold text-emerald-600">{formatMoney(mixedChange)}</span>
                          </div>
                        )}
                        {mixedTotal < total && validPrimary > 0 && validSecondary > 0 && (
                          <p className="text-xs text-red-500 px-1">
                            Falta {formatMoney(total - mixedTotal)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <p className="text-xs text-red-500 px-1">{error}</p>
                )}

                <div className="space-y-2">
                  <Button
                    className="relative w-full h-11 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
                    disabled={!canConfirm || loading}
                    onClick={() => handleConfirm(false)}
                  >
                    {loading ? 'Registrando...' : 'Confirmar venta'}
                    {!loading && <kbd className="absolute right-3 text-[10px] font-mono leading-none px-1 py-px rounded border opacity-50 border-current text-current">Enter</kbd>}
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full h-11 rounded-xl font-semibold"
                    disabled={!canConfirm || loading}
                    onClick={() => handleConfirm(true)}
                  >
                    <Printer />
                    {loading ? 'Preparando ticket...' : 'Confirmar e imprimir ticket'}
                    {!loading && <kbd className="ml-auto text-[10px] font-mono leading-none px-1 py-px rounded border opacity-50 border-current text-current">P</kbd>}
                  </Button>
                </div>
              </div>
            </div>
          </>
          </div>
        </div>
      )}
    </>
  )
}
