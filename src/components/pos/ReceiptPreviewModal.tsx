'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mail, Printer, Send, Share2, X } from 'lucide-react'
import ReceiptTemplate from '@/components/pos/ReceiptTemplate'
import { Button } from '@/components/ui/button'
import { PAYMENT_LABELS } from '@/lib/payments'
import { printReceiptEscPos, supportsWebSerial } from '@/lib/printer/escpos'
import type { ReceiptData } from '@/lib/printer/types'

interface Props {
  receipt: ReceiptData
  onClose: () => void
  autoPrintOnOpen?: boolean
}

function formatMoney(value: number) {
  return `$${value.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export default function ReceiptPreviewModal({ receipt, onClose, autoPrintOnOpen = false }: Props) {
  const [error, setError] = useState('')
  const [printingBrowser, setPrintingBrowser] = useState(false)
  const [printingDirect, setPrintingDirect] = useState(false)
  const [sharing, setSharing] = useState(false)
  const autoPrintTriggered = useRef(false)

  const directPrintAvailable = useMemo(() => supportsWebSerial(), [])
  const nativeShareAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const openBrowserPrint = useCallback(async () => {
    setPrintingBrowser(true)
    try {
      await new Promise(resolve => window.setTimeout(resolve, 120))
      window.print()
    } finally {
      setPrintingBrowser(false)
    }
  }, [])

  useEffect(() => {
    if (!autoPrintOnOpen || autoPrintTriggered.current) return

    autoPrintTriggered.current = true
    window.setTimeout(() => {
      openBrowserPrint().catch(printError => {
        console.error(printError)
        setError('No se pudo abrir la impresion del ticket.')
      })
    }, 80)
  }, [autoPrintOnOpen, openBrowserPrint])

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

  async function handleBrowserPrint() {
    setError('')
    try {
      await openBrowserPrint()
    } catch (printError) {
      console.error(printError)
      setError('No se pudo abrir el dialogo de impresion.')
    }
  }

  async function handleDirectPrint() {
    setError('')
    setPrintingDirect(true)

    try {
      await printReceiptEscPos(receipt)
    } catch (printError) {
      console.error(printError)
      setError(printError instanceof Error ? printError.message : 'No se pudo imprimir directo en la termica.')
    } finally {
      setPrintingDirect(false)
    }
  }

  async function handleNativeShare() {
    if (!nativeShareAvailable) return

    setSharing(true)
    try {
      await navigator.share({
        title: `Ticket ${receipt.saleId.slice(0, 8).toUpperCase()}`,
        text: buildShareText(receipt),
      })
    } catch (shareError) {
      if (!(shareError instanceof Error) || shareError.name !== 'AbortError') {
        console.error(shareError)
        setError('No se pudo abrir el menu de compartir.')
      }
    } finally {
      setSharing(false)
    }
  }

  function openWhatsAppShare() {
    const url = `https://wa.me/?text=${encodeURIComponent(buildShareText(receipt))}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function openEmailShare() {
    const subject = `Ticket ${receipt.saleId.slice(0, 8).toUpperCase()} - ${receipt.businessName}`
    const body = buildShareText(receipt)
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="surface-elevated rounded-2xl w-full max-w-sm max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold text-heading">Vista previa del ticket</p>
                <p className="text-sm text-subtle">
                  Podes imprimirlo, guardarlo como PDF o compartirlo.
                </p>
              </div>
              <button
                onClick={onClose}
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
                {printingBrowser ? 'Abriendo impresion...' : 'Imprimir / PDF'}
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
                onClick={onClose}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
