'use client'

import { useCallback, useMemo, useState } from 'react'
import { Printer, X } from 'lucide-react'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PaymentMethod, ReceiptData, ReceiptItemInput, SaleItemInput } from '@/lib/printer/types'
import { useCartStore } from '@/lib/store/cart.store'
import { createClient } from '@/lib/supabase/client'
import { PAYMENT_LABELS } from '@/lib/payments'

const PAYMENT_ICONS: Record<PaymentMethod, string> = {
  cash: '$',
  card: 'TC',
  transfer: 'TR',
  mercadopago: 'MP',
  credit: 'CR',
}

const POS_METHODS: PaymentMethod[] = ['cash', 'card', 'transfer', 'mercadopago']

const PAYMENT_METHOD_OPTIONS = POS_METHODS.map(id => ({
  id,
  label: PAYMENT_LABELS[id],
  icon: PAYMENT_ICONS[id],
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

function formatMoney(value: number) {
  return `$${value.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const { clearCart } = useCartStore()
  const supabase = useMemo(() => createClient(), [])

  const parsedCashReceived = Number(cashReceived)
  const validCashReceived = Number.isFinite(parsedCashReceived) ? parsedCashReceived : 0

  const change = method === 'cash' && cashReceived
    ? Math.max(0, validCashReceived - total)
    : 0

  const canConfirm = method !== 'cash' || (cashReceived.trim() !== '' && validCashReceived >= total)

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

    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .insert({
        business_id: businessId,
        subtotal,
        discount,
        total,
        status: 'completed',
        price_list_id: priceListId,
        operator_id: operatorId ?? null,
      })
      .select('id, created_at')
      .single()

    if (saleError || !sale) {
      console.error(saleError)
      setError(saleError?.message ?? 'No se pudo registrar la venta')
      setLoading(false)
      return
    }

    const { error: saleItemsError } = await supabase.from('sale_items').insert(
      saleItems.map(item => ({
        sale_id: sale.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
      }))
    )

    if (saleItemsError) {
      console.error(saleItemsError)
      setError(saleItemsError.message)
      setLoading(false)
      return
    }

    const { error: paymentError } = await supabase.from('payments').insert({
      sale_id: sale.id,
      method,
      amount: total,
      status: 'completed',
    })

    if (paymentError) {
      console.error(paymentError)
      setError(paymentError.message)
      setLoading(false)
      return
    }

    const nextReceipt: ReceiptData = {
      saleId: sale.id,
      businessName,
      createdAt: sale.created_at ?? new Date().toISOString(),
      items: receiptItems,
      subtotal,
      discount,
      total,
      paymentMethod: method,
      cashReceived: method === 'cash' ? validCashReceived : null,
      change,
    }

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
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHOD_OPTIONS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setMethod(m.id)}
                      type="button"
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                        method === m.id
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-edge text-body hover:border-primary/40'
                      }`}
                    >
                      <span>{m.icon}</span>
                      {m.label}
                    </button>
                  ))}
                </div>

                {method === 'cash' && (
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
                    {cashReceived && validCashReceived >= total && (
                      <div className="flex justify-between text-sm px-1">
                        <span className="text-subtle">Vuelto</span>
                        <span className="font-bold text-heading">
                          {formatMoney(change)}
                        </span>
                      </div>
                    )}
                    {cashReceived && validCashReceived < total && (
                      <p className="text-xs text-red-500 px-1">
                        Falta {formatMoney(total - validCashReceived)}
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <p className="text-xs text-red-500 px-1">{error}</p>
                )}

                <div className="space-y-2">
                  <Button
                    className="w-full h-11 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
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
