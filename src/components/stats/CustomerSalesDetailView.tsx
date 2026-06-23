'use client'

import { useMemo, useState } from 'react'
import { UsersThree, CaretUp, CaretDown } from '@phosphor-icons/react/dist/ssr'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import { periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type { CustomerSalesStatsRow } from '@/lib/types'

type SortKey = 'name' | 'transactions' | 'revenue' | 'avg_ticket' | 'last_purchase' | 'balance'
type SortDir = 'asc' | 'desc'

interface Props {
  rows: CustomerSalesStatsRow[]
  period: string
  from?: string
  to?: string
}

function SortHeader({
  label, columnKey, activeKey, dir, onSort, className,
}: {
  label: string
  columnKey: SortKey
  activeKey: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = activeKey === columnKey
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-body transition-colors',
          active && 'text-body font-semibold'
        )}
      >
        {label}
        {active && (dir === 'asc' ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />)}
      </button>
    </th>
  )
}

// "Última compra" en lenguaje cercano; para fechas viejas cae a la fecha corta.
function lastPurchaseLabel(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'Hoy'
  if (days === 1) return 'Ayer'
  if (days < 30) return `hace ${days} días`
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CustomerSalesDetailView({ rows, period, from, to }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const formatMoney = useFormatMoney()
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function navigate(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    const params = new URLSearchParams()
    params.set('period', newPeriod)
    if (periodNeedsCustomDates(newPeriod) && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Texto arranca ascendente (A-Z); los numéricos, descendente (mayor primero).
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name': cmp = a.customer_name.localeCompare(b.customer_name, 'es'); break
        case 'transactions': cmp = a.transactions - b.transactions; break
        case 'revenue': cmp = a.total_revenue - b.total_revenue; break
        case 'avg_ticket': cmp = a.avg_ticket - b.avg_ticket; break
        case 'balance': cmp = a.credit_balance - b.credit_balance; break
        case 'last_purchase':
          cmp = (a.last_purchase_at ?? '').localeCompare(b.last_purchase_at ?? ''); break
      }
      if (cmp === 0) cmp = a.total_revenue - b.total_revenue
      return cmp * dir
    })
  }, [rows, sortKey, sortDir])

  const totalRevenue = useMemo(() => rows.reduce((acc, r) => acc + r.total_revenue, 0), [rows])
  const totalTransactions = useMemo(() => rows.reduce((acc, r) => acc + r.transactions, 0), [rows])
  const avgTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0

  const csvData = useMemo(() =>
    sorted.map(r => ({
      Cliente: r.customer_name,
      Teléfono: r.customer_phone ?? '',
      Compras: r.transactions,
      Facturación: r.total_revenue,
      'Ticket promedio': r.avg_ticket,
      'Unidades': r.units_sold,
      'Última compra': r.last_purchase_at ? r.last_purchase_at.slice(0, 10) : '',
      'Saldo actual': r.credit_balance,
    })),
    [sorted]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Clientes" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <ExportCSVButton data={csvData} filename="ventas-por-cliente" />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          <DateRangeFilter
            value={period as DateRangePeriod}
            from={from}
            to={to}
            onChange={navigate}
          />

          <div className="grid grid-cols-3 gap-3">
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Clientes con compras</p>
              <PopNumber className="text-xl font-bold text-heading leading-none" value={String(rows.length)} />
            </div>
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Facturación atribuida</p>
              <PopNumber className="text-xl font-bold text-heading leading-none" value={formatMoney(totalRevenue)} />
            </div>
            <div className="surface-card p-4 space-y-1">
              <p className="text-label text-hint">Ticket promedio</p>
              <PopNumber className="text-xl font-bold text-heading leading-none" value={formatMoney(avgTicket)} />
            </div>
          </div>

          <p className="text-xs text-hint">
            Solo incluye ventas con un cliente asignado en la caja — las ventas anónimas de mostrador no se cuentan acá.
          </p>

          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-edge/60">
                <tr className="text-xs text-hint font-medium">
                  <SortHeader label="Cliente" columnKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-left px-4 py-3" />
                  <SortHeader label="Compras" columnKey="transactions" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right px-4 py-3 hidden md:table-cell" />
                  <SortHeader label="Facturación" columnKey="revenue" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right px-4 py-3" />
                  <SortHeader label="Ticket prom." columnKey="avg_ticket" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right px-4 py-3 hidden lg:table-cell" />
                  <SortHeader label="Última compra" columnKey="last_purchase" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right px-4 py-3 hidden md:table-cell" />
                  <SortHeader label="Saldo" columnKey="balance" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="text-right px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12">
                      <div className="flex flex-col items-center justify-center text-center gap-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                          <UsersThree size={18} />
                        </span>
                        <p className="text-sm font-medium text-heading">Sin clientes con compras en el período</p>
                        <p className="text-xs text-hint">Cuando asignes un cliente a una venta en la caja, vas a ver su actividad acá.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sorted.map(row => {
                    const hasDebt = row.credit_balance > 0
                    return (
                      <tr key={row.customer_id} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-heading">{row.customer_name}</p>
                          {row.customer_phone && (
                            <p className="text-xs text-hint">{row.customer_phone}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">{row.transactions.toLocaleString('es-AR')}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(row.total_revenue)}</td>
                        <td className="px-4 py-3 text-right tabular-nums hidden lg:table-cell">{formatMoney(row.avg_ticket)}</td>
                        <td className="px-4 py-3 text-right text-body hidden md:table-cell whitespace-nowrap">{lastPurchaseLabel(row.last_purchase_at)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={hasDebt ? 'text-destructive font-semibold' : 'text-hint'}>
                            {hasDebt ? formatMoney(row.credit_balance) : '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
