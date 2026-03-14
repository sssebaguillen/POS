'use client'

import { useEffect, useState } from 'react'
import { Trash2, Plus, Minus, Barcode, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCartStore } from '@/lib/store/cart.store'
import PaymentModal from '@/components/pos/PaymentModal'
import { createClient } from '@/lib/supabase/client'

type RightTab = 'current' | 'history'

interface SaleRow {
  id: string
  created_at: string
  total: number
  status: string | null
  payment_method: string | null
}

interface Props {
  businessId: string | null
}

export default function CartPanel({ businessId }: Props) {
  const { items, removeItem, updateQuantity, subtotal, total, discount, clearCart } = useCartStore()
  const [showPayment, setShowPayment] = useState(false)
  const [activeTab, setActiveTab] = useState<RightTab>('current')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [history, setHistory] = useState<SaleRow[]>([])
  const [historyQuery, setHistoryQuery] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const supabase = createClient()

  const isEmpty = items.length === 0

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
        .select('id, total, status, created_at')
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

  function handleCancelSale() {
    clearCart()
  }

  function formatTime(dateString: string) {
    return new Date(dateString).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function normalizePayment(method: string | null) {
    if (!method) return 'sin dato'
    const map: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      transfer: 'Transferencia',
      mercadopago: 'MercadoPago',
      credit: 'Credito',
    }
    return map[method] ?? method
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
      <div className="flex flex-col h-full">
        {/* Tabs */}
        <div className="border-b border-edge/60">
          <div className="grid grid-cols-2">
            <button
              onClick={() => setActiveTab('current')}
              className={`h-11 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'current'
                  ? 'text-primary border-primary'
                  : 'text-hint border-transparent hover:text-body'
              }`}
            >
              Venta actual
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`h-11 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'history'
                  ? 'text-primary border-primary'
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
              <span className="rounded-full bg-primary/10 text-primary text-xs px-2.5 py-1 font-medium">
                {items.length} items
              </span>
            </div>

            {/* Barcode scanner */}
            <div className="px-4 pb-3">
              <div className="relative">
                <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <Input
                  value={barcodeInput}
                  onChange={e => setBarcodeInput(e.target.value)}
                  placeholder="Escanear código de barras..."
                  className="h-9 pl-10 rounded-xl border-edge bg-surface-alt text-sm"
                />
              </div>
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
                        <p className="text-xs text-hint mt-0.5">
                          ${item.unit_price.toLocaleString('es-AR')} c/u
                        </p>
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
                          ${item.total.toLocaleString('es-AR')}
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
                  <span className="tabular-nums">${subtotal().toLocaleString('es-AR')}</span>
                </div>
                <div className="flex justify-between text-subtle">
                  <span>Ítems</span>
                  <span className="tabular-nums">{items.length === 0 ? '—' : items.length}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-primary">
                    <span>Descuento</span>
                    <span className="tabular-nums">-${discount.toLocaleString('es-AR')}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-heading text-2xl pt-2 border-t border-edge-soft leading-none">
                  <span>Total</span>
                  <span className="tabular-nums">${total().toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
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
                  className="h-10 rounded-xl text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
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
            </div>

            <div className="flex-1 overflow-y-auto">
              {historyLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-hint">Cargando historial...</div>
              ) : filteredHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-hint">No hay ventas para mostrar</div>
              ) : (
                <ul className="divide-y divide-edge-soft">
                  {filteredHistory.map(sale => (
                    <li key={sale.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-heading">{formatTime(sale.created_at)}</p>
                          <p className="text-xs text-subtle">{normalizePayment(sale.payment_method)} · {sale.status ?? 'completed'}</p>
                        </div>
                        <p className="text-sm font-semibold text-heading">${sale.total.toLocaleString('es-AR')}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {showPayment && (
        <PaymentModal
          total={total()}
          businessId={businessId}
          onClose={() => setShowPayment(false)}
        />
      )}
    </>
  )
}
