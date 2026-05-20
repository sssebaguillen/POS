import { VALID_PERIODS, type DateRangePeriod } from '@/lib/date-utils'
import { DEFAULT_ACTIVITY_PERIOD } from '@/components/activity/config'

export function parseActivityPeriod(value: string | undefined): DateRangePeriod {
  if (value && VALID_PERIODS.includes(value as DateRangePeriod)) {
    return value as DateRangePeriod
  }
  return DEFAULT_ACTIVITY_PERIOD
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.max(0, Math.floor((now - then) / 1000))

  if (diffSec < 5) return 'ahora'
  if (diffSec < 60) return `hace ${diffSec} s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `hace ${diffD} d`
  const diffW = Math.floor(diffD / 7)
  if (diffW < 5) return `hace ${diffW} sem`

  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatFullTimestamp(iso: string, includeSeconds = true): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
  })
}
