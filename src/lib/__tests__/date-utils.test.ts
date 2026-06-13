import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  isCompletedSale,
  getDateRange,
  getPreviousPeriodRange,
  resolveDateRange,
  todayInTimeZone,
  periodNeedsCustomDates,
  buildDateParams,
} from '@/lib/date-utils'

afterEach(() => {
  vi.useRealTimers()
})

describe('startOfDay', () => {
  it('zeroes the time component', () => {
    const d = startOfDay(new Date(2026, 5, 15, 14, 37, 22, 500))
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
    expect(d.getDate()).toBe(15)
  })

  it('does not mutate the input', () => {
    const input = new Date(2026, 5, 15, 14, 0, 0)
    startOfDay(input)
    expect(input.getHours()).toBe(14)
  })
})

describe('endOfDay', () => {
  it('sets time to the last millisecond of the day', () => {
    const d = endOfDay(new Date(2026, 5, 15, 1, 2, 3))
    expect(d.getHours()).toBe(23)
    expect(d.getMinutes()).toBe(59)
    expect(d.getSeconds()).toBe(59)
    expect(d.getMilliseconds()).toBe(999)
  })
})

describe('startOfWeek', () => {
  it('returns the Monday for a midweek date (Wed 2026-06-17 → Mon 2026-06-15)', () => {
    const d = startOfWeek(new Date(2026, 5, 17, 10, 0, 0))
    expect(d.getDay()).toBe(1) // Monday
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(0)
  })

  it('returns the same day when given a Monday', () => {
    const d = startOfWeek(new Date(2026, 5, 15, 10, 0, 0))
    expect(d.getDate()).toBe(15)
    expect(d.getDay()).toBe(1)
  })

  it('maps Sunday back to the previous Monday (Sun 2026-06-21 → Mon 2026-06-15)', () => {
    const d = startOfWeek(new Date(2026, 5, 21, 10, 0, 0))
    expect(d.getDay()).toBe(1)
    expect(d.getDate()).toBe(15)
  })
})

describe('isCompletedSale', () => {
  it('treats null status as completed', () => {
    expect(isCompletedSale(null)).toBe(true)
  })

  it('treats "completed" as completed', () => {
    expect(isCompletedSale('completed')).toBe(true)
  })

  it('treats other statuses as not completed', () => {
    expect(isCompletedSale('cancelled')).toBe(false)
    expect(isCompletedSale('refunded')).toBe(false)
  })
})

describe('getDateRange', () => {
  it('hoy → start and end of today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17, 15, 30, 0))
    const { from, to } = getDateRange('hoy')
    expect(from.getDate()).toBe(17)
    expect(from.getHours()).toBe(0)
    expect(to.getDate()).toBe(17)
    expect(to.getHours()).toBe(23)
  })

  it('semana → Monday to end of today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17, 15, 30, 0)) // Wednesday
    const { from, to } = getDateRange('semana')
    expect(from.getDate()).toBe(15) // Monday
    expect(from.getHours()).toBe(0)
    expect(to.getDate()).toBe(17)
    expect(to.getHours()).toBe(23)
  })

  it('mes → first of month to end of today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17, 15, 30, 0))
    const { from, to } = getDateRange('mes')
    expect(from.getDate()).toBe(1)
    expect(from.getMonth()).toBe(5) // June
    expect(to.getDate()).toBe(17)
  })

  it('custom period with explicit from/to zeroes/maxes the time components', () => {
    // NOTE: a 'YYYY-MM-DD' string is parsed as UTC midnight, then startOfDay/endOfDay
    // shift it into the local (UTC-3) day — so the local calendar day can land one
    // earlier than the literal string. We assert the time-of-day contract here and
    // pin the UTC-shift behavior explicitly in the test below.
    const { from, to } = getDateRange('personalizado', '2026-01-10', '2026-01-31')
    expect(from.getHours()).toBe(0)
    expect(from.getMinutes()).toBe(0)
    expect(to.getHours()).toBe(23)
    expect(to.getMinutes()).toBe(59)
    expect(from.getTime()).toBeLessThan(to.getTime())
  })

  it('parses a YYYY-MM-DD custom date as UTC, shifting back one local day under UTC-3', () => {
    // Documents a real edge: new Date('2026-01-01') is UTC midnight = 2025-12-31 21:00
    // in Buenos Aires, so startOfDay lands on Dec 31. Worth knowing for custom ranges.
    const { from } = getDateRange('personalizado', '2026-01-01', '2026-01-31')
    expect(from.getFullYear()).toBe(2025)
    expect(from.getMonth()).toBe(11) // December
    expect(from.getDate()).toBe(31)
  })

  it('falls back to ~30 days before today (start of that day) when custom dates are missing', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17, 12, 0, 0)) // 2026-06-17
    const { from, to } = getDateRange('personalizado')
    // 30 days before June 17 = May 18, zeroed to start of day
    expect(from.getMonth()).toBe(4) // May
    expect(from.getDate()).toBe(18)
    expect(from.getHours()).toBe(0)
    // upper bound is end of today
    expect(to.getDate()).toBe(17)
    expect(to.getHours()).toBe(23)
  })
})

