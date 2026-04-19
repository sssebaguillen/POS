import Link from 'next/link'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'

interface BalanceWidgetProps {
  income: number
  expenses: number
  profit: number
  margin: number
  title: string
  periodLabel: string
  chartData: Array<{
    label: string
    value: number
  }>
}

export default function BalanceWidget({
  income,
  expenses,
  profit,
  margin,
  title,
  periodLabel,
  chartData,
}: BalanceWidgetProps) {
  const isPositive = profit >= 0
  const hasChartData = chartData.some(point => point.value > 0)

  return (
    <div className="surface-card p-5 h-full flex flex-col gap-4 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-heading font-display">{title}</p>
          <p className="text-xs text-hint mt-0.5">{periodLabel}</p>
        </div>
        <Link href="/gastos" className="text-xs text-primary font-medium hover:underline shrink-0">
          Ver detalle →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 pb-4 border-b border-edge/40">
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Ingresos</p>
          <p className="text-xl font-semibold text-heading">
            ${income.toLocaleString('es-AR')}
          </p>
        </div>
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Egresos</p>
          <p className="text-xl font-semibold text-heading">
            ${expenses.toLocaleString('es-AR')}
          </p>
        </div>
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Ganancia neta</p>
          <p className={`text-xl font-semibold ${isPositive ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-red-500/80 dark:text-red-400/80'}`}>
            {isPositive ? '' : '-'}${Math.abs(profit).toLocaleString('es-AR')}
          </p>
        </div>
        <div>
          <p className="text-xs text-hint uppercase tracking-wide mb-1">Margen</p>
          <p className={`text-xl font-semibold ${isPositive ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-red-500/80 dark:text-red-400/80'}`}>
            {margin.toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="mt-auto h-24">
        {!hasChartData ? (
          <p className="text-sm text-hint h-full flex items-center justify-center">
            Sin datos para el período
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--color-hint, #9ca3af)' }}
                axisLine={false}
                tickLine={false}
                interval={chartData.length > 10 ? Math.floor(chartData.length / 6) : 0}
              />
              <Tooltip
                cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="surface-card rounded-lg px-3 py-2 text-xs shadow-sm border border-edge/40">
                      <p className="text-hint mb-0.5">{label}</p>
                      <p className="font-semibold text-heading">
                        ${Number(payload[0]?.value ?? 0).toLocaleString('es-AR')}
                      </p>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-primary, currentColor)"
                strokeWidth={1.5}
                fill="var(--color-primary, currentColor)"
                fillOpacity={0.08}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
