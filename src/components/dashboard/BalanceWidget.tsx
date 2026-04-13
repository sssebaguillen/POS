import Link from 'next/link'

interface BalanceWidgetProps {
  income: number
  expenses: number
  profit: number
  margin: number
}

export default function BalanceWidget({ income, expenses, profit, margin }: BalanceWidgetProps) {
  const isPositive = profit >= 0

  return (
    <div className="surface-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-heading font-display">Balance del mes</p>
        <Link href="/expenses" className="text-xs text-primary font-medium hover:underline">
          Ver detalle →
        </Link>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="text-body">Ingresos</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            ${income.toLocaleString('es-AR')}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-body">Egresos</span>
          <span className="font-semibold text-red-600 dark:text-red-400">
            ${expenses.toLocaleString('es-AR')}
          </span>
        </div>
        <div className="h-px bg-edge/60 my-1" />
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-body">Ganancia neta</span>
          <span className={`text-base font-bold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {isPositive ? '' : '-'}${Math.abs(profit).toLocaleString('es-AR')}
          </span>
        </div>
        <p className={`text-xs ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          Margen: {margin.toFixed(1)}%
        </p>
      </div>
    </div>
  )
}
