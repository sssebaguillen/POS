'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Phone, EnvelopeSimple, IdentificationCard, CaretDown, CircleNotch, Receipt, ShoppingBag } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_LABELS } from '@/lib/payments'
import { getSaleDetail } from '@/lib/api/sales'
import { cn } from '@/lib/utils'
import type { PaymentMethod } from '@/lib/constants/domain'
import type { Customer } from '@/lib/types'

type MovementType = 'charge' | 'payment' | 'opening'

interface CustomerSale {
  id: string
  created_at: string
  total: number
  status: string
  source: string | null
  method: string | null
  item_count: number
}

type FichaView = 'compras' | 'movimientos'

interface AccountMovement {
  id: string
  type: MovementType
  amount: number
  method: string | null
  sale_id: string | null
  balance_after: number
  created_at: string
}

const MOVEMENT_LABEL: Record<MovementType, string> = {
  charge: 'Venta a crédito',
  payment: 'Pago a cuenta',
  opening: 'Saldo inicial',
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function methodLabel(method: string | null): string | null {
  if (!method) return null
  return PAYMENT_LABELS[method as PaymentMethod] ?? method
}

function segClass(active: boolean): string {
  return cn(
    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    active ? 'bg-card text-heading shadow-sm' : 'text-hint hover:text-body',
  )
}

// Detalle de una venta a crédito, expandido inline en la fila. Reusa la RPC
// get_sale_detail (misma que el dashboard) — solo se monta cuando la fila está abierta.
function SaleDetailInline({ saleId, businessId }: { saleId: string; businessId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sale-detail', businessId, saleId],
    queryFn: async () => {
      const res = await getSaleDetail(supabase, { saleId, businessId })
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
  })

  return (
    <div className="mt-2.5 rounded-lg border border-edge/60 bg-card px-3 py-2.5">
      {isLoading && <p className="text-xs text-muted-foreground">Cargando detalle…</p>}

      {isError && (
        <div className="space-y-1.5">
          <p className="text-xs text-destructive">No se pudo cargar el detalle.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-destructive underline-offset-2 hover:underline"
          >
            Reintentar
          </button>
        </div>
      )}

      {!isLoading && !isError && data && (
        <div className="space-y-1.5">
          <ul className="space-y-1">
            {(data.items ?? []).map(it => (
              <li key={it.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-foreground">
                  {it.quantity}× {it.product_name}{it.variant_label ? ` · ${it.variant_label}` : ''}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMoney(it.unit_price * it.quantity)}
                </span>
              </li>
            ))}
            {(!data.items || data.items.length === 0) && (
              <li className="text-xs text-muted-foreground">Sin ítems.</li>
            )}
          </ul>
          {data.payment_method && (
            <p className="border-t border-edge/40 pt-1.5 text-xs text-muted-foreground">
              Método: {methodLabel(data.payment_method)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  customer: Customer
  businessId: string
  onClose: () => void
}

export default function CustomerDetailPanel({ customer, businessId, onClose }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [view, setView] = useState<FichaView>('compras')

  const { data: movements = [], isLoading, isError, refetch } = useQuery<AccountMovement[]>({
    queryKey: ['customer-account-movements', businessId, customer.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_account_movements')
        .select('id, type, amount, method, sale_id, balance_after, created_at')
        .eq('business_id', businessId)
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as AccountMovement[]
    },
  })

  const {
    data: sales = [],
    isLoading: salesLoading,
    isError: salesError,
    refetch: refetchSales,
  } = useQuery<CustomerSale[]>({
    queryKey: ['customer-sales', businessId, customer.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_customer_sales', {
        p_business_id: businessId,
        p_customer_id: customer.id,
      })
      if (error) throw new Error(error.message)
      return (data as unknown as { data: CustomerSale[] } | null)?.data ?? []
    },
  })

  const hasLimit = customer.credit_limit > 0
  const available = customer.credit_limit - customer.credit_balance

  const contactRows = [
    customer.phone && { icon: <Phone size={14} />, value: customer.phone, href: `tel:${customer.phone}` },
    customer.email && { icon: <EnvelopeSimple size={14} />, value: customer.email, href: `mailto:${customer.email}` },
    customer.dni && { icon: <IdentificationCard size={14} />, value: `DNI ${customer.dni}`, href: null },
  ].filter(Boolean) as { icon: React.ReactNode; value: string; href: string | null }[]

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
          <h2 className="font-semibold text-heading truncate">{customer.name}</h2>
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
          {contactRows.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Contacto</h3>
              <div className="rounded-lg border border-border/70 bg-card px-3 py-2.5 space-y-1.5">
                {contactRows.map((row, i) => (
                  <p key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    {row.icon}
                    {row.href ? (
                      <a className="hover:underline" href={row.href}>{row.value}</a>
                    ) : (
                      <span>{row.value}</span>
                    )}
                  </p>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Cuenta corriente</h3>
            <div className="surface-card overflow-hidden grid grid-cols-3">
              <div className="px-4 py-3 border-r border-edge/40">
                <p className="text-label text-hint mb-1">Saldo actual</p>
                <p className={`font-display text-lg font-bold leading-none tabular-nums ${customer.credit_balance > 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {formatMoney(customer.credit_balance)}
                </p>
              </div>
              <div className="px-4 py-3 border-r border-edge/40">
                <p className="text-label text-hint mb-1">Límite</p>
                <p className="font-display text-lg font-bold leading-none tabular-nums text-foreground">
                  {hasLimit ? formatMoney(customer.credit_limit) : '—'}
                </p>
              </div>
              <div className="px-4 py-3">
                <p className="text-label text-hint mb-1">Disponible</p>
                <p className="font-display text-lg font-bold leading-none tabular-nums text-foreground">
                  {hasLimit ? formatMoney(available) : '—'}
                </p>
              </div>
            </div>
          </section>

          {/* Compras (historial completo) vs Movimientos (cuenta corriente) */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted">
            <button type="button" onClick={() => setView('compras')} className={cn(segClass(view === 'compras'), 'flex-1')}>
              Compras
            </button>
            <button type="button" onClick={() => setView('movimientos')} className={cn(segClass(view === 'movimientos'), 'flex-1')}>
              Movimientos
            </button>
          </div>

          {view === 'compras' && (
            <section className="space-y-2">
              {salesLoading && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CircleNotch size={14} className="animate-spin" />
                  Cargando compras…
                </p>
              )}

              {salesError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 space-y-2">
                  <p className="text-xs text-destructive">No se pudieron cargar las compras.</p>
                  <button
                    type="button"
                    onClick={() => refetchSales()}
                    className="text-xs text-destructive underline-offset-2 hover:underline"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {!salesLoading && !salesError && sales.length === 0 && (
                <div className="rounded-lg border border-border/70 bg-card px-3 py-8 flex flex-col items-center justify-center text-center gap-2">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                    <ShoppingBag size={18} />
                  </span>
                  <p className="text-sm font-medium text-heading">Sin compras registradas</p>
                  <p className="text-xs text-hint">Cuando este cliente compre (al contado o a cuenta), sus compras van a aparecer acá.</p>
                </div>
              )}

              {!salesLoading && !salesError && sales.length > 0 && (
                <ul className="space-y-2">
                  {sales.map(sale => {
                    const isExpanded = expandedSaleId === sale.id
                    const method = methodLabel(sale.method)
                    return (
                      <li key={sale.id} className="rounded-lg border border-border/70 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-foreground">
                                {sale.item_count} {sale.item_count === 1 ? 'artículo' : 'artículos'}
                              </span>
                              {sale.source === 'catalog' && (
                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                  Pedido online
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
                                className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                              >
                                {isExpanded ? 'Ocultar' : 'Ver detalle'}
                                <CaretDown
                                  size={11}
                                  className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                                />
                              </button>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">{formatTimestamp(sale.created_at)}</p>
                            {method && <p className="mt-0.5 text-xs text-muted-foreground">{method}</p>}
                          </div>
                          <p className="text-sm font-semibold tabular-nums text-foreground shrink-0">{formatMoney(sale.total)}</p>
                        </div>
                        {isExpanded && <SaleDetailInline saleId={sale.id} businessId={businessId} />}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}

          {view === 'movimientos' && (
          <section className="space-y-2">
            {isLoading && (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CircleNotch size={14} className="animate-spin" />
                Cargando movimientos…
              </p>
            )}

            {isError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 space-y-2">
                <p className="text-xs text-destructive">No se pudieron cargar los movimientos.</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="text-xs text-destructive underline-offset-2 hover:underline"
                >
                  Reintentar
                </button>
              </div>
            )}

            {!isLoading && !isError && movements.length === 0 && (
              <div className="rounded-lg border border-border/70 bg-card px-3 py-8 flex flex-col items-center justify-center text-center gap-2">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                  <Receipt size={18} />
                </span>
                <p className="text-sm font-medium text-heading">Sin movimientos</p>
                <p className="text-xs text-hint">Las compras a cuenta y los pagos de este cliente van a aparecer acá.</p>
              </div>
            )}

            {!isLoading && !isError && movements.length > 0 && (
              <ul className="space-y-2">
                {movements.map(m => {
                  const isPayment = m.type === 'payment'
                  const method = isPayment ? methodLabel(m.method) : null
                  const canExpand = m.type === 'charge' && !!m.sale_id
                  const isExpanded = canExpand && expandedSaleId === m.sale_id
                  return (
                    <li key={m.id} className="rounded-lg border border-border/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{MOVEMENT_LABEL[m.type]}</span>
                            {canExpand && (
                              <button
                                type="button"
                                onClick={() => setExpandedSaleId(isExpanded ? null : m.sale_id)}
                                className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                              >
                                {isExpanded ? 'Ocultar' : 'Ver detalle'}
                                <CaretDown
                                  size={11}
                                  className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                                />
                              </button>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatTimestamp(m.created_at)}</p>
                          {method && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{method}</p>
                          )}
                          {m.type === 'opening' && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Saldo registrado al iniciar la cuenta corriente
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-semibold tabular-nums ${isPayment ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
                            {isPayment ? '−' : '+'}{formatMoney(m.amount)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                            Saldo: {formatMoney(m.balance_after)}
                          </p>
                        </div>
                      </div>
                      {isExpanded && m.sale_id && (
                        <SaleDetailInline saleId={m.sale_id} businessId={businessId} />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          )}
        </div>
      </div>
    </>
  )
}
