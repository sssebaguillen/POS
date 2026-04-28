'use client'

import { useCallback, useMemo, useState } from 'react'
import { Plus, Printer, X } from 'lucide-react'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { PaymentMethod, ReceiptData, ReceiptItemInput, SaleItemInput } from '@/lib/printer/types'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@/lib/constants/domain'
import { useCurrency, useFormatMoney } from '@/lib/context/CurrencyContext'
import { useCartStore } from '@/lib/store/cart.store'
import { createClient } from '@/lib/supabase/client'
import { trackSale } from '@/lib/analytics'

const PAYMENT_ICONS: Record<PaymentMethod, string> = {
  cash: '$',
  card: 'TC',
  transfer: 'TR',
  mercadopago: 'MP',
  credit: 'CR',
}

const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map(id => ({
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

  // Single-mode derived
  const parsedCash = Number(cashReceived)
  const validCash = Number.isFinite(parsedCash) ? parsedCash : 0
  const singleChange = primaryMethod === 'cash' && cashReceived ? Math.max(0, validCash - total) : 0
  const singleCanConfirm = primaryMethod !== 'cash' || (cashReceived.trim() !== '' && validCash >= total)

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
      const next = PAYMENT_METHODS.find(m => m !== method)
      if (next) setSecondaryMethod(next)
    }
  }

  function enterMixedMode() {
    setPrimaryMixedAmount('')
    setSecondaryAmount('')
    const defaultSecondary = PAYMENT_METHODS.find(m => m !== primaryMethod)!
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

  async function handleConfirm(openReceiptPreview: boolean) {
    if (!businessId) {
      setError('No se pudo identificar el negocio actual. Iniciá sesión nuevamente.')
      return
    }

    setError('')
    setLoading(true)

    const payments = isMixed
      ? [
          { method: primaryMethod, amount: validPrimary },
          { method: secondaryMethod, amount: validSecondary },
        ]
      : [{ method: primaryMethod, amount: primaryMethod === 'cash' ? validCash : total }]

    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_sale_transaction', {
      p_business_id: businessId,
      p_subtotal: subtotal,
      p_discount: discount,
      p_total: total,
      p_status: 'completed',
      p_price_list_id: priceListId,
      p_operator_id: operatorId ?? null,
      p_items: saleItems.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        unit_price_override: item.unit_price_override,
        override_reason: item.override_reason,
      })),
      p_payments: payments,
    })

    const result = rpcResult as { success: boolean; sale_id?: string; created_at?: string; error?: string } | null

    if (rpcError || !result?.success) {
      const msg = result?.error ?? rpcError?.message ?? 'No se pudo registrar la venta'
      console.error(msg)
      setError(msg)
      setLoading(false)
      return
    }

    const change = isMixed ? mixedChange : singleChange
    const nextReceipt: ReceiptData = {
      saleId: result.sale_id ?? '',
      businessName,
      createdAt: result.created_at ?? new Date().toISOString(),
      items: receiptItems,
      subtotal,
      discount,
      total,
      paymentMethod: primaryMethod,
      cashReceived: !isMixed && primaryMethod === 'cash' ? validCash : null,
      change,
      currency,
    }

    trackSale({
      total,
      itemCount: saleItems.length,
      paymentMethods: isMixed ? [primaryMethod, secondaryMethod] : [primaryMethod],
      isMultiPayment: isMixed,
    })

    onSaleCompleted('Venta registrada')
    clearCart()
    setLoading(false)

    if (openReceiptPreview) {
      setReceipt(nextReceipt)
    } else {
      onClose()
    }
  }

  return (
    <>
      {receipt ? (
        <ReceiptPreviewModal
          receipt={receipt}
          onClose={closeModal}
          autoPrintOnOpen
        />
      ) : (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
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
                      {PAYMENT_METHOD_OPTIONS.map(m => (
                        <button
                          key={m.id}
                          onClick={() => handlePrimaryMethodChange(m.id)}
                          type="button"
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                            primaryMethod === m.id
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-edge text-body hover:border-primary/40'
                          }`}
                        >
                          <span>{m.icon}</span>
                          {m.label}
                        </button>
                      ))}
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
                          autoFocus
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

                    <button
                      type="button"
                      onClick={enterMixedMode}
                      className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                    >
                      <Plus size={15} />
                      Agregar método
                    </button>
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
                            options={PAYMENT_METHODS.filter(m => m !== secondaryMethod).map(m => ({
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
                            options={PAYMENT_METHODS.filter(m => m !== primaryMethod).map(m => ({
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
                    className="w-full h-11 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
                    disabled={!canConfirm || loading}
                    onClick={() => handleConfirm(false)}
                  >
                    {loading ? 'Registrando...' : 'Confirmar venta'}
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full h-11 rounded-xl font-semibold"
                    disabled={!canConfirm || loading}
                    onClick={() => handleConfirm(true)}
                  >
                    <Printer />
                    {loading ? 'Preparando ticket...' : 'Confirmar e imprimir ticket'}
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
