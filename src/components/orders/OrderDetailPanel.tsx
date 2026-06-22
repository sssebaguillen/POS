'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Phone, MapPin, ClipboardText, Bicycle, ShoppingBag, Image as ImageIcon, CircleNotch } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import ConfirmModal from '@/components/shared/ConfirmModal'
import { formatMoney } from '@/lib/format'
import { PAYMENT_OPTIONS } from '@/lib/payments'
import type { PaymentMethod } from '@/lib/constants/domain'
import StatusBadge from './StatusBadge'
import { STATUS_LABEL, type CatalogOrderDetail, type CatalogOrderItemRow, type CatalogOrderStatus } from './types'

// Métodos ofrecidos al completar un pedido online. 'credit' (cuenta corriente) se excluye:
// requiere un cliente registrado y el pedido del catálogo es anónimo.
const CATALOG_PAYMENT_OPTIONS = PAYMENT_OPTIONS.filter(o => o.value !== 'credit')

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr)
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (mins < 1)    return 'Ahora mismo'
  if (mins < 60)   return `Hace ${mins} min`
  if (mins < 720)  return `Hace ${Math.floor(mins / 60)} h`
  return date.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  orderId: string
  operatorId: string | null
  onClose: () => void
  onStatusChanged: () => void
}

type Action = {
  status: CatalogOrderStatus
  label: string
  variant: 'primary' | 'secondary' | 'destructive'
  confirm?: string
}

function buildActions(detail: CatalogOrderDetail): Action[] {
  switch (detail.status) {
    case 'recibido':
      return [
        { status: 'aceptado',  label: 'Aceptar pedido',  variant: 'primary' },
        { status: 'rechazado', label: 'Rechazar',        variant: 'destructive', confirm: '¿Rechazar este pedido?' },
        { status: 'cancelado', label: 'Cancelar pedido', variant: 'secondary',   confirm: '¿Cancelar este pedido?' },
      ]
    case 'aceptado':
      return detail.delivery_type === 'delivery'
        ? [
            { status: 'en_camino', label: 'Marcar en camino', variant: 'primary' },
            { status: 'cancelado', label: 'Cancelar pedido',  variant: 'secondary', confirm: '¿Cancelar este pedido?' },
          ]
        : [
            { status: 'listo_retiro', label: 'Listo para retirar', variant: 'primary' },
            { status: 'cancelado',    label: 'Cancelar pedido',    variant: 'secondary', confirm: '¿Cancelar este pedido?' },
          ]
    case 'en_camino':
    case 'listo_retiro':
      return [
        { status: 'completado', label: 'Completar pedido', variant: 'primary', confirm: 'Al completar el pedido se descontará stock y se registrará como venta.' },
        { status: 'cancelado',  label: 'Cancelar pedido',  variant: 'secondary', confirm: '¿Cancelar este pedido?' },
      ]
    default:
      return []
  }
}

