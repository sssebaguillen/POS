'use client'

import { useMemo, useState } from 'react'
import { CircleNotch, ChartLine } from '@phosphor-icons/react/dist/ssr'
import { usePathname } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import {
  buildDateParams,
  periodNeedsCustomDates,
  resolveDateRange,
  type DateRangePeriod,
} from '@/lib/date-utils'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import { createClient } from '@/lib/supabase/client'
import type { StatsTrendsComparison } from '@/lib/types'

type Metric = 'net_revenue' | 'expenses' | 'resultado' | 'sales_count' | 'avg_ticket'

const METRICS: { key: Metric; label: string }[] = [
  { key: 'net_revenue', label: 'Ingresos netos' },
  { key: 'expenses',    label: 'Gastos' },
  { key: 'resultado',   label: 'Resultado' },
  { key: 'sales_count', label: 'Ventas' },
  { key: 'avg_ticket',  label: 'Ticket promedio' },
]

interface Props {
  businessId: string
  comparison: StatsTrendsComparison
  period: string
  from?: string
  to?: string
  timezone: string
  metric?: string
}

function asMetric(value: string | undefined): Metric {
  if (value === 'expenses' || value === 'resultado' || value === 'sales_count' || value === 'avg_ticket' || value === 'net_revenue') {
    return value
  }
  return 'net_revenue'
}

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-')
  if (!month || !day) return iso
  return `${day}/${month}`
}

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

