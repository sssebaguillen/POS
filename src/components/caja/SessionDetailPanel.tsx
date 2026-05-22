'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants/domain'
import type { PaymentMethod } from '@/lib/constants/domain'
import type { SessionRow } from '@/app/(app)/caja/page'

interface SessionDetail {
  id: string
  status: 'open' | 'closed'
  opening_amount: number
  closing_amount: number | null
  expected_amount: number | null
  difference: number | null
  opened_at: string
  closed_at: string | null
  notes: string | null
  opened_by_name: string
  closed_by_name: string | null
  sales_count: number
  sales_total: number
  payments_by_method: { method: string; total: number }[]
}

interface Props {
  session: SessionRow
  onClose: () => void
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function SessionDetailPanel({ session, onClose }: Props) {
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDetail() {
      const { data } = await supabase.rpc('get_session_summary', { p_session_id: session.id })
      setDetail(data as SessionDetail | null)
      setLoading(false)
    }
    void fetchDetail()
  }, [session.id, supabase])

  const difference = detail?.difference ?? null

  function diffDisplay(diff: number | null) {
    if (diff === null) return null
    if (diff === 0) return { label: 'Cuadra exacto', color: 'text-emerald-600 dark:text-emerald-400' }
    if (diff > 0) return { label: `+${formatMoney(diff)} sobrante`, color: 'text-emerald-600 dark:text-emerald-400' }
    return { label: `${formatMoney(diff)} faltante`, color: 'text-destructive' }
  }

  const diffInfo = diffDisplay(difference)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-background border-l border-border flex flex-col shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border sticky top-0 bg-background">
          <h2 className="text-base font-semibold">Detalle de sesión</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive">
            No se pudo cargar el detalle
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Status badge */}
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                detail.status === 'open'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {detail.status === 'open' ? 'Abierta' : 'Cerrada'}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDuration(session.duration_seconds)}
              </span>
            </div>

            {/* Opening / closing */}
            <div className="border border-border rounded-lg divide-y divide-border text-sm">
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Apertura</span>
                <span>{formatDateTime(detail.opened_at)} · {detail.opened_by_name}</span>
              </div>
              {detail.closed_at && (
                <div className="flex justify-between px-3 py-2.5">
                  <span className="text-muted-foreground">Cierre</span>
                  <span>{formatDateTime(detail.closed_at)} · {detail.closed_by_name ?? '—'}</span>
                </div>
              )}
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Fondo inicial</span>
                <span>{formatMoney(detail.opening_amount)}</span>
              </div>
            </div>

            {/* Sales summary */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ventas</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Cantidad</p>
                  <p className="text-lg font-semibold">{detail.sales_count}</p>
                </div>
                <div className="bg-muted/40 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Total</p>
                  <p className="text-lg font-semibold">{formatMoney(detail.sales_total)}</p>
                </div>
              </div>
            </div>

            {/* Payment breakdown */}
            {detail.payments_by_method.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Por método de pago</p>
                <div className="border border-border rounded-lg divide-y divide-border">
                  {detail.payments_by_method.map(p => (
                    <div key={p.method} className="flex items-center justify-between px-3 py-2.5 text-sm">
                      <span className="text-muted-foreground">
                        {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                      </span>
                      <span className="font-medium">{formatMoney(p.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Arqueología (closed sessions only) */}
            {detail.status === 'closed' && detail.expected_amount !== null && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Arqueo</p>
                <div className="border border-border rounded-lg divide-y divide-border text-sm">
                  <div className="flex justify-between px-3 py-2.5">
                    <span className="text-muted-foreground">Efectivo esperado</span>
                    <span>{formatMoney(detail.expected_amount)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2.5">
                    <span className="text-muted-foreground">Efectivo contado</span>
                    <span>{formatMoney(detail.closing_amount ?? 0)}</span>
                  </div>
                  {diffInfo && (
                    <div className={`flex justify-between px-3 py-2.5 font-semibold ${diffInfo.color}`}>
                      <span>Diferencia</span>
                      <span>{diffInfo.label}</span>
                    </div>
                  )}
                </div>
                {detail.notes && (
                  <p className="text-xs text-muted-foreground mt-2 px-1">{detail.notes}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
