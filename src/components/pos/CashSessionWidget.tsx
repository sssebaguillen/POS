'use client'

import { useMemo } from 'react'
import { Vault, Warning } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import PopNumber from '@/components/shared/PopNumber'

interface ActiveSession {
  id: string
  opening_amount: number
  opened_at: string
  opened_by_name: string
  sales_count: number
  sales_total: number
}

interface Props {
  session: ActiveSession | null
  onOpenClick: () => void
  onCloseClick: () => void
}

function formatTime(isoString: string) {
  return new Date(isoString).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export default function CashSessionWidget({ session, onOpenClick, onCloseClick }: Props) {
  const formatMoney = useFormatMoney()

  if (!session) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-warning">
        <Warning size={14} className="shrink-0" />
        <span className="text-xs font-medium flex-1">No hay caja abierta</span>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpenClick}
          className="h-6 text-xs px-2 border-warning/30 text-warning hover:bg-warning/10"
        >
          Abrir caja
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-promo/10 border border-promo/20">
      <Vault size={14} className="shrink-0 text-promo" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-promo">Caja abierta</span>
          <span className="text-xs text-muted-foreground">· {formatTime(session.opened_at)}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          <PopNumber value={String(session.sales_count)} />{' '}
          {session.sales_count === 1 ? 'venta' : 'ventas'} ·{' '}
          <PopNumber value={formatMoney(session.sales_total)} />
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onCloseClick}
        className="h-6 text-xs px-2 shrink-0"
      >
        Cerrar
      </Button>
    </div>
  )
}
