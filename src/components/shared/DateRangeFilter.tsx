'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'
import { DatePicker } from '@/components/ui/DatePicker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { DateRangePeriod } from '@/lib/date-utils'

export type { DateRangePeriod } from '@/lib/date-utils'

const PERIOD_LABELS: Record<DateRangePeriod, string> = {
  hoy: 'Hoy',
  semana: 'Esta semana',
  mes: 'Este mes',
  trimestre: 'Trimestre',
  año: 'Este año',
  personalizado: 'Personalizado',
}

const SIMPLE_PERIODS = ['hoy', 'semana', 'mes'] as const

interface DateRangeFilterProps {
  value: DateRangePeriod
  from?: string
  to?: string
  onChange?: (period: DateRangePeriod, from?: string, to?: string) => void
  useUrlParams?: boolean
}

export default function DateRangeFilter({ value, from, to, onChange, useUrlParams }: DateRangeFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [localFrom, setLocalFrom] = useState(from ?? '')
  const [localTo, setLocalTo] = useState(to ?? '')
  const [quarterOpen, setQuarterOpen] = useState(false)
  const [activeQuarter, setActiveQuarter] = useState<string | null>(null)

  const year = new Date().getFullYear()
  const QUARTER_RANGES: Record<string, { from: string; to: string; label: string }> = {
    Q1: { from: `${year}-01-01`, to: `${year}-03-31`, label: 'Q1' },
    Q2: { from: `${year}-04-01`, to: `${year}-06-30`, label: 'Q2' },
    Q3: { from: `${year}-07-01`, to: `${year}-09-30`, label: 'Q3' },
    Q4: { from: `${year}-10-01`, to: `${year}-12-31`, label: 'Q4' },
  }

  function handleSelect(period: DateRangePeriod, newFrom?: string, newTo?: string) {
    if (useUrlParams) {
      const params = new URLSearchParams()
      params.set('period', period)
      if (period === 'personalizado' && newFrom && newTo) {
        params.set('from', newFrom)
        params.set('to', newTo)
      }
      router.push(`${pathname}?${params.toString()}`)
    } else if (onChange) {
      onChange(period, newFrom, newTo)
    }
  }

  function handleQuarterSelect(key: string) {
    const { from: qFrom, to: qTo } = QUARTER_RANGES[key]
    setActiveQuarter(key)
    setQuarterOpen(false)
    handleSelect('trimestre', qFrom, qTo)
  }

  function handleYearSelect() {
    const year = new Date().getFullYear()
    handleSelect('año', `${year}-01-01`, `${year}-12-31`)
  }

  const quarterLabel = value === 'trimestre' && activeQuarter ? activeQuarter : PERIOD_LABELS['trimestre']

  return (
    <div className="space-y-2">
      <div className="pill-tabs">
        {SIMPLE_PERIODS.map(p => (
          <button
            key={p}
            onClick={() => handleSelect(p)}
            className={`pill-tab${value === p ? ' pill-tab-active' : ''}`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}

        <Popover open={quarterOpen} onOpenChange={setQuarterOpen}>
          <PopoverTrigger asChild>
            <button className={`pill-tab${value === 'trimestre' ? ' pill-tab-active' : ''}`}>
              {quarterLabel}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-2" align="start">
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(QUARTER_RANGES).map(([key, { label }]) => (
                <button
                  key={key}
                  onClick={() => handleQuarterSelect(key)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-border bg-surface hover:bg-muted transition-colors font-medium"
                >
                  {label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <button
          onClick={handleYearSelect}
          className={`pill-tab${value === 'año' ? ' pill-tab-active' : ''}`}
        >
          {PERIOD_LABELS['año']}
        </button>

        <button
          onClick={() => handleSelect('personalizado')}
          className={`pill-tab${value === 'personalizado' ? ' pill-tab-active' : ''}`}
        >
          {PERIOD_LABELS['personalizado']}
        </button>
      </div>

      {value === 'personalizado' && (
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker value={localFrom} onChange={setLocalFrom} className="w-40" />
          <span className="text-sm text-hint">—</span>
          <DatePicker value={localTo} onChange={setLocalTo} className="w-40" />
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-lg border border-border bg-surface hover:bg-muted transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!localFrom || !localTo}
            onClick={() => handleSelect('personalizado', localFrom, localTo)}
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  )
}
