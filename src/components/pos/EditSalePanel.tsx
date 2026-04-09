'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PAYMENT_OPTIONS } from '@/lib/payments'

interface SaleItem {
  id: string
  product_id: string | null
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
}

interface SaleDetail {
  id: string
  subtotal: number
  discount: number
  created_at: string
  total: number
  status: string | null
  payment_method: string | null
  items: SaleItem[]
  operator_name: string | null
}

interface EditSalePanelProps {
  sale: SaleDetail
  onSave: (items: { product_id: string | null; quantity: number; unit_price: number }[], paymentMethod: string) => void
  onCancel: () => void
}

export default function EditSalePanel({
  sale,
  onSave,
  onCancel,
}: EditSalePanelProps) {
  const [items, setItems] = useState(sale.items.map(i => ({ ...i })))
  const [paymentMethod, setPaymentMethod] = useState(sale.payment_method ?? 'cash')

  function updateQty(itemId: string, qty: number) {
    if (qty < 1) return
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity: qty } : i))
  }

  function removeItem(itemId: string) {
    setItems(prev => prev.filter(i => i.id !== itemId))
  }

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-3 py-2 border-b border-edge-soft">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-heading truncate">{item.product_name}</p>
              <p className="text-xs text-hint">${item.unit_price.toLocaleString('es-AR')} c/u</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => updateQty(item.id, item.quantity - 1)}
                className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors text-xs"
              >
                −
              </button>
              <span className="text-sm font-semibold w-6 text-center tabular-nums">{item.quantity}</span>
              <button
                onClick={() => updateQty(item.id, item.quantity + 1)}
                className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors text-xs"
              >
                +
              </button>
            </div>
            <p className="text-sm font-semibold text-heading tabular-nums w-20 text-right shrink-0">
              ${(item.quantity * item.unit_price).toLocaleString('es-AR')}
            </p>
            <button
              onClick={() => removeItem(item.id)}
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
            className="h-10 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
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
