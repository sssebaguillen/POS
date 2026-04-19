import { memo, type ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Trend {
  percent: number
  direction: 'up' | 'down' | 'neutral'
  label: string
}

interface Props {
  label: string
  value: string
  icon: string
  iconBg: string
  iconColor: string
  trend?: Trend
  subtitle?: string
  sparkline?: number[]
  children?: ReactNode
}

function KPICard({ label, value, icon, iconBg, iconColor, trend, subtitle, sparkline, children }: Props) {
  return (
    <div className="surface-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <span className={cn('h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold shrink-0', iconBg, iconColor)}>
          {icon}
        </span>
        {trend && (
          <div
            className={cn(
              'flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
              trend.direction === 'up'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                : trend.direction === 'down'
                ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                : 'bg-muted text-hint'
            )}
          >
            {trend.direction === 'up' && <TrendingUp size={12} />}
            {trend.direction === 'down' && <TrendingDown size={12} />}
            {trend.percent !== 0 ? `${trend.direction === 'up' ? '+' : ''}${trend.percent.toFixed(1)}%` : '—'}
          </div>
        )}
      </div>
      <div>
        <p className="text-label text-hint mb-1">{label}</p>
        <p className="text-2xl font-bold text-heading leading-none">{value}</p>
        {(subtitle ?? trend?.label) && (
          <p className="text-xs text-hint mt-1.5">{subtitle ?? trend?.label}</p>
        )}
        {children}
      </div>
      {sparkline && sparkline.length > 1 && (() => {
        const vals = sparkline
        const min = Math.min(...vals)
        const max = Math.max(...vals)
        const range = max - min || 1
        const W = 100
        const H = 28
        const pad = 2
        const points = vals.map((v, i) => {
          const x = pad + (i / (vals.length - 1)) * (W - pad * 2)
          const y = H - pad - ((v - min) / range) * (H - pad * 2)
          return `${x.toFixed(1)},${y.toFixed(1)}`
        }).join(' ')
        return (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height="28"
            preserveAspectRatio="none"
            className="mt-3 overflow-visible"
          >
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
              className="text-primary/60"
            />
          </svg>
        )
      })()}
    </div>
  )
}

export default memo(KPICard)
