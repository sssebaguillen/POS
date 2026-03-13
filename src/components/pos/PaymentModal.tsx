'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCartStore } from '@/lib/store/cart.store'
import { createClient } from '@/lib/supabase/client'

type PaymentMethod = 'cash' | 'card' | 'transfer' | 'mercadopago'

interface Props {
  total: number
  businessId: string | null
  onClose: () => void
}

export default function PaymentModal({ total, businessId, onClose }: Props) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const { items, clearCart } = useCartStore()
  const supabase = createClient()

  const change = method === 'cash' && cashReceived
    ? Math.max(0, parseFloat(cashReceived) - total)
    : 0

  const canConfirm = method !== 'cash' || (parseFloat(cashReceived) >= total)

  async function handleConfirm() {
    if (!businessId) {
      setError('No se pudo identificar el negocio actual. Iniciá sesión nuevamente.')
      return
    }

    setError('')
    setLoading(true)

    // 1. Crear la venta
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .insert({
        business_id: businessId,
        subtotal: total,
        discount: 0,
        total,
        status: 'completed',
      })
      .select()
      .single()

    if (saleError || !sale) {
      console.error(saleError)
      setError(saleError?.message ?? 'No se pudo registrar la venta')
      setLoading(false)
      return
    }

    // 2. Insertar items
    const { error: saleItemsError } = await supabase.from('sale_items').insert(
      items.map(item => ({
        sale_id: sale.id,
        product_id: item.product.id,
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

    // 3. Registrar pago
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

    setSuccess(true)
    setLoading(false)

    setTimeout(() => {
      clearCart()
      onClose()
    }, 1200)
  }

  const methods: { id: PaymentMethod; label: string; icon: string }[] = [
    { id: 'cash', label: 'Efectivo', icon: '$' },
    { id: 'card', label: 'Tarjeta', icon: 'TC' },
    { id: 'transfer', label: 'Transferencia', icon: 'TR' },
    { id: 'mercadopago', label: 'MercadoPago', icon: 'MP' },
  ]

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm">
        {success ? (
          <div className="p-10 flex flex-col items-center justify-center text-center">
            <div className="text-5xl mb-3">OK</div>
            <p className="text-lg font-bold text-heading">¡Venta registrada!</p>
            {method === 'cash' && change > 0 && (
              <p className="text-sm text-subtle mt-1">
                Vuelto: <span className="font-bold text-heading">${change.toLocaleString('es-AR')}</span>
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-edge-soft">
              <div>
                <h3 className="text-base font-bold text-heading">Confirmar pago</h3>
                <p className="text-xl font-bold text-heading mt-0.5">
                  ${total.toLocaleString('es-AR')}
                </p>
              </div>
              <button onClick={onClose} className="text-hint hover:text-body transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Método de pago */}
              <div className="grid grid-cols-2 gap-2">
                {methods.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      method === m.id
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-edge text-body hover:border-emerald-300'
                    }`}
                  >
                    <span>{m.icon}</span>
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Efectivo: campo monto recibido */}
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
                  {cashReceived && parseFloat(cashReceived) >= total && (
                    <div className="flex justify-between text-sm px-1">
                      <span className="text-subtle">Vuelto</span>
                      <span className="font-bold text-heading">
                        ${change.toLocaleString('es-AR')}
                      </span>
                    </div>
                  )}
                  {cashReceived && parseFloat(cashReceived) < total && (
                    <p className="text-xs text-red-500 px-1">
                      Falta ${(total - parseFloat(cashReceived)).toLocaleString('es-AR')}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p className="text-xs text-red-500 px-1">{error}</p>
              )}

              {/* Confirm */}
              <Button
                className="w-full h-11 font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl"
                disabled={!canConfirm || loading}
                onClick={handleConfirm}
              >
                {loading ? 'Registrando...' : 'Confirmar venta'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
