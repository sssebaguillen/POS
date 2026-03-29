'use client'

import { useCallback, useMemo, useState } from 'react'
import { Mail, Printer, Send, Share2, X } from 'lucide-react'
import ReceiptTemplate from '@/components/pos/ReceiptTemplate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PAYMENT_LABELS } from '@/lib/payments'
import { printReceiptEscPos, supportsWebSerial } from '@/lib/printer/escpos'
import type { PaymentMethod, ReceiptData, ReceiptItemInput, SaleItemInput } from '@/lib/printer/types'
import { useCartStore } from '@/lib/store/cart.store'
import { createClient } from '@/lib/supabase/client'

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
  const [printingBrowser, setPrintingBrowser] = useState(false)
  const [printingDirect, setPrintingDirect] = useState(false)
  const [sharing, setSharing] = useState(false)
  const { clearCart } = useCartStore()
  const supabase = useMemo(() => createClient(), [])

  const parsedCashReceived = Number(cashReceived)
  const validCashReceived = Number.isFinite(parsedCashReceived) ? parsedCashReceived : 0
  const directPrintAvailable = useMemo(() => supportsWebSerial(), [])
  const nativeShareAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const change = method === 'cash' && cashReceived
    ? Math.max(0, validCashReceived - total)
    : 0

  const canConfirm = method !== 'cash' || (cashReceived.trim() !== '' && validCashReceived >= total)

  const closeModal = useCallback(() => {
    clearCart()
    onClose()
  }, [clearCart, onClose])

  const openBrowserPrint = useCallback(async () => {
    setPrintingBrowser(true)
    try {
      await new Promise(resolve => window.setTimeout(resolve, 120))
      window.print()
    } finally {
      setPrintingBrowser(false)
    }
  }, [])

  function buildShareText(currentReceipt: ReceiptData) {
    const lines = [
      `${currentReceipt.businessName}`,
      `Ticket #${currentReceipt.saleId.slice(0, 8).toUpperCase()}`,
      `Fecha: ${new Date(currentReceipt.createdAt).toLocaleString('es-AR')}`,
      '',
      ...currentReceipt.items.map(item => `- ${item.quantity}x ${item.name} ${formatMoney(item.total)}`),
      '',
      `Subtotal: ${formatMoney(currentReceipt.subtotal)}`,
    ]

    if (currentReceipt.discount > 0) {
      lines.push(`Descuento: -${formatMoney(currentReceipt.discount)}`)
    }

    lines.push(`Total: ${formatMoney(currentReceipt.total)}`)
    lines.push(`Pago: ${PAYMENT_LABELS[currentReceipt.paymentMethod] ?? currentReceipt.paymentMethod}`)

    if (currentReceipt.paymentMethod === 'cash' && currentReceipt.cashReceived !== null) {
      lines.push(`Recibido: ${formatMoney(currentReceipt.cashReceived)}`)
      lines.push(`Vuelto: ${formatMoney(currentReceipt.change)}`)
    }

    return lines.join('\n')
  }

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
      window.setTimeout(() => {
        openBrowserPrint().catch(printError => {
          console.error(printError)
          setError('No se pudo abrir la impresión del ticket.')
        })
      }, 80)
    } else {
      onClose()
    }
  }

  async function handleBrowserPrint() {
    if (!receipt) return

    setError('')
    try {
      await openBrowserPrint()
    } catch (printError) {
      console.error(printError)
      setError('No se pudo abrir el diálogo de impresión.')
    }
  }

  async function handleDirectPrint() {
    if (!receipt) return

    setError('')
    setPrintingDirect(true)

    try {
      await printReceiptEscPos(receipt)
    } catch (printError) {
      console.error(printError)
      setError(printError instanceof Error ? printError.message : 'No se pudo imprimir directo en la térmica.')
    } finally {
      setPrintingDirect(false)
    }
  }

  async function handleNativeShare() {
    if (!receipt || !nativeShareAvailable) return

    setSharing(true)
    try {
      await navigator.share({
        title: `Ticket ${receipt.saleId.slice(0, 8).toUpperCase()}`,
        text: buildShareText(receipt),
      })
    } catch (shareError) {
      if (!(shareError instanceof Error) || shareError.name !== 'AbortError') {
        console.error(shareError)
        setError('No se pudo abrir el menú de compartir.')
      }
    } finally {
      setSharing(false)
    }
  }

  function openWhatsAppShare() {
    if (!receipt) return
    const url = `https://wa.me/?text=${encodeURIComponent(buildShareText(receipt))}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function openEmailShare() {
    if (!receipt) return
    const subject = `Ticket ${receipt.saleId.slice(0, 8).toUpperCase()} - ${receipt.businessName}`
    const body = buildShareText(receipt)
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  const methods: { id: PaymentMethod; label: string; icon: string }[] = [
    { id: 'cash', label: 'Efectivo', icon: '$' },
    { id: 'card', label: 'Tarjeta', icon: 'TC' },
    { id: 'transfer', label: 'Transferencia', icon: 'TR' },
    { id: 'mercadopago', label: 'MercadoPago', icon: 'MP' },
  ]

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="surface-elevated rounded-2xl w-full max-w-sm max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        {receipt ? (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-heading">Vista previa del ticket</p>
                  <p className="text-sm text-subtle">
                    Podés imprimirlo, guardarlo como PDF o compartirlo.
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className="text-hint hover:text-body transition-colors"
                  type="button"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="rounded-xl border border-edge-soft bg-surface p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-subtle">Ticket</span>
                  <span className="font-semibold text-heading">#{receipt.saleId.slice(0, 8).toUpperCase()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-subtle">Total</span>
                  <span className="font-semibold text-heading">{formatMoney(receipt.total)}</span>
                </div>
              </div>

              <ReceiptTemplate receipt={receipt} showPreview />

              {error && (
                <p className="text-xs text-red-500 px-1">{error}</p>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  className="w-full h-11 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
                  disabled={printingBrowser || printingDirect || sharing}
                  onClick={handleBrowserPrint}
                >
                  <Printer />
                  {printingBrowser ? 'Abriendo impresión...' : 'Imprimir / PDF'}
                </Button>

                {directPrintAvailable && (
                  <Button
                    variant="outline"
                    className="w-full h-11 rounded-xl font-semibold"
                    disabled={printingBrowser || printingDirect || sharing}
                    onClick={handleDirectPrint}
                  >
                    <Printer />
                    {printingDirect ? 'Imprimiendo directo...' : 'Imprimir directo (ESC/POS)'}
                  </Button>
                )}

                {nativeShareAvailable && (
                  <Button
                    variant="outline"
                    className="w-full h-11 rounded-xl font-semibold"
                    disabled={printingBrowser || printingDirect || sharing}
                    onClick={handleNativeShare}
                  >
                    <Share2 />
                    {sharing ? 'Abriendo compartir...' : 'Compartir'}
                  </Button>
                )}

                <Button
                  variant="outline"
                  className="w-full h-11 rounded-xl font-semibold"
                  disabled={printingBrowser || printingDirect || sharing}
                  onClick={openWhatsAppShare}
                >
                  <Send />
                  WhatsApp
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-11 rounded-xl font-semibold"
                  disabled={printingBrowser || printingDirect || sharing}
                  onClick={openEmailShare}
                >
                  <Mail />
                  Email
                </Button>

                <Button
                  variant="cancel"
                  className="w-full h-11 rounded-xl font-medium sm:col-span-2"
                  disabled={printingBrowser || printingDirect || sharing}
                  onClick={closeModal}
                >
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        ) : (
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
                  {methods.map(m => (
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
        )}
      </div>
    </div>
  )
}
