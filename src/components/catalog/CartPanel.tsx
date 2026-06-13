'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { AlertTriangle, CheckCircle2, ImageIcon, Minus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CatalogCartItem } from '@/components/catalog/types'
import { computeQuantityDiscount } from '@/lib/promotions'
import { round2 } from '@/lib/format'
import posthog from 'posthog-js'
import PopNumber from '@/components/shared/PopNumber'
import { FieldErrorMessage, ShakeOnError } from '@/components/shared/ShakeError'

// Descuento de línea por promo de cantidad (2x1, 3x2, 2da al X%). Las promos
// unitarias ya vienen aplicadas en salePrice. Espeja lo que create_catalog_order
// cobra server-side — el total mostrado debe coincidir con el cobrado.
function lineDiscount(item: CatalogCartItem): number {
  const promo = item.product.promo
  if (!promo || promo.kind !== 'quantity') return 0
  return computeQuantityDiscount(promo, item.product.salePrice, item.quantity)
}

export function lineTotal(item: CatalogCartItem): number {
  return round2(item.product.salePrice * item.quantity - lineDiscount(item))
}

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

function cartItemKey(item: CatalogCartItem): string {
  return `${item.product.id}:${item.variantId ?? ''}`
}

export interface CatalogLastOrderItem {
  name: string
  variantLabel: string | null
  quantity: number
  lineTotal: number
}

/** Snapshot completo del pedido enviado: el comprador anónimo no tiene cuenta,
    este recap es su única copia de qué pidió y a qué teléfono lo contactan */
export interface CatalogLastOrder {
  orderNumber: number
  whatsappUrl: string | null
  items: CatalogLastOrderItem[]
  total: number
  deliveryType: 'take-away' | 'delivery'
  address: string | null
  phone: string
}

interface CartPanelProps {
  businessSlug: string
  businessName: string
  businessWhatsapp: string | null
  cartItems: CatalogCartItem[]
  onIncreaseQuantity: (key: string) => void
  onDecreaseQuantity: (key: string) => void
  onRemoveItem: (key: string) => void
  /** Último pedido enviado (vive en el shell): el éxito sobrevive al cierre del
      sheet y el carrito ya quedó vacío — evita el doble envío */
  lastOrder: CatalogLastOrder | null
  onOrderSuccess: (order: CatalogLastOrder) => void
  onNewOrder: () => void
  /** Dentro del sheet mobile: sin chrome de aside ni heading propio (los pone el sheet) */
  embedded?: boolean
}

const ORDER_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Demasiados pedidos desde este dispositivo. Espera un momento e intenta de nuevo.',
  too_many_pending: 'Ya tienes varios pedidos pendientes. Espera a que el negocio los confirme.',
  blacklisted: 'No es posible enviar pedidos a este negocio desde este número.',
  invalid_phone: 'Revisa el formato del teléfono.',
  invalid_name: 'Ingresa tu nombre.',
  address_required: 'La dirección es obligatoria para envíos a domicilio.',
  empty_cart: 'Tu carrito está vacío.',
  product_not_available: 'Uno de los productos ya no está disponible. Recarga la página para ver el catálogo al día.',
  variant_not_available: 'Una de las opciones elegidas ya no está disponible. Recarga la página para ver el catálogo al día.',
  business_not_found: 'Este catálogo no está disponible.',
  server_error: 'No pudimos registrar tu pedido. Intenta de nuevo en un momento.',
  invalid_payload: 'Hay un problema con tu pedido. Recarga la página e intenta de nuevo.',
}

type DeliveryType = 'take-away' | 'delivery'

type FieldKey = 'name' | 'phone' | 'address'
type FieldErrors = Partial<Record<FieldKey, string>>

const FIELD_INPUT_IDS: Record<FieldKey, string> = {
  name: 'catalog-name',
  phone: 'catalog-phone',
  address: 'catalog-address',
}

const currencyFormatter = new Intl.NumberFormat('es-AR')

