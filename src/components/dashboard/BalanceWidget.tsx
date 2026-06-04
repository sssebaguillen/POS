'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import PopNumber from '@/components/shared/PopNumber'
import { ACCENT_FILL } from '@/lib/accent-colors'
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_COLORS, type ExpenseCategory } from '@/components/expenses/types'

interface BalanceWidgetProps {
  income: number
  expenses: number
  profit: number
  margin: number
  title: string
  periodLabel: string
  byCategory: Record<string, number>
}

function categoryColor(key: string): string {
  return EXPENSE_CATEGORY_COLORS[key as ExpenseCategory] ?? ACCENT_FILL.muted
}

function categoryLabel(key: string): string {
  return EXPENSE_CATEGORY_LABELS[key as ExpenseCategory] ?? key
}

function formatPct(pct: number): string {
  return pct >= 1 ? `${Math.round(pct)}%` : '<1%'
}

export default function BalanceWidget({
  income,
  expenses,
  profit,
  margin,
  title,
  periodLabel,
  byCategory,
}: BalanceWidgetProps) {
  const fmt = useFormatMoney()
  const isPositive = profit >= 0
  const positiveClass = 'text-emerald-600/80 dark:text-emerald-400/80'
  const negativeClass = 'text-red-500/80 dark:text-red-400/80'

  const entries = Object.entries(byCategory)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
  const categorizedTotal = entries.reduce((sum, [, value]) => sum + value, 0) || 1
  const visible = entries.slice(0, 5)
  const hiddenCount = entries.length - visible.length

  return (
    <div className="surface-card p-5 h-full flex flex-col gap-4 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-heading font-display">{title}</p>
          <p className="text-xs text-hint mt-0.5">{periodLabel}</p>
        </div>
        <Link href="/expenses" className="text-xs text-primary font-medium hover:underline shrink-0">
          Ver detalle →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 pb-4 border-b border-edge/40">
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Ingresos</p>
          <PopNumber value={fmt(income)} className="block text-xl font-semibold text-heading tabular-nums" />
        </div>
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Egresos</p>
          <PopNumber value={fmt(expenses)} className="block text-xl font-semibold text-heading tabular-nums" />
        </div>
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Ganancia neta</p>
          <PopNumber value={`${isPositive ? '' : '-'}${fmt(Math.abs(profit))}`} className={`block text-xl font-semibold tabular-nums ${isPositive ? positiveClass : negativeClass}`} />
        </div>
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Margen</p>
          <PopNumber value={`${margin.toFixed(1)}%`} className={`block text-xl font-semibold tabular-nums ${isPositive ? positiveClass : negativeClass}`} />
        </div>
      </div>

      {/* Composición de egresos por categoría: barra segmentada + lista */}
      <div className="flex-1 flex flex-col min-h-0">
        {entries.length === 0 ? (
          <p className="text-sm text-hint flex-1 flex items-center justify-center">Sin egresos en el período</p>
        ) : (
          <>
            <p className="text-xs text-hint uppercase tracking-wide mb-2.5">Egresos por categoría</p>

            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted/60 gap-0.5">
              {entries.map(([key, value]) => (
                <div
                  key={key}
                  className={categoryColor(key)}
                  style={{ width: `${(value / categorizedTotal) * 100}%` }}
                />
              ))}
            </div>

            <div className="mt-4 flex-1 flex flex-col justify-between gap-2">
              {visible.map(([key, value]) => (
                <div key={key} className="flex items-center gap-2.5">
                  <span className={cn('shrink-0 w-2 h-2 rounded-full', categoryColor(key))} />
                  <span className="text-sm text-body flex-1 min-w-0 truncate">
                    {categoryLabel(key)}
                  </span>
                  <span className="text-xs text-hint tabular-nums shrink-0 w-10 text-right">
                    {formatPct((value / categorizedTotal) * 100)}
                  </span>
                  <span className="text-sm font-semibold text-heading tabular-nums shrink-0 text-right">
                    {fmt(value)}
                  </span>
                </div>
              ))}
              {hiddenCount > 0 && (
                <p className="text-xs text-hint pl-[18px]">+{hiddenCount} categoría{hiddenCount > 1 ? 's' : ''} más</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
