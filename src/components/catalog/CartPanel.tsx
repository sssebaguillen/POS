'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Minus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CatalogCartItem } from '@/components/catalog/types'

interface CartPanelProps {
  businessName: string
  businessWhatsapp: string | null
  cartItems: CatalogCartItem[]
  onIncreaseQuantity: (productId: string) => void
  onDecreaseQuantity: (productId: string) => void
  onRemoveItem: (productId: string) => void
  onClearCart: () => void
}

type DeliveryType = 'take-away' | 'delivery'

const currencyFormatter = new Intl.NumberFormat('es-AR')

export default function CartPanel({
  businessName,
  businessWhatsapp,
  cartItems,
  onIncreaseQuantity,
  onDecreaseQuantity,
  onRemoveItem,
  onClearCart,
}: CartPanelProps) {
  const [customerName, setCustomerName] = useState('')
  const [orderSent, setOrderSent] = useState(false)
  const [customerPhone, setCustomerPhone] = useState('')
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('take-away')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')

  const subtotal = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.product.price * item.quantity, 0),
    [cartItems]
  )

  const total = subtotal

  const trimmedName = customerName.trim()
  const trimmedPhone = customerPhone.trim()
  const trimmedAddress = address.trim()
  const trimmedNotes = notes.trim()
  const normalizedWhatsapp = businessWhatsapp?.trim() ?? ''

  const hasRequiredFormData =
    trimmedName.length > 0 &&
    trimmedPhone.length > 0 &&
    (deliveryType === 'take-away' || trimmedAddress.length > 0)

  const canSendWhatsapp =
    cartItems.length > 0 &&
    hasRequiredFormData &&
    normalizedWhatsapp.length > 0

  function buildMessage(): string {
    const itemsText = cartItems
      .map(item => {
        const lineTotal = item.product.price * item.quantity
        return `${item.quantity}x ${item.product.name} - $${currencyFormatter.format(lineTotal)}`
      })
      .join('\n')

    const lines: string[] = [
      'Hola! Quisiera hacer un pedido:',
      '',
      itemsText,
      '',
      `Total: $${currencyFormatter.format(total)}`,
      `Nombre: ${trimmedName}`,
      `Telefono: ${trimmedPhone}`,
      `Entrega: ${deliveryType === 'delivery' ? 'Delivery' : 'Take away'}`,
    ]

    if (deliveryType === 'delivery') {
      lines.push(`Direccion: ${trimmedAddress}`)
    }

    if (trimmedNotes) {
      lines.push(`Notas: ${trimmedNotes}`)
    }

    return lines.join('\n')
  }

  function handleSendWhatsapp() {
    if (!canSendWhatsapp) return

    const message = buildMessage()
    const encodedMessage = encodeURIComponent(message)
    const url = `https://wa.me/${normalizedWhatsapp}?text=${encodedMessage}`

    window.open(url, '_blank', 'noopener,noreferrer')
    setOrderSent(true)
  }

  function handleNewOrder() {
    setCustomerName('')
    setCustomerPhone('')
    setDeliveryType('take-away')
    setAddress('')
    setNotes('')
    setOrderSent(false)
    onClearCart()
  }

  if (orderSent) {
    return (
      <aside className="rounded-xl border border-border/70 bg-card p-4 md:p-5 lg:sticky lg:top-6">
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <div>
            <p className="text-base font-semibold text-foreground">Pedido enviado</p>
            <p className="mt-1 text-sm text-muted-foreground">Revisa tu WhatsApp para continuar con el pedido.</p>
          </div>
          <Button type="button" className="w-full" onClick={handleNewOrder}>
            Nuevo pedido
          </Button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="rounded-xl border border-border/70 bg-card p-4 md:p-5 lg:sticky lg:top-6">
      <h2 className="text-base font-semibold text-foreground">Tu pedido</h2>
      <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{businessName}</p>

      <div className="mt-4 space-y-3">
        {cartItems.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Tu carrito esta vacio.
          </div>
        )}

        {cartItems.length > 0 && (
          <ul className="space-y-2">
            {cartItems.map(item => (
              <li key={item.product.id} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.product.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      ${currencyFormatter.format(item.product.price * item.quantity)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.product.id)}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Quitar ${item.product.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => onDecreaseQuantity(item.product.id)}
                    aria-label={`Restar ${item.product.name}`}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>

                  <span className="w-8 text-center text-sm font-medium text-foreground">{item.quantity}</span>

                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => onIncreaseQuantity(item.product.id)}
                    disabled={item.quantity >= item.product.stock}
                    aria-label={`Sumar ${item.product.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Subtotal</span>
          <span>${currencyFormatter.format(subtotal)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-base font-bold text-foreground">
          <span>Total</span>
          <span>${currencyFormatter.format(total)}</span>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="catalog-name" className="text-xs uppercase tracking-wide text-muted-foreground">
            Nombre
          </label>
          <Input
            id="catalog-name"
            value={customerName}
            onChange={event => setCustomerName(event.target.value)}
            placeholder="Tu nombre"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="catalog-phone" className="text-xs uppercase tracking-wide text-muted-foreground">
            Telefono
          </label>
          <Input
            id="catalog-phone"
            value={customerPhone}
            onChange={event => setCustomerPhone(event.target.value)}
            placeholder="Tu telefono"
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Entrega</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDeliveryType('take-away')}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                deliveryType === 'take-away'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:border-primary/40'
              }`}
            >
              Take away
            </button>
            <button
              type="button"
              onClick={() => setDeliveryType('delivery')}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                deliveryType === 'delivery'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:border-primary/40'
              }`}
            >
              Delivery
            </button>
          </div>
        </div>

        {deliveryType === 'delivery' && (
          <div className="space-y-1.5">
            <label htmlFor="catalog-address" className="text-xs uppercase tracking-wide text-muted-foreground">
              Direccion
            </label>
            <Input
              id="catalog-address"
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder="Calle y numero"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="catalog-notes" className="text-xs uppercase tracking-wide text-muted-foreground">
            Notas
          </label>
          <textarea
            id="catalog-notes"
            value={notes}
            onChange={event => setNotes(event.target.value)}
            placeholder="Opcional"
            rows={3}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      </div>

      {!normalizedWhatsapp && (
        <p className="mt-3 text-xs text-muted-foreground">
          Este negocio todavia no configuro su numero de WhatsApp.
        </p>
      )}

      <Button
        type="button"
        className="mt-4 h-10 w-full"
        onClick={handleSendWhatsapp}
        disabled={!canSendWhatsapp}
      >
        Enviar pedido por WhatsApp
      </Button>
    </aside>
  )
}