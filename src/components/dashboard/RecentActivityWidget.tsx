import { normalizePayment } from '@/lib/payments'
import type { PaymentMethod } from '@/lib/constants/domain'

interface RecentSale {
  id: string
  total: number
  method: PaymentMethod | 'sin dato'
  created_at: string
}

interface Props {
  sales: RecentSale[]
}

function formatHour(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function RecentActivityWidget({ sales }: Props) {
  return (
    <div className="surface-card p-5 h-full flex flex-col">
      <p className="font-semibold text-heading font-display mb-1">
        Actividad reciente
      </p>
      <p className="text-xs text-hint mb-4">Últimas ventas del período</p>

      {sales.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-hint">Sin ventas en el período</p>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-hidden">
          {sales.map(sale => (
            <div
              key={sale.id}
              className="flex items-center justify-between gap-3 py-2 border-b border-edge/30 last:border-0"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xs text-hint shrink-0 tabular-nums">
                  {formatHour(sale.created_at)}
                </span>
                <span className="text-xs text-hint truncate">
                  {normalizePayment(sale.method)}
                </span>
              </div>
              <span className="text-sm font-semibold text-heading shrink-0 tabular-nums">
                ${sale.total.toLocaleString('es-AR')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
