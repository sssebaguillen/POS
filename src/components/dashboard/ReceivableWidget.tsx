'use client'

import Link from 'next/link'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import PopNumber from '@/components/shared/PopNumber'

interface Props {
  total: number
  debtors: number
}

/**
 * Tarjeta compacta "Por cobrar" — total adeudado por clientes (Σ saldos > 0) y
 * nº de deudores, info operativa de caja "de un vistazo". El dato lo agrega
 * server-side la RPC get_accounts_receivable_summary (no afectado por el filtro
 * de período: la deuda es un saldo, no un flujo del rango).
 */
export default function ReceivableWidget({ total, debtors }: Props) {
  const fmt = useFormatMoney()
  const hasDebt = total > 0

  return (
    <div className="surface-card p-5 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-heading font-display">Por cobrar</p>
          <p className="text-xs text-hint mt-0.5">Cuentas corrientes · saldo actual</p>
        </div>
        <Link href="/customers" className="text-xs text-primary font-medium hover:underline shrink-0">
          Ver clientes →
        </Link>
      </div>

      <div className="flex items-end justify-between gap-4">
        <PopNumber
          value={fmt(total)}
          className={`text-2xl font-semibold tabular-nums ${hasDebt ? 'text-destructive' : 'text-heading'}`}
        />
        <p className="text-xs text-hint tabular-nums shrink-0">
          {debtors === 0
            ? 'Sin deudores'
            : `${debtors} deudor${debtors > 1 ? 'es' : ''}`}
        </p>
      </div>
    </div>
  )
}
