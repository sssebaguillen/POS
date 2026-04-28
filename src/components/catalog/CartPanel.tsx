'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { AlertTriangle, CheckCircle2, ImageIcon, Minus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CatalogCartItem } from '@/components/catalog/types'
import posthog from 'posthog-js'

function CartItemImage({ imageUrl, name }: { imageUrl: string; name: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-pulse rounded-md bg-muted/60" />}
      <Image
        src={imageUrl}
        alt={name}
        fill
        unoptimized
        className={`object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        sizes="40px"
        onLoad={() => setLoaded(true)}
      />
    </>
  )
}

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
      `Teléfono: ${trimmedPhone}`,
      `Entrega: ${deliveryType === 'delivery' ? 'Delivery' : 'Para llevar'}`,
    ]

    if (deliveryType === 'delivery') {
      lines.push(`Dirección: ${trimmedAddress}`)
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

    posthog.capture('catalog_order_sent', {
      total,
      item_count: cartItems.length,
      delivery_type: deliveryType,
      business_name: businessName,
    })

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
      <aside className="rounded-xl border border-border/70 bg-card p-4 md:p-5 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
          <div>
            <p className="text-base font-semibold text-foreground">Pedido enviado</p>
            <p className="mt-1 text-sm text-muted-foreground">Revisá tu WhatsApp para continuar con el pedido.</p>
          </div>
          <Button type="button" className="w-full" onClick={handleNewOrder}>
            Nuevo pedido
          </Button>
        </div>
      </aside>
    )
  }

  const isEmpty = cartItems.length === 0

  return (
    <aside className="rounded-xl border border-border/70 bg-card p-4 md:p-5 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
      <h2 className="text-base font-semibold text-foreground">Tu pedido</h2>
      <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{businessName}</p>

      <div className="mt-4 space-y-3">
        {isEmpty ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Tu carrito está vacío.
          </div>
        ) : (
          <ul className="space-y-2">
            {cartItems.map(item => (
              <li key={item.product.id} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-start gap-2.5">
                  {/* Thumbnail */}
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted/40">
                    {item.product.imageUrl ? (
                      <CartItemImage imageUrl={item.product.imageUrl} name={item.product.name} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                    )}
                  </div>

                  {/* Name, price, remove */}
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-medium text-foreground">{item.product.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        ${currencyFormatter.format(item.product.price * item.quantity)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.product.id)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Quitar ${item.product.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Quantity controls */}
                <div className="mt-2.5 flex items-center gap-2">
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

      {!isEmpty && (
        <>
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
                Teléfono
              </label>
              <Input
                id="catalog-phone"
                value={customerPhone}
                onChange={event => setCustomerPhone(event.target.value)}
                placeholder="Tu teléfono"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Entrega</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryType('take-away')}
                  className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                    deliveryType === 'take-away'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-primary/40'
                  }`}
                >
                  Para llevar
                </button>
                <button
                  type="button"
                  onClick={() => setDeliveryType('delivery')}
                  className={`rounded-full border px-3 py-2 text-sm transition-colors ${
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
                  Dirección
                </label>
                <Input
                  id="catalog-address"
                  value={address}
                  onChange={event => setAddress(event.target.value)}
                  placeholder="Calle y número"
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
        </>
      )}

      {!normalizedWhatsapp && (
        <div className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800/40 dark:bg-amber-950/30 ${isEmpty ? 'mt-4' : 'mt-3'}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Este negocio todavía no configuró su número de WhatsApp. No es posible enviar pedidos por ahora.
          </p>
        </div>
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