export default function CartPanel({
  businessSlug,
  businessName,
  businessWhatsapp,
  cartItems,
  onIncreaseQuantity,
  onDecreaseQuantity,
  onRemoveItem,
  lastOrder,
  onOrderSuccess,
  onNewOrder,
  embedded = false,
}: CartPanelProps) {
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('take-away')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [errorNonce, setErrorNonce] = useState(0)

  const subtotal = useMemo(
    () => cartItems.reduce((acc, item) => acc + lineTotal(item), 0),
    [cartItems]
  )

  const total = subtotal

  const trimmedName = customerName.trim()
  const trimmedPhone = customerPhone.trim()
  const trimmedAddress = address.trim()
  const trimmedNotes = notes.trim()
  const normalizedWhatsapp = businessWhatsapp?.trim() ?? ''

  // Espejo de create_catalog_order: teléfono de 8 a 20 dígitos tras quitar separadores
  const phoneDigits = trimmedPhone.replace(/\D/g, '')

  function validateForm(): FieldErrors {
    const errors: FieldErrors = {}
    if (trimmedName.length === 0) {
      errors.name = 'Ingresa tu nombre para que el negocio sepa de quién es el pedido.'
    }
    if (trimmedPhone.length === 0) {
      errors.phone = 'Ingresa tu teléfono para que el negocio te contacte.'
    } else if (phoneDigits.length < 8 || phoneDigits.length > 20) {
      errors.phone = 'Revisa el teléfono: debe tener entre 8 y 20 dígitos.'
    }
    if (deliveryType === 'delivery' && trimmedAddress.length === 0) {
      errors.address = 'Ingresa la dirección para el envío a domicilio.'
    }
    return errors
  }

  function clearFieldError(field: FieldKey) {
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  function focusFirstError(errors: FieldErrors) {
    const order: FieldKey[] = ['name', 'phone', 'address']
    const first = order.find(key => errors[key])
    if (!first) return
    const input = document.getElementById(FIELD_INPUT_IDS[first])
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    input?.focus({ preventScroll: true })
  }

  function buildMessage(orderNumberValue: number): string {
    const itemsText = cartItems
      .map(item => {
        const variantPart = item.variantLabel ? ` (${item.variantLabel})` : ''
        const promoPart = item.product.promo && (lineDiscount(item) > 0 || item.product.originalPrice !== null)
          ? ` [Promo ${item.product.promo.label}]`
          : ''
        return `${item.quantity}x ${item.product.name}${variantPart}${promoPart} - $${currencyFormatter.format(lineTotal(item))}`
      })
      .join('\n')

    const lines: string[] = [
      `Hola! Quisiera hacer un pedido (#${orderNumberValue}):`,
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

  async function handleSubmitOrder() {
    if (cartItems.length === 0 || submitting) return

    const errors = validateForm()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setErrorNonce(n => n + 1)
      focusFirstError(errors)
      return
    }

    setFieldErrors({})
    setSubmitting(true)
    setSubmitError(null)

    try {
      const response = await fetch('/api/catalog/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: businessSlug,
          customer_name: trimmedName,
          phone: trimmedPhone,
          delivery_type: deliveryType === 'delivery' ? 'delivery' : 'takeaway',
          address: deliveryType === 'delivery' ? trimmedAddress : null,
          notes: trimmedNotes || null,
          items: cartItems.map(item => ({
            product_id: item.product.id,
            variant_id: item.variantId ?? null,
            quantity: item.quantity,
          })),
        }),
      })

      const json = (await response.json().catch(() => null)) as { order_number?: number; error?: string } | null

      if (!response.ok || !json?.order_number) {
        const code = json?.error ?? 'server_error'
        setSubmitError(ORDER_ERROR_MESSAGES[code] ?? ORDER_ERROR_MESSAGES.server_error)
        posthog.capture('catalog_order_failed', {
          error: code,
          status: response.status,
          business_name: businessName,
        })
        return
      }

      const number = json.order_number

      posthog.capture('catalog_order_sent', {
        total,
        item_count: cartItems.length,
        delivery_type: deliveryType,
        business_name: businessName,
        order_number: number,
        has_whatsapp: normalizedWhatsapp.length > 0,
      })

      let url: string | null = null
      if (normalizedWhatsapp) {
        url = `https://wa.me/${normalizedWhatsapp}?text=${encodeURIComponent(buildMessage(number))}`
        // Popup blockers (iOS Safari sobre todo) suelen matar window.open tras un
        // await: el estado de éxito muestra el link explícito como camino garantizado.
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      // El shell limpia el carrito acá mismo — si el comprador cierra y reabre el
      // sheet ve el éxito (no el form), sin riesgo de reenviar el mismo pedido.
      onOrderSuccess({
        orderNumber: number,
        whatsappUrl: url,
        items: cartItems.map(item => ({
          name: item.product.name,
          variantLabel: item.variantLabel,
          quantity: item.quantity,
          lineTotal: lineTotal(item),
        })),
        total,
        deliveryType,
        address: deliveryType === 'delivery' ? trimmedAddress : null,
        phone: trimmedPhone,
      })
    } catch (error) {
      console.error('[catalog cart] submit failed', error)
      setSubmitError(ORDER_ERROR_MESSAGES.server_error)
    } finally {
      setSubmitting(false)
    }
  }

  function handleNewOrder() {
    setCustomerName('')
    setCustomerPhone('')
    setDeliveryType('take-away')
    setAddress('')
    setNotes('')
    setSubmitError(null)
    setFieldErrors({})
    onNewOrder()
  }

  const asideClassName = embedded
    ? ''
    : 'rounded-xl border border-border/70 bg-card p-4 md:p-5 lg:max-h-full lg:overflow-y-auto'

  if (lastOrder) {
    return (
      <aside className={asideClassName}>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-primary" />
          <div>
            <p className="text-base font-semibold text-foreground">
              Pedido enviado #{lastOrder.orderNumber}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {lastOrder.whatsappUrl
                ? 'El negocio ya recibió tu pedido. Puedes escribirle por WhatsApp para coordinar la entrega.'
                : 'El negocio ya recibió tu pedido y te contactará para coordinar la entrega.'}
            </p>
          </div>

          {/* Recap: la única copia del pedido que tiene un comprador sin cuenta */}
          <div className="w-full rounded-lg border border-border/70 bg-muted/20 p-3 text-left">
            <ul className="space-y-1.5">
              {lastOrder.items.map((item, index) => (
                <li key={index} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 text-foreground">
                    {item.quantity}x {item.name}
                    {item.variantLabel && (
                      <span className="text-muted-foreground"> ({item.variantLabel})</span>
                    )}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    ${currencyFormatter.format(item.lineTotal)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-center justify-between border-t border-border/70 pt-2.5 text-sm font-bold text-foreground">
              <span>Total</span>
              <span>${currencyFormatter.format(lastOrder.total)}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {lastOrder.deliveryType === 'delivery'
                ? `Delivery a ${lastOrder.address}`
                : 'Para llevar'}
              {' · '}Te contactan al {lastOrder.phone}
            </p>
          </div>

          {lastOrder.whatsappUrl && (
            <Button asChild className="h-10 w-full">
              <a href={lastOrder.whatsappUrl} target="_blank" rel="noopener noreferrer">
                Escribir por WhatsApp
              </a>
            </Button>
          )}
          <Button type="button" variant="outline" className="h-10 w-full" onClick={handleNewOrder}>
            Nuevo pedido
          </Button>
        </div>
      </aside>
    )
  }

  const isEmpty = cartItems.length === 0

  return (
    <aside className={asideClassName}>
      {!embedded && (
        <>
          <h2 className="text-base font-semibold text-foreground">Tu pedido</h2>
          <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{businessName}</p>
        </>
      )}

      <div className={`space-y-3 ${embedded ? '' : 'mt-4'}`}>
        {isEmpty ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Tu carrito está vacío. Agrega productos para armar tu pedido.
          </div>
        ) : (
          <ul className="space-y-2">
            {cartItems.map(item => {
              const key = cartItemKey(item)
              return (
                <li key={key} className="rounded-lg border border-border/70 p-3">
                  <div className="flex items-start gap-2.5">
                    {/* Thumbnail */}
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted/40">
                      {(item.variantImageUrl ?? item.product.imageUrl) ? (
                        <CartItemImage imageUrl={(item.variantImageUrl ?? item.product.imageUrl)!} name={item.product.name} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-4 w-4" />
                        </div>
                      )}
                    </div>

                    {/* Name, variant, price, remove */}
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="line-clamp-1 text-sm font-medium text-foreground">{item.product.name}</p>
                        {item.product.brandName && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.product.brandName}</p>
                        )}
                        {item.variantLabel && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.variantLabel}</p>
                        )}
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          <PopNumber value={`$${currencyFormatter.format(lineTotal(item))}`} />
                          {item.product.promo && (lineDiscount(item) > 0 || item.product.originalPrice !== null) && (
                            <span className="ml-1.5 rounded bg-promo/10 px-1 py-0.5 text-[10px] font-semibold text-promo">
                              {item.product.promo.label}
                            </span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(key)}
                        className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 hover:bg-destructive/10 hover:text-destructive md:h-8 md:w-8"
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
                      onClick={() => onDecreaseQuantity(key)}
                      aria-label={`Restar ${item.product.name}`}
                      className="h-11 w-11 md:h-8 md:w-8"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>

                    <span className="w-8 text-center text-sm font-medium text-foreground">{item.quantity}</span>

                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => onIncreaseQuantity(key)}
                      disabled={item.quantity >= item.product.stock}
                      aria-label={`Sumar ${item.product.name}`}
                      className="h-11 w-11 md:h-8 md:w-8"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!isEmpty && (
        <>
          {/* Sin fila de subtotal: hoy siempre es igual al total y duplicarlo insinúa fees ocultos */}
          <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center justify-between text-base font-bold text-foreground">
              <span>Total</span>
              <PopNumber value={`$${currencyFormatter.format(total)}`} />
            </div>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            No pagas ahora: el negocio recibe tu pedido y coordina contigo la entrega y el pago.
          </p>

          {/* <form> (regla 28): Enter-to-submit + autofill del navegador en name/tel */}
          <form
            onSubmit={event => {
              event.preventDefault()
              handleSubmitOrder()
            }}
          >
          <div className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="catalog-name" className="text-xs uppercase tracking-wide text-muted-foreground">
                Nombre
              </label>
              <ShakeOnError error={fieldErrors.name} nonce={errorNonce}>
                <Input
                  id="catalog-name"
                  value={customerName}
                  onChange={event => {
                    setCustomerName(event.target.value)
                    clearFieldError('name')
                  }}
                  placeholder="Tu nombre"
                  autoComplete="name"
                  aria-invalid={fieldErrors.name ? true : undefined}
                />
              </ShakeOnError>
              <FieldErrorMessage error={fieldErrors.name} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="catalog-phone" className="text-xs uppercase tracking-wide text-muted-foreground">
                Teléfono
              </label>
              <ShakeOnError error={fieldErrors.phone} nonce={errorNonce}>
                <Input
                  id="catalog-phone"
                  type="tel"
                  inputMode="tel"
                  value={customerPhone}
                  onChange={event => {
                    setCustomerPhone(event.target.value)
                    clearFieldError('phone')
                  }}
                  placeholder="Ej: 11 2345-6789"
                  autoComplete="tel"
                  aria-invalid={fieldErrors.phone ? true : undefined}
                />
              </ShakeOnError>
              <FieldErrorMessage error={fieldErrors.phone} />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Entrega</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryType('take-away')
                    clearFieldError('address')
                  }}
                  className={`rounded-full border px-3 py-2 text-sm transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${
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
                  className={`rounded-full border px-3 py-2 text-sm transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${
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
                <ShakeOnError error={fieldErrors.address} nonce={errorNonce}>
                  <Input
                    id="catalog-address"
                    value={address}
                    onChange={event => {
                      setAddress(event.target.value)
                      clearFieldError('address')
                    }}
                    placeholder="Calle y número"
                    autoComplete="street-address"
                    aria-invalid={fieldErrors.address ? true : undefined}
                  />
                </ShakeOnError>
                <FieldErrorMessage error={fieldErrors.address} />
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
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs text-warning">
                Este negocio aún no tiene WhatsApp. Igualmente recibe tu pedido y te contactará al teléfono que dejes.
              </p>
            </div>
          )}

          {submitError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-xs text-destructive">{submitError}</p>
            </div>
          )}

          <Button
            type="submit"
            className="mt-4 h-10 w-full"
            disabled={submitting}
          >
            {submitting ? 'Enviando...' : 'Enviar pedido'}
          </Button>
          {normalizedWhatsapp.length > 0 && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Al enviar, se abre WhatsApp con tu pedido listo para coordinar.
            </p>
          )}
          </form>
        </>
      )}
    </aside>
  )
}
