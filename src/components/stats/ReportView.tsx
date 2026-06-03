'use client'

import { useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ArrowLeft, Printer } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import { Button } from '@/components/ui/button'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { normalizePayment } from '@/lib/payments'
import {
  buildDateParams,
  periodNeedsCustomDates,
  resolveDateRange,
  type DateRangePeriod,
} from '@/lib/date-utils'
import { createClient } from '@/lib/supabase/client'
import { normalizeOperatorSalesStatsRows } from '@/lib/mappers'
import type {
  DailySnapshotRow,
  OperatorSalesStatsRow,
  StatsBreakdown,
  StatsKpis,
  StatsTrendsComparison,
} from '@/lib/types'
import type { TopProductRow } from '@/components/stats/StatsView'

export interface ReportData {
  kpis: StatsKpis | null
  comparison: StatsTrendsComparison
  breakdown: StatsBreakdown | null
  topProducts: TopProductRow[]
  operators: OperatorSalesStatsRow[]
  dailySnapshots: DailySnapshotRow[]
}

interface Props {
  businessId: string
  businessName: string
  data: ReportData
  period: string
  from?: string
  to?: string
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function formatDayLabel(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${Number(d)} ${MONTHS_ES[Number(m) - 1] ?? ''} ${y}`
}

function formatShortDay(iso: string): string {
  const [, m, d] = iso.split('-')
  if (!m || !d) return iso
  return `${d}/${m}`
}

function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const delta = deltaPct(current, previous)
  if (delta === null) return <span className="report-delta report-delta-flat">—</span>
  const positive = delta >= 0
  return (
    <span className={`report-delta ${positive ? 'report-delta-up' : 'report-delta-down'}`}>
      {positive ? '▲' : '▼'} {positive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

export default function ReportView({
  businessId,
  businessName,
  data: initialData,
  period: initialPeriod,
  from: initialFrom,
  to: initialTo,
}: Props) {
  const pathname = usePathname()
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])

  const [period, setPeriod] = useState<DateRangePeriod>(initialPeriod as DateRangePeriod)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [mountedAt] = useState(() => Date.now())

  const isInitialRange = period === initialPeriod && from === initialFrom && to === initialTo

  const { data, isFetching } = useQuery<ReportData>({
    queryKey: ['stats-report', businessId, period, from, to],
    queryFn: async () => {
      const resolved = resolveDateRange(period, from, to)
      const baseArgs = { p_business_id: businessId, p_from: resolved.from, p_to: resolved.to }
      const [kpisRes, comparisonRes, breakdownRes, topRes, operatorsRes, snapshotsRes] = await Promise.all([
        supabase.rpc('get_stats_kpis', baseArgs),
        supabase.rpc('get_period_comparison', baseArgs),
        supabase.rpc('get_stats_breakdown', baseArgs),
        supabase.rpc('get_top_products_detail', { ...baseArgs, p_limit: 10, p_offset: 0 }),
        supabase.rpc('get_sales_by_operator_detail', baseArgs),
        supabase.rpc('get_daily_snapshots', baseArgs),
      ])

      const emptyTotals = {
        from: resolved.from ?? '', to: resolved.to ?? '',
        net_revenue: 0, gross_revenue: 0, discounts_total: 0,
        expenses_total: 0, operating_expenses_total: 0, inventory_expenses_total: 0,
        sales_count: 0, items_sold: 0, customers_count: 0, avg_ticket: 0,
      }

      return {
        kpis: kpisRes.data as unknown as StatsKpis | null,
        comparison: (comparisonRes.data as unknown as StatsTrendsComparison | null) ?? {
          current: emptyTotals, previous: { ...emptyTotals }, days: [],
        },
        breakdown: breakdownRes.data as unknown as StatsBreakdown | null,
        topProducts: (topRes.data as unknown as { data: TopProductRow[] } | null)?.data ?? [],
        operators: normalizeOperatorSalesStatsRows(
          (operatorsRes.data as unknown as { data: OperatorSalesStatsRow[] } | null)?.data ?? []
        ),
        dailySnapshots: (snapshotsRes.data as unknown as { data: DailySnapshotRow[] } | null)?.data ?? [],
      }
    },
    initialData: isInitialRange ? initialData : undefined,
    initialDataUpdatedAt: isInitialRange ? mountedAt : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const report = data ?? initialData

  function handlePeriodChange(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    const resolvedFrom = periodNeedsCustomDates(nextPeriod) ? nextFrom : undefined
    const resolvedTo = periodNeedsCustomDates(nextPeriod) ? nextTo : undefined
    setPeriod(nextPeriod)
    setFrom(resolvedFrom)
    setTo(resolvedTo)
    if (typeof window !== 'undefined') {
      const query = buildDateParams(nextPeriod, resolvedFrom, resolvedTo)
      window.history.replaceState(window.history.state, '', `${pathname}?${query}`)
    }
  }

  const resolvedRange = resolveDateRange(period, from, to)
  const rangeLabel = `${formatDayLabel(resolvedRange.from)} — ${formatDayLabel(resolvedRange.to)}`
  const emittedAt = new Date().toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const { kpis, comparison, breakdown, topProducts, operators, dailySnapshots } = report
  const current = comparison.current
  const previous = comparison.previous

  const totalRevenue = kpis?.total_revenue ?? 0
  const totalUnits = kpis?.total_units ?? 0
  const totalSales = kpis?.total_sales ?? 0
  const avgTicket = kpis?.avg_ticket ?? 0
  const prevAvgTicket = (kpis?.prev_total_sales ?? 0) > 0
    ? (kpis?.prev_total_revenue ?? 0) / (kpis?.prev_total_sales ?? 1)
    : 0

  const grossRevenue = current.gross_revenue ?? 0
  const discounts = current.discounts_total ?? 0
  const netRevenue = current.net_revenue ?? 0
  const expenses = current.expenses_total ?? 0
  const operatingExpenses = current.operating_expenses_total ?? 0
  const inventoryExpenses = current.inventory_expenses_total ?? 0
  const result = netRevenue - expenses
  const prevResult = (previous.net_revenue ?? 0) - (previous.expenses_total ?? 0)

  const categories = useMemo(() => {
    const rows = (breakdown?.by_category ?? []).map(r => ({
      label: r.category_name || 'Sin categoría',
      revenue: r.revenue ?? 0,
      units: r.units ?? 0,
    }))
    const total = rows.reduce((acc, r) => acc + r.revenue, 0)
    return rows
      .map(r => ({ ...r, percent: total > 0 ? (r.revenue / total) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 12)
  }, [breakdown])

  const payments = useMemo(() => {
    const rows = (breakdown?.by_payment ?? []).map(r => ({
      method: r.method, revenue: r.revenue ?? 0, count: r.count ?? 0,
    }))
    const total = rows.reduce((acc, r) => acc + r.revenue, 0)
    return rows
      .map(r => ({ ...r, percent: total > 0 ? (r.revenue / total) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [breakdown])

  const sortedOperators = useMemo(
    () => [...operators].sort((a, b) => (b.total_revenue ?? 0) - (a.total_revenue ?? 0)),
    [operators]
  )

  const hasData = totalSales > 0 || dailySnapshots.length > 0

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #ffffff !important; }
          body * { visibility: hidden !important; }
          #pulsar-report, #pulsar-report * { visibility: visible !important; }
          #pulsar-report {
            position: absolute; left: 0; top: 0; width: 100%;
            margin: 0; padding: 0; box-shadow: none !important;
            border: none !important; border-radius: 0 !important;
          }
          .report-page-break { break-inside: avoid; }
          .report-section { break-inside: avoid; }
        }
        #pulsar-report { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .report-delta { font-size: 11px; font-weight: 600; }
        .report-delta-up { color: #047857; }
        .report-delta-down { color: #dc2626; }
        .report-delta-flat { color: #9ca3af; }
      `}</style>

