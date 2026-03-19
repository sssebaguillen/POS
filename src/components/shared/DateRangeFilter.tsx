'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'
import { DatePicker } from '@/components/ui/DatePicker'

export type DateRangePeriod = 'hoy' | 'semana' | 'mes' | 'personalizado'

const PERIOD_LABELS: Record<DateRangePeriod, string> = {
  hoy: 'Hoy',
  semana: 'Esta semana',
  mes: 'Este mes',
  personalizado: 'Personalizado',
}

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

  return (
    <div className="space-y-2">
      <div className="pill-tabs">
        {(['hoy', 'semana', 'mes', 'personalizado'] as DateRangePeriod[]).map(p => (
          <button
            key={p}
            onClick={() => handleSelect(p)}
            className={`pill-tab${value === p ? ' pill-tab-active' : ''}`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
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
