'use client'

import type { BusinessBalance } from './types'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import PopNumber from '@/components/shared/PopNumber'

interface Props {
  balance: BusinessBalance
  isFiltered?: boolean
}

export default function ExpenseSummaryCards({ balance, isFiltered }: Props) {
  const formatMoney = useFormatMoney()
  const isPositive = balance.profit >= 0

  return (
    <div className="surface-card overflow-hidden">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        <div className="px-6 py-5 border-r border-b lg:border-b-0 border-edge/40">
          <p className="text-label text-hint mb-2">Ingresos del período</p>
          <PopNumber value={formatMoney(balance.income)} className="font-display text-xl font-bold text-foreground leading-none tabular-nums" />
        </div>

        <div className="px-6 py-5 border-b lg:border-b-0 lg:border-r border-edge/40">
          <p className="text-label text-hint mb-2">Egresos del período</p>
          <PopNumber value={formatMoney(balance.expenses)} className="font-display text-xl font-bold text-destructive leading-none tabular-nums" />
        </div>

        <div className="px-6 py-5 border-r border-edge/40">
          <p className="text-label text-hint mb-2">Ganancia neta</p>
          <PopNumber value={`${isPositive ? '' : '-'}${formatMoney(Math.abs(balance.profit))}`} className={`font-display text-xl font-bold leading-none tabular-nums ${isPositive ? 'text-foreground' : 'text-destructive'}`} />
        </div>

        <div className="px-6 py-5">
          <p className="text-label text-hint mb-2">Margen</p>
          {isFiltered ? (
            <p className="font-display text-xl font-bold leading-none text-hint">—</p>
          ) : (
            <PopNumber value={`${balance.margin.toFixed(1)}%`} className={`font-display text-xl font-bold leading-none ${isPositive ? 'text-foreground' : 'text-destructive'}`} />
          )}
        </div>
      </div>
    </div>
  )
}
