'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Phone, EnvelopeSimple, IdentificationCard, Receipt } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_LABELS } from '@/lib/payments'
import type { PaymentMethod } from '@/lib/constants/domain'
import type { Customer } from '@/lib/types'

type MovementType = 'charge' | 'payment' | 'opening'

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
  charge: 'Compra',
  payment: 'Pago',
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

interface Props {
  customer: Customer
  businessId: string
  onClose: () => void
}

export default function CustomerDetailPanel({ customer, businessId, onClose }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()

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
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Saldo actual</p>
                <p className={`mt-1 text-sm font-semibold tabular-nums ${customer.credit_balance > 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {formatMoney(customer.credit_balance)}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Límite</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {hasLimit ? formatMoney(customer.credit_limit) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Disponible</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {hasLimit ? formatMoney(available) : '—'}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Movimientos</h3>

            {isLoading && <p className="text-sm text-muted-foreground">Cargando movimientos…</p>}

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
              <div className="rounded-lg border border-border/70 bg-card px-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">Sin movimientos.</p>
              </div>
            )}

            {!isLoading && !isError && movements.length > 0 && (
              <ul className="space-y-2">
                {movements.map(m => {
                  const isPayment = m.type === 'payment'
                  const method = isPayment ? methodLabel(m.method) : null
                  return (
                    <li key={m.id} className="rounded-lg border border-border/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{MOVEMENT_LABEL[m.type]}</span>
                            {m.sale_id && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-hint border border-edge">
                                <Receipt size={11} /> Venta
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatTimestamp(m.created_at)}</p>
                          {method && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{method}</p>
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
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
