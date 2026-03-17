import { memo } from 'react'
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
}

function KPICard({ label, value, icon, iconBg, iconColor, trend, subtitle }: Props) {
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
      </div>
    </div>
  )
}

export default memo(KPICard)