      <PageHeader title="Reporte de ventas" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <Button onClick={() => window.print()} size="sm" className="gap-2">
          <Printer size={15} />
          Descargar PDF
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto bg-surface-alt">
        {/* Controls — hidden when printing */}
        <div className="print:hidden px-5 pt-4 pb-2 flex items-center gap-4 flex-wrap">
          <Link
            href="/stats"
            className="inline-flex items-center gap-1.5 text-sm text-hint hover:text-body transition-colors"
          >
            <ArrowLeft size={15} />
            Volver
          </Link>
          <DateRangeFilter value={period} from={from} to={to} onChange={handlePeriodChange} />
          {isFetching && <span className="text-xs text-hint">Actualizando…</span>}
        </div>

        <div className="px-5 pb-10 pt-3 flex justify-center">
          <article
            id="pulsar-report"
            className="w-full max-w-[820px] bg-white text-zinc-900 rounded-xl shadow-sm border border-zinc-200 px-10 py-9 space-y-8"
          >
            {/* Cover */}
            <header className="report-section flex items-start justify-between gap-6 border-b border-zinc-200 pb-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">
                  Reporte de ventas
                </p>
                <h1 className="text-2xl font-bold text-zinc-900 mt-1">{businessName}</h1>
                <p className="text-sm text-zinc-500 mt-1">{rangeLabel}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-zinc-900">Pulsar POS</p>
                <p className="text-[11px] text-zinc-400 mt-1">Emitido {emittedAt}</p>
              </div>
            </header>

