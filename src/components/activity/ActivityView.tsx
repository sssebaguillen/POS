'use client'

import { useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import ActivityFiltersBar from '@/components/activity/ActivityFiltersBar'
import ActivityResults from '@/components/activity/ActivityResults'
import type {
  ActivityFilterOperator,
  ActivityEntityFilter,
  ActivityLogRow,
  ActivityLookups,
} from '@/components/activity/types'
import { useActivityFilters } from '@/components/activity/useActivityFilters'

interface ActivityViewProps {
  rows: ActivityLogRow[]
  total: number
  page: number
  pageSize: number
  operators: ActivityFilterOperator[]
  entity: ActivityEntityFilter
  operatorFilter: string | null
  period: string
  from: string | undefined
  to: string | undefined
  categoryMap: ActivityLookups['categoryMap']
  brandMap: ActivityLookups['brandMap']
  productMap: ActivityLookups['productMap']
  customerMap: ActivityLookups['customerMap']
}

export default function ActivityView({
  rows,
  total,
  page,
  pageSize,
  operators,
  entity,
  operatorFilter,
  period,
  from,
  to,
  categoryMap,
  brandMap,
  productMap,
  customerMap,
}: ActivityViewProps) {
  const lookups = useMemo<ActivityLookups>(
    () => ({ categoryMap, brandMap, productMap, customerMap }),
    [brandMap, categoryMap, customerMap, productMap],
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const {
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
  } = useActivityFilters({
    entity,
    operatorFilter,
    period,
    from,
    to,
  })

  function toggleExpand(id: string) {
    setExpanded(currentExpanded => {
      const nextExpanded = new Set(currentExpanded)
      if (nextExpanded.has(id)) {
        nextExpanded.delete(id)
      } else {
        nextExpanded.add(id)
      }
      return nextExpanded
    })
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Actividad" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          <ActivityFiltersBar
            entity={entityLocal}
            operator={operatorLocal}
            period={periodLocal}
            from={fromLocal}
            to={toLocal}
            operators={operators}
            onEntityChange={(value) => navigate({ entity: value, page: 1 })}
            onOperatorChange={(value) => navigate({ operator: value, page: 1 })}
            onDateChange={handleDateChange}
          />

          <ActivityResults
            rows={rows}
            total={total}
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            expanded={expanded}
            lookups={lookups}
            isPending={isPending}
            hasActiveFilters={hasActiveFilters}
            onToggleRow={toggleExpand}
            onPageChange={(nextPage) => navigate({ page: nextPage })}
            onClearFilters={clearFilters}
          />
        </div>
      </div>
    </div>
  )
}