export default function OrderDetailPanel({ orderId, operatorId, onClose, onStatusChanged }: Props) {
  const supabase: SupabaseClient = useMemo(() => createClient(), [])
  const [detail, setDetail] = useState<CatalogOrderDetail | null>(null)
  const [items, setItems] = useState<CatalogOrderItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [pendingAction, setPendingAction] = useState<Action | null>(null)
  const [blacklist, setBlacklist] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data, error: rpcError } = await supabase.rpc('get_catalog_order', { p_order_id: orderId })
      if (cancelled) return
      const result = data as { success: boolean; error?: string; order?: CatalogOrderDetail; items?: CatalogOrderItemRow[] } | null
      if (rpcError || !result?.success || !result.order) {
        setError(result?.error ?? rpcError?.message ?? 'No se pudo cargar el pedido')
        setLoading(false)
        return
      }
      setDetail({
        ...result.order,
        subtotal: Number(result.order.subtotal),
        total: Number(result.order.total),
      })
      setItems((result.items ?? []).map(it => ({
        ...it,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        line_total: Number(it.line_total),
      })))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [supabase, orderId, retryKey])

  async function applyStatus(action: Action) {
    if (!detail) return
    setUpdating(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('update_catalog_order_status', {
      p_operator_id: operatorId,
      p_order_id: orderId,
      p_new_status: action.status,
      p_blacklist: action.status === 'rechazado' ? blacklist : false,
      p_payment_method: action.status === 'completado' ? paymentMethod : null,
    })
    setUpdating(false)
    const result = data as { success: boolean; error?: string } | null
    if (rpcError || !result?.success) {
      setError(result?.error ?? rpcError?.message ?? 'No se pudo actualizar el pedido')
      return
    }
    setPendingAction(null)
    onStatusChanged()
    onClose()
  }

  const actions = detail ? buildActions(detail) : []
  const isDelivery = detail?.delivery_type === 'delivery'

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/40 dark:bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed z-50 surface-elevated flex flex-col
          inset-x-0 bottom-0 max-h-[90vh] !rounded-t-2xl !rounded-b-none border-t border-edge
          sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-full sm:max-w-md sm:!rounded-none sm:border-t-0 sm:border-l"
      >
        <div className="h-14 border-b border-edge/60 flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="font-semibold text-heading truncate">
              {detail ? `Pedido #${detail.order_number}` : 'Pedido'}
            </h2>
            {detail && <StatusBadge status={detail.status} />}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {loading && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleNotch size={14} className="animate-spin" />
              Cargando pedido…
            </p>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 space-y-2">
              <p className="text-xs text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => setRetryKey(k => k + 1)}
                className="text-xs text-destructive underline-offset-2 hover:underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {detail && (
            <>
              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</h3>
                <div className="rounded-lg border border-border/70 bg-card px-3 py-2.5 space-y-1.5">
                  <p className="text-sm font-medium text-foreground">{detail.customer_name}</p>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone size={14} />
                    <a className="hover:underline" href={`tel:${detail.customer_phone}`}>{detail.customer_phone}</a>
                  </p>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    {isDelivery ? <Bicycle size={14} /> : <ShoppingBag size={14} />}
                    {isDelivery ? 'Delivery' : 'Para llevar'}
                  </p>
                  {isDelivery && detail.address && (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin size={14} className="mt-0.5 shrink-0" />
                      <span>{detail.address}</span>
                    </p>
                  )}
                  {detail.notes && (
                    <p className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ClipboardText size={14} className="mt-0.5 shrink-0" />
                      <span className="whitespace-pre-wrap">{detail.notes}</span>
                    </p>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Productos ({items.length})</h3>
                <ul className="space-y-2">
                  {items.map(item => (
                    <li key={item.id} className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted/40">
                        {item.image_url ? (
                          <Image src={item.image_url} alt={item.product_name} fill className="object-cover" sizes="48px" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ImageIcon size={18} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground line-clamp-2">{item.product_name}</p>
                        {item.variant_label && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{item.variant_label}</p>
                        )}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.quantity} × {formatMoney(item.unit_price)}
                        </p>
                      </div>
                      <span className="text-sm font-medium text-foreground shrink-0">
                        {formatMoney(item.line_total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatMoney(detail.subtotal)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-base font-bold text-foreground">
                  <span>Total</span>
                  <span>{formatMoney(detail.total)}</span>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Historial</h3>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Recibido: {formatTimestamp(detail.created_at)}</p>
                  {detail.accepted_at  && <p>Aceptado: {formatTimestamp(detail.accepted_at)}</p>}
                  {detail.completed_at && <p>Completado: {formatTimestamp(detail.completed_at)}</p>}
                  {detail.rejected_at  && <p>Rechazado: {formatTimestamp(detail.rejected_at)}</p>}
                  {detail.cancelled_at && <p>Cancelado: {formatTimestamp(detail.cancelled_at)}</p>}
                  {detail.sale_id && <p>Venta registrada</p>}
                </div>
              </section>
            </>
          )}
        </div>

        {actions.length > 0 && (
          <div className="border-t border-edge/60 px-5 py-4 shrink-0 space-y-3">
            {/* Primary action — full width, always first */}
            {actions.filter(a => a.variant === 'primary').map(action => (
              <Button
                key={action.status}
                type="button"
                variant="default"
                className="w-full"
                disabled={updating}
                onClick={() => action.confirm ? setPendingAction(action) : applyStatus(action)}
              >
                {action.label}
              </Button>
            ))}

            {/* Secondary / destructive actions — separated, side by side when multiple */}
            {actions.filter(a => a.variant !== 'primary').length > 0 && (
              <div className="space-y-2 pt-1 border-t border-edge/40">
                <div className="flex gap-2">
                  {actions.filter(a => a.variant !== 'primary').map(action => (
                    <Button
                      key={action.status}
                      type="button"
                      variant={action.variant === 'destructive' ? 'destructive' : 'cancel'}
                      className="flex-1 text-sm"
                      disabled={updating}
                      onClick={() => action.confirm ? setPendingAction(action) : applyStatus(action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>

                {/* Blacklist toggle — only when Rechazar is an available action, before clicking */}
                {actions.some(a => a.status === 'rechazado') && (
                  <div className="flex items-center gap-2.5 pt-0.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={blacklist}
                      aria-labelledby="blacklist-label"
                      onClick={() => setBlacklist(b => !b)}
                      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${blacklist ? 'bg-primary' : 'bg-muted-foreground/50'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${blacklist ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </button>
                    <span
                      id="blacklist-label"
                      className="text-xs text-muted-foreground cursor-pointer select-none"
                      onClick={() => setBlacklist(b => !b)}
                    >
                      Bloquear este número al rechazar
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={pendingAction !== null}
        title={pendingAction?.label ?? ''}
        message={
          pendingAction?.status === 'completado' ? (
            <div className="space-y-3">
              <p>Al completar el pedido se descontará stock y se registrará como venta.</p>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">¿Cómo se pagó?</span>
                <div className="grid grid-cols-2 gap-2">
                  {CATALOG_PAYMENT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPaymentMethod(opt.value)}
                      className={`h-9 rounded-lg border text-sm transition-colors ${
                        paymentMethod === opt.value
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'border-edge text-muted-foreground hover:bg-hover-bg'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : pendingAction?.status === 'rechazado' && blacklist
            ? '¿Rechazar este pedido y bloquear el número? El cliente no podrá enviar más pedidos.'
            : (pendingAction?.confirm ?? `¿Cambiar el estado a "${pendingAction ? STATUS_LABEL[pendingAction.status] : ''}"?`)
        }
        confirmLabel={pendingAction?.label ?? 'Confirmar'}
        cancelLabel="Volver"
        loading={updating}
        loadingLabel="Actualizando..."
        onConfirm={() => pendingAction && applyStatus(pendingAction)}
        onCancel={() => setPendingAction(null)}
      />
    </>
  )
}
