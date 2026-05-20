'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { periodNeedsCustomDates, type DateRangePeriod } from '@/lib/date-utils'
import { DEFAULT_ACTIVITY_PERIOD } from '@/components/activity/config'
import { parseActivityPeriod } from '@/components/activity/utils'
import type { ActivityEntityFilter } from '@/components/activity/types'

interface UseActivityFiltersParams {
  entity: ActivityEntityFilter
  operatorFilter: string | null
  period: string
  from: string | undefined
  to: string | undefined
}

export interface ActivityNavigateInput {
  entity?: ActivityEntityFilter
  operator?: string | null
  period?: DateRangePeriod
  from?: string
  to?: string
  page?: number
}

export function useActivityFilters({
  entity,
  operatorFilter,
  period,
  from,
  to,
}: UseActivityFiltersParams) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const resolvedPeriod = parseActivityPeriod(period)
  const [entityLocal, setEntityLocal] = useState<ActivityEntityFilter>(entity)
  const [operatorLocal, setOperatorLocal] = useState<string | null>(operatorFilter)
  const [periodLocal, setPeriodLocal] = useState<DateRangePeriod>(resolvedPeriod)
  const [fromLocal, setFromLocal] = useState<string | undefined>(from)
  const [toLocal, setToLocal] = useState<string | undefined>(to)

  useEffect(() => {
    setEntityLocal(entity)
  }, [entity])

  useEffect(() => {
    setOperatorLocal(operatorFilter)
  }, [operatorFilter])

  useEffect(() => {
    setPeriodLocal(resolvedPeriod)
  }, [resolvedPeriod])

  useEffect(() => {
    setFromLocal(from)
  }, [from])

  useEffect(() => {
    setToLocal(to)
  }, [to])

  function navigate(next: ActivityNavigateInput) {
    const finalEntity = next.entity ?? entityLocal
    const finalOperator = next.operator !== undefined ? next.operator : operatorLocal
    const finalPeriod = next.period ?? periodLocal
    const finalFrom = next.from !== undefined ? next.from : fromLocal
    const finalTo = next.to !== undefined ? next.to : toLocal
    const finalPage = next.page ?? 1

    setEntityLocal(finalEntity)
    setOperatorLocal(finalOperator)
    setPeriodLocal(finalPeriod)
    setFromLocal(finalFrom || undefined)
    setToLocal(finalTo || undefined)

    const params = new URLSearchParams()
    if (finalEntity !== 'all') params.set('entity', finalEntity)
    if (finalOperator && finalOperator !== 'all') params.set('operator', finalOperator)
    if (finalPeriod !== DEFAULT_ACTIVITY_PERIOD) params.set('period', finalPeriod)
    if (periodNeedsCustomDates(finalPeriod) && finalFrom && finalTo) {
      params.set('from', finalFrom)
      params.set('to', finalTo)
    }
    if (finalPage > 1) params.set('page', String(finalPage))

    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname)
    })
  }

  function handleDateChange(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    navigate({
      period: newPeriod,
      from: newFrom ?? '',
      to: newTo ?? '',
      page: 1,
    })
  }

  function clearFilters() {
    navigate({
      entity: 'all',
      operator: null,
      period: DEFAULT_ACTIVITY_PERIOD,
      from: '',
      to: '',
      page: 1,
    })
  }

  const hasActiveFilters =
    entityLocal !== 'all' || operatorLocal !== null || periodLocal !== DEFAULT_ACTIVITY_PERIOD

  return {
    entityLocal,
    operatorLocal,
    periodLocal,
    fromLocal,
    toLocal,
    isPending,
    hasActiveFilters,
    navigate,
    handleDateChange,
    clearFilters,
  }
}
