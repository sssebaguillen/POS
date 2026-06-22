'use client'

import { useMemo } from 'react'
import { Wallet } from '@phosphor-icons/react/dist/ssr'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import { periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import type { PaymentMethod } from '@/lib/constants/domain'
import { PAYMENT_COLORS, isPaymentMethod, normalizePayment } from '@/lib/payments'
import PageHeader from '@/components/shared/PageHeader'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

export interface PaymentMethodRow {
  method: PaymentMethod
  total_amount: number
  transactions: number
  avg_ticket: number
}

interface Props {
  rows: PaymentMethodRow[]
  collections: PaymentMethodRow[]
  period: string
  from?: string
  to?: string
}

export default function PaymentMethodDetailView({ rows, collections, period, from, to }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const formatMoney = useFormatMoney()

  function navigate(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    const params = new URLSearchParams()
    params.set('period', newPeriod)
    if (periodNeedsCustomDates(newPeriod) && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => (b.total_amount ?? 0) - (a.total_amount ?? 0)), [rows])
  const grandTotal = useMemo(() => sorted.reduce((acc, r) => acc + (r.total_amount ?? 0), 0), [sorted])

  const sortedCollections = useMemo(
    () => [...collections].sort((a, b) => (b.total_amount ?? 0) - (a.total_amount ?? 0)),
    [collections]
  )
  const collectionsTotal = useMemo(
    () => sortedCollections.reduce((acc, r) => acc + (r.total_amount ?? 0), 0),
    [sortedCollections]
  )

  const csvData = useMemo(() => [
    ...sorted.map(r => ({
      Tipo: 'Venta',
      'Método de pago': normalizePayment(r.method),
      'Total cobrado': r.total_amount ?? 0,
      Transacciones: r.transactions ?? 0,
      'Ticket promedio': r.avg_ticket ?? 0,
      '% del total': grandTotal > 0 ? `${(((r.total_amount ?? 0) / grandTotal) * 100).toFixed(1)}%` : '0%',
    })),
    ...sortedCollections.map(r => ({
      Tipo: 'Cobro cuenta corriente',
      'Método de pago': normalizePayment(r.method),
      'Total cobrado': r.total_amount ?? 0,
      Transacciones: r.transactions ?? 0,
      'Ticket promedio': r.avg_ticket ?? 0,
      '% del total': '—',
    })),
  ],
    [sorted, sortedCollections, grandTotal]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Métodos de pago" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <ExportCSVButton data={csvData} filename="payment-methods" />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          <DateRangeFilter
            value={period as DateRangePeriod}
            from={from}
            to={to}
            onChange={navigate}
          />

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {sorted.map(row => (
              <div key={row.method} className="surface-card p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${isPaymentMethod(row.method) ? PAYMENT_COLORS[row.method] : 'bg-hint'}`} />
                  <span className="text-sm font-medium text-body">{normalizePayment(row.method)}</span>
                </div>
                <PopNumber className="text-xl font-bold text-heading" value={formatMoney(row.total_amount ?? 0)} />
                <p className="text-xs text-hint">
                  {grandTotal > 0 ? `${(((row.total_amount ?? 0) / grandTotal) * 100).toFixed(1)}% del total` : '—'}
                </p>
              </div>
            ))}
          </div>

          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-edge/60">
                <tr className="text-xs text-hint font-medium">
                  <th className="text-left px-4 py-3">Método</th>
                  <th className="text-right px-4 py-3">Total cobrado</th>
                  <th className="text-right px-4 py-3">% del total</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Transacciones</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Ticket promedio</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12">
                      <div className="flex flex-col items-center justify-center text-center gap-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                          <Wallet size={18} />
                        </span>
                        <p className="text-sm font-medium text-heading">Sin datos para el período</p>
                        <p className="text-xs text-hint">Cuando haya ventas en este rango, vas a ver los medios de pago acá.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sorted.map(row => (
                    <tr key={row.method} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${isPaymentMethod(row.method) ? PAYMENT_COLORS[row.method] : 'bg-hint'}`} />
                          <span className="font-medium text-heading">{normalizePayment(row.method)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatMoney(row.total_amount ?? 0)}</td>
                      <td className="px-4 py-3 text-right text-hint text-xs">
                        {grandTotal > 0 ? `${(((row.total_amount ?? 0) / grandTotal) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.transactions ?? 0}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        {formatMoney(row.avg_ticket ?? 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Cobros de cuenta corriente — separados de las ventas (no son ingreso nuevo:
              la venta a crédito ya se contó como 'crédito' al momento de venderla) */}
          {sortedCollections.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold text-heading">Cobros de cuenta corriente</h2>
                <span className="text-xs text-hint">Total {formatMoney(collectionsTotal)}</span>
              </div>
              <p className="text-xs text-hint px-1">
                Pagos de fiado recibidos en el período. No se suman a las ventas: el ingreso ya se
                registró al momento de la venta a crédito.
              </p>
              <div className="surface-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-edge/60">
                    <tr className="text-xs text-hint font-medium">
                      <th className="text-left px-4 py-3">Método</th>
                      <th className="text-right px-4 py-3">Total cobrado</th>
                      <th className="text-right px-4 py-3 hidden md:table-cell">Cobros</th>
                      <th className="text-right px-4 py-3 hidden md:table-cell">Promedio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCollections.map(row => (
                      <tr key={row.method} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${isPaymentMethod(row.method) ? PAYMENT_COLORS[row.method] : 'bg-hint'}`} />
                            <span className="font-medium text-heading">{normalizePayment(row.method)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{formatMoney(row.total_amount ?? 0)}</td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">{row.transactions ?? 0}</td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">{formatMoney(row.avg_ticket ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
