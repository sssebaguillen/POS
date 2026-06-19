import { Bicycle, ShoppingBag } from '@phosphor-icons/react/dist/ssr'
import { ACCENT_CHIP, type AccentTone } from '@/lib/accent-colors'
import { STATUS_LABEL, type CatalogOrderStatus } from './types'

const STATUS_TONE: Record<CatalogOrderStatus, AccentTone> = {
  recibido:     'blue',
  aceptado:     'indigo',
  en_camino:    'amber',
  listo_retiro: 'emerald',
  completado:   'emerald',
  rechazado:    'red',
  cancelado:    'muted',
}

const STATUS_ICON: Partial<Record<CatalogOrderStatus, React.ReactNode>> = {
  en_camino:    <Bicycle size={10} className="shrink-0" />,
  listo_retiro: <ShoppingBag size={10} className="shrink-0" />,
}

export default function StatusBadge({ status }: { status: CatalogOrderStatus }) {
  const icon = STATUS_ICON[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${ACCENT_CHIP[STATUS_TONE[status]]}`}
    >
      {icon}
      {STATUS_LABEL[status]}
    </span>
  )
}