describe('getPreviousPeriodRange', () => {
  it('mes → shifts the range back one calendar month', () => {
    const current = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 30) }
    const prev = getPreviousPeriodRange('mes', current)
    expect(prev.from.getMonth()).toBe(4) // May
    expect(prev.to.getMonth()).toBe(4)
  })

  it('non-month → shifts back by the same number of days', () => {
    // 7-day inclusive range
    const current = { from: new Date(2026, 5, 8), to: new Date(2026, 5, 14) }
    const prev = getPreviousPeriodRange('semana', current)
    // previous 7-day window ends the day before current.from
    expect(prev.to.getDate()).toBe(7)
    expect(prev.from.getDate()).toBe(1)
  })
})

describe('resolveDateRange', () => {
  it('explicit from/to always take precedence', () => {
    expect(resolveDateRange('hoy', '2026-01-01', '2026-01-31')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    })
  })

  it('hoy → today as both from and to', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17, 9, 0, 0))
    expect(resolveDateRange('hoy')).toEqual({ from: '2026-06-17', to: '2026-06-17' })
  })

  it('semana → Monday to today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17, 9, 0, 0)) // Wednesday
    expect(resolveDateRange('semana')).toEqual({ from: '2026-06-15', to: '2026-06-17' })
  })

  it('mes → first of month to today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 17, 9, 0, 0))
    expect(resolveDateRange('mes')).toEqual({ from: '2026-06-01', to: '2026-06-17' })
  })

  it('trimestre/año/personalizado without dates → nulls', () => {
    expect(resolveDateRange('trimestre')).toEqual({ from: null, to: null })
    expect(resolveDateRange('año')).toEqual({ from: null, to: null })
    expect(resolveDateRange('personalizado')).toEqual({ from: null, to: null })
  })
})

describe('resolveDateRange con timezone', () => {
  const TZ = 'America/Argentina/Buenos_Aires'

  it('a las 22:00 ART, "hoy" es el día local aunque UTC ya sea mañana', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T01:00:00Z')) // = 2026-06-12 22:00 ART
    expect(todayInTimeZone(TZ)).toBe('2026-06-12')
    expect(todayInTimeZone('UTC')).toBe('2026-06-13')
    expect(resolveDateRange('hoy', undefined, undefined, TZ)).toEqual({
      from: '2026-06-12',
      to: '2026-06-12',
    })
  })

  it('semana → lunes local cuando el día local es domingo (retrocede 6 días)', () => {
    vi.useFakeTimers()
    // 2026-06-15 es lunes; 2026-06-14 domingo. 02:00Z del 15 = 23:00 ART del 14 (domingo ART).
    vi.setSystemTime(new Date('2026-06-15T02:00:00Z'))
    expect(todayInTimeZone(TZ)).toBe('2026-06-14') // domingo local
    expect(resolveDateRange('semana', undefined, undefined, TZ)).toEqual({
      from: '2026-06-08', // lunes anterior
      to: '2026-06-14',
    })
  })

  it('mes → primero del mes local', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T01:00:00Z')) // 2026-06-12 22:00 ART
    expect(resolveDateRange('mes', undefined, undefined, TZ)).toEqual({
      from: '2026-06-01',
      to: '2026-06-12',
    })
  })
})

describe('periodNeedsCustomDates', () => {
  it('is true for trimestre, año, personalizado', () => {
    expect(periodNeedsCustomDates('trimestre')).toBe(true)
    expect(periodNeedsCustomDates('año')).toBe(true)
    expect(periodNeedsCustomDates('personalizado')).toBe(true)
  })

  it('is false for hoy, semana, mes', () => {
    expect(periodNeedsCustomDates('hoy')).toBe(false)
    expect(periodNeedsCustomDates('semana')).toBe(false)
    expect(periodNeedsCustomDates('mes')).toBe(false)
  })
})

describe('buildDateParams', () => {
  it('includes only the period for non-custom periods', () => {
    expect(buildDateParams('hoy')).toBe('period=hoy')
    expect(buildDateParams('mes')).toBe('period=mes')
  })

  it('includes from/to for custom periods when provided', () => {
    expect(buildDateParams('personalizado', '2026-01-01', '2026-01-31')).toBe(
      'period=personalizado&from=2026-01-01&to=2026-01-31'
    )
  })

  it('omits from/to for custom periods when not provided', () => {
    expect(buildDateParams('trimestre')).toBe('period=trimestre')
  })

  it('ignores from/to for non-custom periods even when provided', () => {
    expect(buildDateParams('hoy', '2026-01-01', '2026-01-31')).toBe('period=hoy')
  })
})
