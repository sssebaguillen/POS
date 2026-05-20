'use client'

import SelectDropdown from '@/components/ui/SelectDropdown'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import EntityChips from '@/components/activity/EntityChips'
import { OWNER_OPERATOR_FILTER_VALUE } from '@/components/activity/config'
import type { DateRangePeriod } from '@/lib/date-utils'
import type { ActivityEntityFilter, ActivityFilterOperator } from '@/components/activity/types'

interface ActivityFiltersBarProps {
  entity: ActivityEntityFilter
  operator: string | null
  period: DateRangePeriod
  from: string | undefined
  to: string | undefined
  operators: ActivityFilterOperator[]
  onEntityChange: (value: ActivityEntityFilter) => void
  onOperatorChange: (value: string | null) => void
  onDateChange: (period: DateRangePeriod, from?: string, to?: string) => void
}

export default function ActivityFiltersBar({
  entity,
  operator,
  period,
  from,
  to,
  operators,
  onEntityChange,
  onOperatorChange,
  onDateChange,
}: ActivityFiltersBarProps) {
  const operatorValue = operator ?? 'all'
  const operatorOptions = [
    { value: 'all', label: 'Todos los operadores' },
    { value: OWNER_OPERATOR_FILTER_VALUE, label: 'Dueño' },
    ...operators.map(currentOperator => ({
      value: currentOperator.id,
      label: currentOperator.name,
    })),
  ]

  return (
    <>
      <DateRangeFilter
        value={period}
        from={from}
        to={to}
        onChange={onDateChange}
      />

      <div className="flex flex-wrap items-center gap-2">
        <EntityChips value={entity} onChange={onEntityChange} />

        <div className="min-w-[200px] ml-auto">
          <SelectDropdown
            value={operatorValue}
            onChange={(value) => onOperatorChange(value === 'all' ? null : value)}
            options={operatorOptions}
            usePortal
          />
        </div>
      </div>
    </>
  )
}
