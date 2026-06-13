'use client'

import { useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import PopNumber from '@/components/shared/PopNumber'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'
import SalesHeatmap, { type HeatmapMetric } from '@/components/stats/SalesHeatmap'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import {
  buildDateParams,
  periodNeedsCustomDates,
  resolveDateRange,
  type DateRangePeriod,
} from '@/lib/date-utils'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import { createClient } from '@/lib/supabase/client'
import type { SalesHeatmapCell } from '@/lib/types'

const METRICS: { key: HeatmapMetric; label: string }[] = [
  { key: 'sales_count', label: 'Ventas' },
  { key: 'net_revenue', label: 'Ingresos' },
]

const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
// Postgres DOW (0=Sun..6=Sat) → CSV order Lun..Dom
const DAY_CSV_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_CSV_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

interface Props {
  businessId: string
  cells: SalesHeatmapCell[]
  period: string
  from?: string
  to?: string
  timezone: string
  metric?: string
}

function asMetric(value: string | undefined): HeatmapMetric {
  return value === 'net_revenue' ? 'net_revenue' : 'sales_count'
}

export default function SalesHeatmapView({
  businessId,
  cells: initialCells,
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
  const [activeMetric, setActiveMetric] = useState<HeatmapMetric>(asMetric(metric))
  const [mountedAt] = useState(() => Date.now())
  const { setRef, indicator } = usePillIndicator(activeMetric)

  const isInitialRange = period === initialPeriod && from === initialFrom && to === initialTo

  const { data, isFetching } = useQuery<SalesHeatmapCell[]>({
    queryKey: ['stats-heatmap', businessId, period, from, to],
    queryFn: async () => {
      const resolved = resolveDateRange(period, from, to, timezone)
      const { data: rpcResult } = await supabase.rpc('get_sales_heatmap', {
        p_business_id: businessId,
        p_from: resolved.from,
        p_to: resolved.to,
      })
      return (rpcResult as unknown as { data: SalesHeatmapCell[] } | null)?.data ?? []
    },
    initialData: isInitialRange ? initialCells : undefined,
    initialDataUpdatedAt: isInitialRange ? mountedAt : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const cells = data ?? initialCells

  function syncUrl(nextPeriod: DateRangePeriod, nextFrom?: string, nextTo?: string, nextMetric?: HeatmapMetric) {
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
    syncUrl(nextPeriod, resolvedFrom, resolvedTo)
  }

  function switchMetric(next: HeatmapMetric) {
    setActiveMetric(next)
    syncUrl(period, from, to, next)
  }

  const totals = useMemo(() => {
    let salesTotal = 0
    let revenueTotal = 0
    for (const c of cells) {
      salesTotal += c.sales_count
      revenueTotal += Number(c.net_revenue)
    }
    return { salesTotal, revenueTotal }
  }, [cells])

  const insights = useMemo(() => {
    if (cells.length === 0) return null
    const valueOf = (c: SalesHeatmapCell) =>
      activeMetric === 'sales_count' ? c.sales_count : Number(c.net_revenue)

    // Top 10 (day, hour) slots — el detalle vive en una columna alta, así que damos más profundidad
    const topSlots = [...cells]
      .map(c => ({ ...c, value: valueOf(c) }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)

    // Best hour aggregated across days
    const byHour = new Map<number, number>()
    for (const c of cells) {
      byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + valueOf(c))
    }
    let bestHour = 0
    let bestHourValue = 0
    for (const [h, v] of byHour) {
      if (v > bestHourValue) { bestHour = h; bestHourValue = v }
    }

    // Best day aggregated across hours
    const byDay = new Map<number, number>()
    for (const c of cells) {
      byDay.set(c.weekday, (byDay.get(c.weekday) ?? 0) + valueOf(c))
    }
    let bestDay = 0
    let bestDayValue = 0
    for (const [d, v] of byDay) {
      if (v > bestDayValue) { bestDay = d; bestDayValue = v }
    }

    return { topSlots, bestHour, bestHourValue, bestDay, bestDayValue }
  }, [cells, activeMetric])

  const csvData = useMemo(() => {
    const rows: Record<string, string | number>[] = []
    const lookup = new Map<string, SalesHeatmapCell>()
    for (const c of cells) lookup.set(`${c.weekday}-${c.hour}`, c)
    for (let i = 0; i < 7; i++) {
      const dow = DAY_CSV_ORDER[i]
      for (let h = 0; h < 24; h++) {
        const cell = lookup.get(`${dow}-${h}`)
        rows.push({
          Día: DAY_CSV_LABELS[i],
          Hora: `${h.toString().padStart(2, '0')}:00`,
          Ventas: cell?.sales_count ?? 0,
          Ingresos: Number(cell?.net_revenue ?? 0),
        })
      }
    }
    return rows
  }, [cells])

  const formatMetricValue = (v: number) =>
    activeMetric === 'sales_count' ? `${v}` : formatMoney(v)

  const hasData = cells.length > 0

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Heatmap de ventas" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <ExportCSVButton data={csvData} filename={`heatmap-${period}`} />
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
            <span>Hora local del negocio · {hasData ? `${cells.length} franjas con actividad` : 'sin datos'}</span>
            {isFetching && <span className="text-primary animate-pulse">· actualizando…</span>}
          </div>

          <div
            className={`grid grid-cols-2 md:grid-cols-4 gap-3 transition-opacity duration-150 ${isFetching ? 'opacity-70' : 'opacity-100'}`}
          >
            <SummaryCard label="Ventas" value={`${totals.salesTotal}`} hint="en el período" />
            <SummaryCard label="Ingresos" value={formatMoney(totals.revenueTotal)} hint="en el período" />
            <SummaryCard
              label="Día más activo"
              value={insights ? DAY_LABELS[insights.bestDay] : '—'}
              hint={insights ? formatMetricValue(insights.bestDayValue) : ' '}
            />
            <SummaryCard
              label="Hora pico"
              value={insights ? `${insights.bestHour.toString().padStart(2, '0')}:00` : '—'}
              hint={insights ? formatMetricValue(insights.bestHourValue) : ' '}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="surface-card p-6 space-y-4 lg:col-span-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-heading font-display">Ventas por día y hora</p>
                  <p className="text-xs text-hint">Intensidad por {activeMetric === 'sales_count' ? 'cantidad de ventas' : 'monto facturado'} · agregado del período</p>
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
                  <p className="text-sm text-hint h-48 flex items-center justify-center">
                    Sin ventas en el período. El heatmap se llena a medida que se registran ventas en el POS.
                  </p>
                ) : (
                  <SalesHeatmap cells={cells} metric={activeMetric} />
                )}
              </div>
            </div>

            <div className="surface-card p-6 space-y-4 lg:col-span-1">
              <div>
                <p className="font-semibold text-heading font-display">Top horarios</p>
                <p className="text-xs text-hint">Las franjas más activas del período</p>
              </div>

              {!insights || insights.topSlots.length === 0 ? (
                <p className="text-sm text-hint">Sin datos suficientes</p>
              ) : (
                <ol className="space-y-3">
                  {insights.topSlots.map((slot, idx) => {
                    const maxValue = insights.topSlots[0].value
                    const pct = maxValue > 0 ? (slot.value / maxValue) * 100 : 0
                    const valueLabel = activeMetric === 'sales_count'
                      ? `${slot.sales_count} ${slot.sales_count === 1 ? 'venta' : 'ventas'}`
                      : formatMoney(Number(slot.net_revenue))
                    return (
                      <li key={`${slot.weekday}-${slot.hour}`} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-hint shrink-0">#{idx + 1}</span>
                            <span className="text-body font-medium truncate">
                              {DAY_LABELS[slot.weekday]} {slot.hour.toString().padStart(2, '0')}:00
                            </span>
                          </span>
                          <span className="text-body font-semibold shrink-0 tabular-nums">{valueLabel}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: `rgb(var(--primary-rgb) / ${(0.4 + (pct / 100) * 0.6).toFixed(2)})`,
                            }}
                          />
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="surface-card p-4 space-y-1">
      <p className="text-label text-hint">{label}</p>
      <PopNumber className="text-xl font-bold text-heading leading-none" value={value} />
      <p className="text-[11px] text-hint pt-1">{hint}</p>
    </div>
  )
}
