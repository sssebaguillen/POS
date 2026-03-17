'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/shared/PageHeader'
import SalesHistoryTable from '@/components/dashboard/SalesHistoryTable'

export type Period = 'hoy' | 'semana' | 'mes' | 'personalizado'

interface SaleRow {
  id: string
  created_at: string
  total: number
  status: string | null
  method: string
}

interface Props {
  rows: SaleRow[]
  businessId: string
  period: Period
  from: string
  to: string
}

const PERIOD_LABELS: Record<Period, string> = {
  hoy: 'Hoy',
  semana: 'Esta semana',
  mes: 'Este mes',
  personalizado: 'Personalizado',
}

export default function SalesHistoryView({ rows, businessId, period, from, to }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  const [localFrom, setLocalFrom] = useState(from)
  const [localTo, setLocalTo] = useState(to)

  function navigate(newPeriod: Period, newFrom?: string, newTo?: string) {
    const params = new URLSearchParams()
    params.set('period', newPeriod)
    if (newPeriod === 'personalizado' && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Historial de ventas" />

      <div className="px-4 md:px-6 space-y-3">
        {/* Period tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {(['hoy', 'semana', 'mes', 'personalizado'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => navigate(p)}
              className={`text-sm px-4 py-1.5 rounded-full border transition-colors ${
                period === p
                  ? 'bg-primary text-primary-foreground border-primary font-medium'
                  : 'border-edge text-body hover:bg-hover-bg'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Custom date range inputs */}
        {period === 'personalizado' && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={localFrom}
              onChange={e => setLocalFrom(e.target.value)}
              className="h-9 w-40 rounded-lg text-sm"
            />
            <span className="text-sm text-hint">—</span>
            <Input
              type="date"
              value={localTo}
              onChange={e => setLocalTo(e.target.value)}
              className="h-9 w-40 rounded-lg text-sm"
            />
            <Button
              size="sm"
              className="h-9 rounded-lg text-sm"
              disabled={!localFrom || !localTo}
              onClick={() => navigate('personalizado', localFrom, localTo)}
            >
              Aplicar
            </Button>
          </div>
        )}
      </div>

      <div className="px-4 md:px-6">
        <SalesHistoryTable rows={rows} businessId={businessId} />
      </div>
    </div>
  )
}