export default function TrendsDetailView({
  businessId,
  comparison: initialComparison,
  period: initialPeriod,
  from: initialFrom,
  to: initialTo,
  timezone,
  metric,
}: Props) {
  const pathname = usePathname()
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])

  const [period, setPeriod] = useState<DateRangePeriod>(initialPeriod as DateRangePeriod)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [activeMetric, setActiveMetric] = useState<Metric>(asMetric(metric))
  const [mountedAt] = useState(() => Date.now())
  const { setRef, indicator } = usePillIndicator(activeMetric)

  const isInitialRange = period === initialPeriod && from === initialFrom && to === initialTo

  const { data, isFetching } = useQuery<StatsTrendsComparison>({
    queryKey: ['stats-trends', businessId, period, from, to],
    queryFn: async () => {
      const resolved = resolveDateRange(period, from, to, timezone)
      const { data: rpcResult } = await supabase.rpc('get_period_comparison', {
        p_business_id: businessId,
        p_from: resolved.from,
        p_to: resolved.to,
      })
      return (rpcResult as unknown as StatsTrendsComparison | null) ?? initialComparison
    },
    initialData: isInitialRange ? initialComparison : undefined,
    initialDataUpdatedAt: isInitialRange ? mountedAt : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const comparison = data ?? initialComparison

  function syncDateUrl(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string, nextMetric?: Metric) {
    if (typeof window === 'undefined') return
    const query = buildDateParams(nextPeriod, nextFrom, nextTo)
    const sp = new URLSearchParams(query)
    sp.set('metric', nextMetric ?? activeMetric)
    window.history.replaceState(window.history.state, '', `${pathname}?${sp.toString()}`)
  }

  function handlePeriodChange(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string) {
    const resolvedFrom = periodNeedsCustomDates(nextPeriod) ? nextFrom : undefined
    const resolvedTo = periodNeedsCustomDates(nextPeriod) ? nextTo : undefined
    setPeriod(nextPeriod)
    setFrom(resolvedFrom)
    setTo(resolvedTo)
    syncDateUrl(nextPeriod, resolvedFrom, resolvedTo)
  }

  function switchMetric(next: Metric) {
    setActiveMetric(next)
    syncDateUrl(period, from, to, next)
  }

  const { current, previous, days } = comparison

  const totals = useMemo(() => ({
    net_revenue: { cur: current.net_revenue, prev: previous.net_revenue },
    expenses:    { cur: current.expenses_total, prev: previous.expenses_total },
    sales_count: { cur: current.sales_count, prev: previous.sales_count },
    avg_ticket:  { cur: current.avg_ticket, prev: previous.avg_ticket },
  }), [current, previous])

  const profit = current.net_revenue - current.expenses_total
  const prevProfit = previous.net_revenue - previous.expenses_total

  const chartData = useMemo(() => days.map(d => ({
    label: formatShortDate(d.current_date),
    currentDate: d.current_date,
    previousDate: d.previous_date,
    current:
      activeMetric === 'net_revenue' ? d.current_net_revenue :
      activeMetric === 'expenses'    ? d.current_expenses :
      activeMetric === 'resultado'   ? d.current_net_revenue - d.current_expenses :
      activeMetric === 'sales_count' ? d.current_sales_count :
                                       d.current_avg_ticket,
    previous:
      activeMetric === 'net_revenue' ? d.previous_net_revenue :
      activeMetric === 'expenses'    ? d.previous_expenses :
      activeMetric === 'resultado'   ? d.previous_net_revenue - d.previous_expenses :
      activeMetric === 'sales_count' ? d.previous_sales_count :
                                       d.previous_avg_ticket,
  })), [days, activeMetric])

  const isMoneyMetric = activeMetric !== 'sales_count'
  const formatValue = (v: number) => isMoneyMetric ? formatMoney(v) : `${Math.round(v)}`

  const csvData = useMemo(() => days.map(d => ({
    Día: d.current_date,
    'Ingresos netos': d.current_net_revenue,
    Gastos: d.current_expenses,
    Ventas: d.current_sales_count,
    'Ticket promedio': d.current_avg_ticket,
    'Día período anterior': d.previous_date,
    'Ingresos netos anterior': d.previous_net_revenue,
    'Gastos anterior': d.previous_expenses,
    'Ventas anterior': d.previous_sales_count,
    'Ticket promedio anterior': d.previous_avg_ticket,
  })), [days])

  const hasData = days.length > 0 && days.some(d =>
    d.current_net_revenue !== 0 || d.current_expenses !== 0 || d.current_sales_count !== 0
    || d.previous_net_revenue !== 0 || d.previous_expenses !== 0 || d.previous_sales_count !== 0
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Tendencias diarias" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <ExportCSVButton data={csvData} filename={`trends-${period}`} />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          <DateRangeFilter
            value={period}
            from={from}
            to={to}
            onChange={handlePeriodChange}
          />

          <div className="flex items-center gap-2 text-xs text-hint">
            <span>Período anterior comparado: <span className="font-medium text-body">{previous.from} → {previous.to}</span></span>
            {isFetching && (
              <span className="flex items-center gap-1.5 text-hint shrink-0">
                <CircleNotch size={13} className="animate-spin" />
                Actualizando...
              </span>
            )}
          </div>

          <div
            className={`grid grid-cols-2 md:grid-cols-4 gap-3 transition-opacity duration-150 ${isFetching ? 'opacity-70' : 'opacity-100'}`}
          >
            <SummaryCard
              label="Ingresos netos"
              value={formatMoney(totals.net_revenue.cur)}
              delta={deltaPct(totals.net_revenue.cur, totals.net_revenue.prev)}
              prevValue={formatMoney(totals.net_revenue.prev)}
            />
            <SummaryCard
              label="Gastos"
              value={formatMoney(totals.expenses.cur)}
              delta={deltaPct(totals.expenses.cur, totals.expenses.prev)}
              prevValue={formatMoney(totals.expenses.prev)}
              invertDeltaColor
            />
            <SummaryCard
              label="Resultado"
              value={formatMoney(profit)}
              delta={deltaPct(profit, prevProfit)}
              prevValue={formatMoney(prevProfit)}
            />
            <SummaryCard
              label="Ventas"
              value={`${totals.sales_count.cur}`}
              delta={deltaPct(totals.sales_count.cur, totals.sales_count.prev)}
              prevValue={`${totals.sales_count.prev}`}
            />
          </div>

          <div className="surface-card p-6 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-semibold text-heading font-display">Comparativa día a día</p>
                <p className="text-xs text-hint">Período actual vs período anterior, alineado por offset</p>
              </div>
              <div className="pill-tabs">
                {indicator && (
                  <span
                    className="pill-tab-indicator"
                    style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
                  />
                )}
                {METRICS.map(m => (
                  <button
                    key={m.key}
                    type="button"
                    ref={setRef(m.key)}
                    onClick={() => switchMetric(m.key)}
                    className={`pill-tab${activeMetric === m.key ? ' pill-tab-active' : ''}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`transition-opacity duration-150 ${isFetching ? 'opacity-70' : 'opacity-100'}`}>
              {!hasData ? (
                <div className="h-72 flex flex-col items-center justify-center text-center gap-2">
                  <span className="flex items-center justify-center w-9 h-9 rounded-full bg-muted text-hint">
                    <ChartLine size={18} />
                  </span>
                  <p className="text-sm font-medium text-heading">Sin datos para el período</p>
                  <p className="text-xs text-hint max-w-xs">Las tendencias se llenan a medida que se generan ventas y gastos.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-edge)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: 'var(--color-hint)' }}
                      interval={chartData.length > 14 ? Math.floor(chartData.length / 7) : 0}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--color-hint)' }}
                      tickFormatter={v =>
                        isMoneyMetric
                          ? (v >= 1000 ? `${formatMoney(v / 1000)}k` : formatMoney(v))
                          : `${v}`
                      }
                      width={isMoneyMetric ? 60 : 40}
                      tickCount={5}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const cur = payload.find(p => p.dataKey === 'current')
                        const prev = payload.find(p => p.dataKey === 'previous')
                        const row = (cur?.payload ?? prev?.payload) as { currentDate: string; previousDate: string } | undefined
                        return (
                          <div className="surface-elevated rounded-xl p-3 text-xs space-y-1 shadow-sm">
                            <p className="font-semibold text-heading">{row?.currentDate}</p>
                            <p className="text-body">
                              Actual: <span className="font-medium">{formatValue(Number(cur?.value ?? 0))}</span>
                            </p>
                            <p className="text-hint">
                              {row?.previousDate}: <span className="font-medium">{formatValue(Number(prev?.value ?? 0))}</span>
                            </p>
                          </div>
                        )
                      }}
                    />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="current"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                      name="Actual"
                    />
                    <Line
                      type="monotone"
                      dataKey="previous"
                      stroke="var(--color-hint)"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      name="Anterior"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  label, value, delta, prevValue, invertDeltaColor,
}: {
  label: string
  value: string
  delta: number | null
  prevValue: string
  invertDeltaColor?: boolean
}) {
  let deltaClass = 'text-hint'
  let deltaText = '—'
  if (delta !== null) {
    const positive = delta >= 0
    const good = invertDeltaColor ? !positive : positive
    deltaClass = good ? 'text-success' : 'text-destructive'
    deltaText = `${positive ? '+' : ''}${delta.toFixed(1)}%`
  }
  return (
    <div className="surface-card p-4 space-y-1">
      <p className="text-label text-hint">{label}</p>
      <PopNumber className="text-xl font-bold text-heading leading-none" value={value} />
      <div className="flex items-baseline gap-2 pt-1">
        <span className={`text-xs font-medium ${deltaClass}`}>{deltaText}</span>
        <span className="text-[11px] text-hint">vs {prevValue}</span>
      </div>
    </div>
  )
}
