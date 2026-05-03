'use client'

import { useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
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
  period: string
  from?: string
  to?: string
}

export default function PaymentMethodDetailView({ rows, period, from, to }: Props) {
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

  const csvData = useMemo(() =>
    sorted.map(r => ({
      'Método de pago': normalizePayment(r.method),
      'Total cobrado': r.total_amount ?? 0,
      Transacciones: r.transactions ?? 0,
      'Ticket promedio': r.avg_ticket ?? 0,
      '% del total': grandTotal > 0 ? `${(((r.total_amount ?? 0) / grandTotal) * 100).toFixed(1)}%` : '0%',
    })),
    [sorted, grandTotal]
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
                <p className="text-xl font-bold text-heading">{formatMoney(row.total_amount ?? 0)}</p>
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
                    <td colSpan={5} className="text-center text-hint py-12 text-sm">Sin datos para el período</td>
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
        </div>
      </div>
    </div>
  )
}
