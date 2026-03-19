import type { BusinessBalance } from './types'

interface Props {
  balance: BusinessBalance
}

export default function ExpenseSummaryCards({ balance }: Props) {
  const isPositive = balance.profit >= 0

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <div className="surface-card p-5 flex flex-col gap-3">
        <div>
          <p className="text-label text-hint mb-1">Ingresos del período</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 leading-none">
            ${balance.income.toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      <div className="surface-card p-5 flex flex-col gap-3">
        <div>
          <p className="text-label text-hint mb-1">Egresos del período</p>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400 leading-none">
            ${balance.expenses.toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      <div className="surface-card p-5 flex flex-col gap-3">
        <div>
          <p className="text-label text-hint mb-1">Ganancia neta</p>
          <p className={`text-2xl font-bold leading-none ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {isPositive ? '' : '-'}${Math.abs(balance.profit).toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      <div className="surface-card p-5 flex flex-col gap-3">
        <div>
          <p className="text-label text-hint mb-1">Margen</p>
          <p className={`text-2xl font-bold leading-none ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {balance.margin.toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  )
}
