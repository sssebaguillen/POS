'use client'

import { Fragment, useMemo, useState } from 'react'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import type { SalesHeatmapCell } from '@/lib/types'

export type HeatmapMetric = 'sales_count' | 'net_revenue'

interface Props {
  cells: SalesHeatmapCell[]
  metric: HeatmapMetric
  compact?: boolean
}

// Postgres DOW is 0=Sun .. 6=Sat. We display Mon..Sun (LATAM convention).
const DAY_ORDER: number[] = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const DAY_LABELS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

interface HoverInfo {
  dayIdx: number
  hour: number
  // viewport coords (used with position: fixed so we don't need a relative ancestor)
  cx: number
  cy: number
}

export default function SalesHeatmap({ cells, metric, compact = false }: Props) {
  const formatMoney = useFormatMoney()
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const grid = useMemo(() => {
    const g: SalesHeatmapCell[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => ({ weekday: -1, hour: -1, sales_count: 0, net_revenue: 0 }))
    )
    for (const c of cells) {
      const dayIdx = DAY_ORDER.indexOf(c.weekday)
      if (dayIdx === -1 || c.hour < 0 || c.hour > 23) continue
      g[dayIdx][c.hour] = c
    }
    return g
  }, [cells])

  const maxValue = useMemo(() => {
    let max = 0
    for (const c of cells) {
      const v = metric === 'sales_count' ? c.sales_count : Number(c.net_revenue)
      if (v > max) max = v
    }
    return max
  }, [cells, metric])

  function intensity(value: number): number {
    if (maxValue <= 0 || value <= 0) return 0
    return Math.min(1, Math.pow(value / maxValue, 0.6))
  }

  const dayColWidth = compact ? '28px' : '44px'
  const gap = compact ? '2px' : '4px'
  const hourLabelStep = compact ? 6 : 3
  const hovered = hover ? grid[hover.dayIdx][hover.hour] : null

  return (
    <div className="w-full">
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `${dayColWidth} repeat(24, minmax(0, 1fr))`,
          columnGap: gap,
          rowGap: gap,
        }}
      >
        {/* corner + hour labels */}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div
            key={`hl-${h}`}
            className="text-[10px] text-hint leading-none flex items-end justify-center pb-1"
          >
            {h % hourLabelStep === 0 ? h.toString().padStart(2, '0') : ''}
          </div>
        ))}

        {/* 7 rows */}
        {Array.from({ length: 7 }, (_, dayIdx) => (
          <Fragment key={`row-${dayIdx}`}>
            <div
              className={`${compact ? 'text-[10px]' : 'text-[11px]'} font-medium text-hint pr-2 text-right self-center leading-none`}
            >
              {DAY_LABELS_SHORT[dayIdx]}
            </div>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = grid[dayIdx][hour]
              const value = metric === 'sales_count' ? cell.sales_count : Number(cell.net_revenue)
              const i = intensity(value)
              const isHover = hover?.dayIdx === dayIdx && hover?.hour === hour
              const bg = i === 0
                ? 'rgb(var(--primary-rgb) / 0.07)'
                : `rgb(var(--primary-rgb) / ${(0.18 + i * 0.82).toFixed(3)})`
              return (
                <button
                  key={`c-${dayIdx}-${hour}`}
                  type="button"
                  className={`aspect-square rounded-[3px] border border-white/[0.03] transition-transform duration-100 outline-none ${
                    isHover ? 'ring-1 ring-primary z-10 relative' : ''
                  }`}
                  style={{ background: bg }}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
                    setHover({
                      dayIdx,
                      hour,
                      cx: rect.left + rect.width / 2,
                      cy: rect.top,
                    })
                  }}
                  onMouseLeave={() => setHover(null)}
                  aria-label={`${DAY_LABELS_FULL[dayIdx]} ${hour.toString().padStart(2, '0')}:00 — ${cell.sales_count} ventas, ${formatMoney(Number(cell.net_revenue))}`}
                />
              )
            })}
          </Fragment>
        ))}
      </div>

      {/* Legend — only in detail mode */}
      {!compact && (
        <div className="flex items-center gap-2 pt-3 text-[10px] text-hint" style={{ paddingLeft: dayColWidth }}>
          <span>Menos</span>
          {[0.1, 0.3, 0.5, 0.75, 1].map((v, i) => (
            <div
              key={i}
              className="h-3 w-5 rounded-[2px] border border-white/[0.03]"
              style={{ background: `rgb(var(--primary-rgb) / ${(0.18 + v * 0.82).toFixed(3)})` }}
            />
          ))}
          <span>Más</span>
        </div>
      )}

      {/* Tooltip — fixed positioning so it always sits next to the cell, no ancestor needed */}
      {hover && hovered && (
        <div
          className="fixed z-50 surface-elevated rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{ left: hover.cx, top: hover.cy - 6 }}
        >
          <p className="font-semibold text-heading whitespace-nowrap">
            {DAY_LABELS_FULL[hover.dayIdx]} · {hover.hour.toString().padStart(2, '0')}:00
          </p>
          <p className="text-body whitespace-nowrap">
            {hovered.sales_count} {hovered.sales_count === 1 ? 'venta' : 'ventas'}
          </p>
          <p className="text-hint whitespace-nowrap">{formatMoney(Number(hovered.net_revenue))}</p>
        </div>
      )}
    </div>
  )
}
