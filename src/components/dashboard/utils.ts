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

export function getPreviousPeriodRange(
  period: string,
  currentRange: { from: Date; to: Date }
): { from: Date; to: Date } {
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

export function getDayLabel(dayIndex: number): string {
  return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dayIndex]
}