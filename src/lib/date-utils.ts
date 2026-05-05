export type DateRangePeriod = 'hoy' | 'semana' | 'mes' | 'trimestre' | 'año' | 'personalizado'

export interface DateRange {
  from: Date
  to: Date
}

export interface DateRangeStrings {
  from: string | null
  to: string | null
}

// Primitive helpers

export function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

export function startOfWeek(date: Date): Date {
  const copy = startOfDay(date)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  return copy
}

export function isCompletedSale(status: string | null): boolean {
  return status === null || status === 'completed'
}

export function getDayLabel(dayIndex: number): string {
  return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dayIndex]
}

// Period → Date objects (client-side components)

export function getDateRange(
  period: DateRangePeriod,
  fromDate?: string,
  toDate?: string
): DateRange {
  const now = new Date()

  if (period === 'hoy') return { from: startOfDay(now), to: endOfDay(now) }
  if (period === 'semana') return { from: startOfWeek(now), to: endOfDay(now) }
  if (period === 'mes') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }
  }

  if (fromDate && toDate) {
    return { from: startOfDay(new Date(fromDate)), to: endOfDay(new Date(toDate)) }
  }

  // Fallback: last 30 days
  const fallback = new Date(now)
  fallback.setDate(fallback.getDate() - 30)
  return { from: startOfDay(fallback), to: endOfDay(now) }
}

// Period → previous period Date objects (for trend comparison)

export function getPreviousPeriodRange(
  period: string,
  currentRange: DateRange
): DateRange {
  const dayMs = 24 * 60 * 60 * 1000

  if (period === 'mes') {
    const prevStart = new Date(currentRange.from)
    prevStart.setMonth(prevStart.getMonth() - 1)
    const prevEnd = new Date(currentRange.to)
    prevEnd.setMonth(prevEnd.getMonth() - 1)
    return { from: prevStart, to: prevEnd }
  }

  const fromDay = new Date(currentRange.from)
  fromDay.setHours(0, 0, 0, 0)
  const toDay = new Date(currentRange.to)
  toDay.setHours(0, 0, 0, 0)
  const numDays = Math.round((toDay.getTime() - fromDay.getTime()) / dayMs) + 1

  return {
    from: new Date(currentRange.from.getTime() - numDays * dayMs),
    to: new Date(currentRange.to.getTime() - numDays * dayMs),
  }
}

// Period → YYYY-MM-DD strings (server pages & client RPCs)

function formatDateLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function resolveDateRange(
  period: DateRangePeriod | string,
  from?: string,
  to?: string
): DateRangeStrings {
  // Explicit dates always take precedence (trimestre, año, personalizado)
  if (from && to) return { from, to }

  if (period === 'personalizado' || period === 'trimestre' || period === 'año') {
    return { from: from ?? null, to: to ?? null }
  }

  const now = new Date()
  const today = formatDateLocal(now)

  if (period === 'hoy') return { from: today, to: today }

  if (period === 'semana') {
    const start = new Date(now)
    const weekday = start.getDay()
    const diff = weekday === 0 ? -6 : 1 - weekday
    start.setDate(start.getDate() + diff)
    return { from: formatDateLocal(start), to: today }
  }

  if (period === 'mes') {
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    return { from: `${y}-${m}-01`, to: today }
  }

  return { from: from ?? null, to: to ?? null }
}

// Helper: does this period carry explicit from/to in URL params?

export function periodNeedsCustomDates(period: DateRangePeriod | string): boolean {
  return period === 'personalizado' || period === 'trimestre' || period === 'año'
}

// Build URL search params for period navigation

export function buildDateParams(
  period: DateRangePeriod,
  from?: string,
  to?: string
): string {
  const params = new URLSearchParams()
  params.set('period', period)
  if (periodNeedsCustomDates(period) && from && to) {
    params.set('from', from)
    params.set('to', to)
  }
  return params.toString()
}