            {!hasData ? (
              <p className="text-sm text-zinc-500 py-16 text-center">
                No hay ventas registradas en el período seleccionado.
              </p>
            ) : (
              <>
                {/* Financial summary */}
                <section className="report-section space-y-3">
                  <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                    Resumen financiero
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-zinc-200 rounded-lg overflow-hidden border border-zinc-200">
                    <SummaryTile label="Ingresos brutos" value={formatMoney(grossRevenue)}>
                      <Delta current={grossRevenue} previous={previous.gross_revenue ?? 0} />
                    </SummaryTile>
                    <SummaryTile label="Descuentos" value={`- ${formatMoney(discounts)}`} />
                    <SummaryTile label="Ingresos netos" value={formatMoney(netRevenue)}>
                      <Delta current={netRevenue} previous={previous.net_revenue ?? 0} />
                    </SummaryTile>
                    <SummaryTile label="Gastos" value={`- ${formatMoney(expenses)}`}>
                      <Delta current={expenses} previous={previous.expenses_total ?? 0} />
                    </SummaryTile>
                    <SummaryTile
                      label="Resultado (neto − gastos)"
                      value={formatMoney(result)}
                      emphasis
                    >
                      <Delta current={result} previous={prevResult} />
                    </SummaryTile>
                    <SummaryTile label="Ventas" value={totalSales.toLocaleString('es-AR')}>
                      <Delta current={totalSales} previous={kpis?.prev_total_sales ?? 0} />
                    </SummaryTile>
                    <SummaryTile label="Unidades" value={totalUnits.toLocaleString('es-AR')}>
                      <Delta current={totalUnits} previous={kpis?.prev_total_units ?? 0} />
                    </SummaryTile>
                    <SummaryTile label="Ticket promedio" value={formatMoney(avgTicket)}>
                      <Delta current={avgTicket} previous={prevAvgTicket} />
                    </SummaryTile>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Gastos = operativos ({formatMoney(operatingExpenses)}) + mercadería ({formatMoney(inventoryExpenses)}).
                    Comparación vs. período anterior equivalente. Ingresos a precio de venta.
                  </p>
                </section>

                {/* Top products */}
                <section className="report-section space-y-2">
                  <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                    Productos más vendidos
                  </h2>
                  {topProducts.length === 0 ? (
                    <p className="text-sm text-zinc-400">Sin datos</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-zinc-400 text-[11px] uppercase tracking-wide">
                          <th className="text-left font-semibold py-1.5 w-8">#</th>
                          <th className="text-left font-semibold py-1.5">Producto</th>
                          <th className="text-right font-semibold py-1.5">Unidades</th>
                          <th className="text-right font-semibold py-1.5">Ingresos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topProducts.map((p, idx) => (
                          <tr key={p.id} className="border-t border-zinc-100">
                            <td className="py-1.5 text-zinc-400">{idx + 1}</td>
                            <td className="py-1.5 text-zinc-800">{p.name}</td>
                            <td className="py-1.5 text-right tabular-nums text-zinc-700">{p.units_sold ?? 0}</td>
                            <td className="py-1.5 text-right tabular-nums font-medium text-zinc-900">
                              {formatMoney(p.revenue ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* By category */}
                  <section className="report-section space-y-2">
                    <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                      Ingresos por categoría
                    </h2>
                    {categories.length === 0 ? (
                      <p className="text-sm text-zinc-400">Sin datos</p>
                    ) : (
                      <div className="space-y-2">
                        {categories.map(c => (
                          <div key={c.label} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-zinc-700 truncate pr-2">{c.label}</span>
                              <span className="tabular-nums text-zinc-900 font-medium shrink-0">
                                {formatMoney(c.revenue)}
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-zinc-800"
                                style={{ width: `${c.percent}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Payment methods */}
                  <section className="report-section space-y-2">
                    <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                      Métodos de pago
                    </h2>
                    {payments.length === 0 ? (
                      <p className="text-sm text-zinc-400">Sin datos</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {payments.map(p => (
                            <tr key={p.method} className="border-t border-zinc-100 first:border-t-0">
                              <td className="py-1.5 text-zinc-700">{normalizePayment(p.method)}</td>
                              <td className="py-1.5 text-right tabular-nums text-zinc-400 w-12">
                                {p.percent.toFixed(0)}%
                              </td>
                              <td className="py-1.5 text-right tabular-nums font-medium text-zinc-900">
                                {formatMoney(p.revenue)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                </div>

                {/* Operators */}
                {sortedOperators.length > 0 && (
                  <section className="report-section space-y-2">
                    <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                      Ventas por operador
                    </h2>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-zinc-400 text-[11px] uppercase tracking-wide">
                          <th className="text-left font-semibold py-1.5">Operador</th>
                          <th className="text-right font-semibold py-1.5">Ventas</th>
                          <th className="text-right font-semibold py-1.5">Ticket prom.</th>
                          <th className="text-right font-semibold py-1.5">Ingresos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedOperators.map(op => (
                          <tr key={op.operator_id ?? op.operator_name} className="border-t border-zinc-100">
                            <td className="py-1.5 text-zinc-800">{op.operator_name}</td>
                            <td className="py-1.5 text-right tabular-nums text-zinc-700">{op.transactions ?? 0}</td>
                            <td className="py-1.5 text-right tabular-nums text-zinc-700">
                              {formatMoney(op.avg_ticket ?? 0)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums font-medium text-zinc-900">
                              {formatMoney(op.total_revenue ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                {/* Daily detail */}
                {dailySnapshots.length > 0 && (
                  <section className="report-section space-y-2">
                    <h2 className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                      Detalle diario
                    </h2>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-zinc-400 text-[11px] uppercase tracking-wide">
                          <th className="text-left font-semibold py-1.5">Día</th>
                          <th className="text-right font-semibold py-1.5">Ventas</th>
                          <th className="text-right font-semibold py-1.5">Ingreso neto</th>
                          <th className="text-right font-semibold py-1.5">Gastos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailySnapshots.map(s => (
                          <tr key={s.snapshot_date} className="border-t border-zinc-100">
                            <td className="py-1.5 text-zinc-700">{formatShortDay(s.snapshot_date)}</td>
                            <td className="py-1.5 text-right tabular-nums text-zinc-700">{s.sales_count ?? 0}</td>
                            <td className="py-1.5 text-right tabular-nums text-zinc-900">
                              {formatMoney(s.net_revenue ?? 0)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-zinc-500">
                              {formatMoney(s.expenses_total ?? 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                <footer className="report-section pt-4 border-t border-zinc-200 text-[11px] text-zinc-400 text-center">
                  Generado con Pulsar POS · {businessName} · {rangeLabel}
                </footer>
              </>
            )}
          </article>
        </div>
      </div>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  emphasis = false,
  children,
}: {
  label: string
  value: string
  emphasis?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`bg-white px-4 py-3 ${emphasis ? 'bg-zinc-50' : ''}`}>
      <p className="text-[11px] text-zinc-400 leading-tight">{label}</p>
      <p className={`mt-1 font-bold tabular-nums leading-none ${emphasis ? 'text-lg text-zinc-900' : 'text-base text-zinc-900'}`}>
        <PopNumber value={value} />
      </p>
      {children && <div className="mt-1">{children}</div>}
    </div>
  )
}
