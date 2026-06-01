'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants/domain'
import type { PaymentMethod } from '@/lib/constants/domain'

interface SessionSummary {
  id: string
  opening_amount: number
  sales_count: number
  sales_total: number
  cash_settlements: number
  payments_by_method: { method: string; total: number }[]
}

interface Props {
  sessionId: string
  operatorId: string | null
  onClosed: () => void
  onClose: () => void
}

export default function CloseSessionModal({ sessionId, operatorId, onClosed, onClose }: Props) {
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])

  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [step, setStep] = useState<'summary' | 'confirm'>('summary')
  const [countedCash, setCountedCash] = useState('')
  const [notes, setNotes] = useState('')
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSummary() {
      const { data } = await supabase.rpc('get_session_summary', { p_session_id: sessionId })
      setSummary(data as SessionSummary | null)
      setLoadingSummary(false)
    }
    void fetchSummary()
  }, [sessionId, supabase])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const cashFromSales = useMemo(() => {
    if (!summary) return 0
    return summary.payments_by_method.find(p => p.method === 'cash')?.total ?? 0
  }, [summary])

  const cashFromSettlements = summary?.cash_settlements ?? 0

  const expectedInDrawer = useMemo(() => {
    if (!summary) return 0
    return (summary.opening_amount ?? 0) + cashFromSales + cashFromSettlements
  }, [summary, cashFromSales, cashFromSettlements])

  const counted = parseFloat(countedCash) || 0
  const difference = countedCash !== '' ? counted - expectedInDrawer : null

  async function handleClose() {
    setClosing(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('close_cash_session', {
      p_session_id: sessionId,
      p_closing_amount: counted,
      p_notes: notes || null,
      p_operator_id: operatorId,
    })
    const result = data as { success: boolean; error?: string } | null
    if (rpcError || !result?.success) {
      setError(result?.error ?? 'Error al cerrar la caja')
      setClosing(false)
      return
    }
    onClosed()
  }

  function formatDiff(diff: number | null) {
    if (diff === null) return null
    if (diff === 0) return { label: 'Cuadra exacto', color: 'text-emerald-600 dark:text-emerald-400' }
    if (diff > 0) return { label: `+${formatMoney(diff)} sobrante`, color: 'text-emerald-600 dark:text-emerald-400' }
    return { label: `${formatMoney(diff)} faltante`, color: 'text-destructive' }
  }

  const diffDisplay = formatDiff(difference)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 dark:bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-xl w-full max-w-md mx-4 shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-base font-semibold">Cerrar caja</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {loadingSummary ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando resumen…</div>
        ) : !summary ? (
          <div className="p-8 text-center text-sm text-destructive">No se pudo cargar el resumen</div>
        ) : step === 'summary' ? (
          <div className="p-5 space-y-4">
            {/* Totals */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-0.5">Ventas del turno</p>
                <p className="text-lg font-semibold">{summary.sales_count}</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-0.5">Total vendido</p>
                <p className="text-lg font-semibold">{formatMoney(summary.sales_total)}</p>
              </div>
            </div>

            {/* Payment breakdown */}
            {summary.payments_by_method.length > 0 && (
              <div className="border border-border rounded-lg divide-y divide-border">
                {summary.payments_by_method.map(p => (
                  <div key={p.method} className="flex items-center justify-between px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                    </span>
                    <span className="font-medium">{formatMoney(p.total)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Expected in drawer */}
            <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fondo inicial</span>
                <span>{formatMoney(summary.opening_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ventas en efectivo</span>
                <span>{formatMoney(cashFromSales)}</span>
              </div>
              {cashFromSettlements > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cobros en efectivo</span>
                  <span>{formatMoney(cashFromSettlements)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-border pt-1.5">
                <span>Efectivo esperado</span>
                <span>{formatMoney(expectedInDrawer)}</span>
              </div>
            </div>

            {/* Counted cash input */}
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Efectivo contado</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={countedCash}
                onChange={e => setCountedCash(e.target.value)}
                autoFocus
              />
            </div>

            {/* Real-time difference */}
            {diffDisplay && (
              <div className={`text-sm font-medium text-center ${diffDisplay.color}`}>
                {diffDisplay.label}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button
                onClick={() => setStep('confirm')}
                disabled={countedCash === ''}
                className="flex-1"
              >
                Continuar <ChevronRight size={15} className="ml-1" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Confirmation summary */}
            <div className="border border-border rounded-lg divide-y divide-border text-sm">
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Ventas</span>
                <span>{summary.sales_count} · {formatMoney(summary.sales_total)}</span>
              </div>
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Efectivo esperado</span>
                <span>{formatMoney(expectedInDrawer)}</span>
              </div>
              <div className="flex justify-between px-3 py-2.5">
                <span className="text-muted-foreground">Efectivo contado</span>
                <span>{formatMoney(counted)}</span>
              </div>
              {diffDisplay && (
                <div className={`flex justify-between px-3 py-2.5 font-semibold ${diffDisplay.color}`}>
                  <span>Diferencia</span>
                  <span>{diffDisplay.label}</span>
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm text-muted-foreground mb-1.5 block">Notas (opcional)</label>
              <Input
                placeholder="ej: faltaron $500, revisado con supervisor"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setStep('summary')} disabled={closing} className="flex-1">
                Volver
              </Button>
              <Button onClick={handleClose} disabled={closing} variant="destructive" className="flex-1">
                {closing ? 'Cerrando…' : 'Cerrar caja'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
