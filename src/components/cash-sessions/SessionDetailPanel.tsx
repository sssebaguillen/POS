'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Printer, X } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import CashCloseDocument from '@/components/cash-sessions/CashCloseDocument'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants/domain'
import type { PaymentMethod } from '@/lib/constants/domain'
import type { SessionRow } from '@/app/(app)/cash-sessions/page'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSlidePanelAnimation } from '@/components/shared/useSlidePanelAnimation'

const DIGITAL_METHODS = ['mercadopago', 'transfer'] as const
type DigitalMethod = typeof DIGITAL_METHODS[number]

type DigitalEdits = Record<DigitalMethod, { opening: string; closing: string }>

const EMPTY_EDITS: DigitalEdits = {
  mercadopago: { opening: '', closing: '' },
  transfer: { opening: '', closing: '' },
}

interface DigitalBalance {
  method: string
  opening_balance: number | null
  closing_balance: number | null
  sales_total: number
  expected: number | null
  difference: number | null
}

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
  digital_balances: DigitalBalance[]
}

interface Props {
  session: SessionRow
  operatorId: string | null
  businessName: string
  onClose: () => void
  onCloseSession?: () => void
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

function DiffLabel({ diff }: { diff: number | null }) {
  if (diff === null) return null
  if (diff === 0) return <span className="text-xs font-medium text-success">Cuadra exacto</span>
  if (diff > 0) return <span className="text-xs font-medium text-success">+sobrante</span>
  return <span className="text-xs font-medium text-destructive">faltante</span>
}

export default function SessionDetailPanel({ session, operatorId, businessName, onClose, onCloseSession }: Props) {
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])
  const { visible, closePanel } = useSlidePanelAnimation({ onClose })
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [showDigital, setShowDigital] = useState(false)
  const [edits, setEdits] = useState<DigitalEdits>(EMPTY_EDITS)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(false)
    const { data } = await supabase.rpc('get_session_summary', { p_session_id: session.id })
    if (data) {
      setDetail(data as SessionDetail)
    } else {
      setError(true)
    }
    setLoading(false)
  }, [session.id, supabase])

  useEffect(() => {
    void fetchDetail()
  }, [fetchDetail])

  useEffect(() => {
    if (!detail) return
    const next: DigitalEdits = { ...EMPTY_EDITS }
    for (const b of detail.digital_balances) {
      if (b.method === 'mercadopago' || b.method === 'transfer') {
        next[b.method] = {
          opening: b.opening_balance !== null ? String(b.opening_balance) : '',
          closing: b.closing_balance !== null ? String(b.closing_balance) : '',
        }
      }
    }
    setEdits(next)
    const hasDigitalSales = detail.payments_by_method.some(p => DIGITAL_METHODS.includes(p.method as DigitalMethod))
    const hasBalances = detail.digital_balances.length > 0
    if (hasDigitalSales || hasBalances) setShowDigital(true)
  }, [detail])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closePanel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closePanel])

  const isDirty = useMemo(() => {
    if (!detail) return false
    return DIGITAL_METHODS.some(method => {
      const persisted = detail.digital_balances.find(b => b.method === method)
      const pOpening = persisted?.opening_balance != null ? String(persisted.opening_balance) : ''
      const pClosing = persisted?.closing_balance != null ? String(persisted.closing_balance) : ''
      return edits[method].opening !== pOpening || edits[method].closing !== pClosing
    })
  }, [edits, detail])

  function calcDigital(method: DigitalMethod) {
    if (!detail) return { salesTotal: 0, expected: null, diff: null }
    const salesTotal = detail.payments_by_method.find(p => p.method === method)?.total ?? 0
    const opening = parseFloat(edits[method].opening)
    const closing = parseFloat(edits[method].closing)
    const expected = !isNaN(opening) ? opening + salesTotal : null
    const diff = expected !== null && !isNaN(closing) ? closing - expected : null
    return { salesTotal, expected, diff }
  }

  async function handleSaveDigital() {
    if (!detail || !isDirty) return
    setSaving(true)
    setSaveError(null)
    try {
      for (const method of DIGITAL_METHODS) {
        const opening = edits[method].opening !== '' ? parseFloat(edits[method].opening) : null
        const closing = edits[method].closing !== '' ? parseFloat(edits[method].closing) : null
        if (opening === null && closing === null) continue
        const { data } = await supabase.rpc('upsert_session_digital_balance', {
          p_session_id: detail.id,
          p_method: method,
          p_opening_balance: opening,
          p_closing_balance: closing,
          p_operator_id: operatorId,
        })
        const result = data as { success: boolean; error?: string } | null
        if (!result?.success) {
          setSaveError(result?.error ?? 'Error al guardar')
          return
        }
      }
      await fetchDetail()
    } catch {
      setSaveError('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const hasPendingReconciliation = useMemo(() => {
    if (!detail || detail.status !== 'closed') return false
    return detail.payments_by_method.some(p => {
      if (!DIGITAL_METHODS.includes(p.method as DigitalMethod)) return false
      const balance = detail.digital_balances.find(b => b.method === p.method)
      return !balance?.closing_balance
    })
  }, [detail])

  const difference = detail?.difference ?? null

  function diffDisplay(diff: number | null) {
    if (diff === null) return null
    if (diff === 0) return { label: 'Cuadra exacto', color: 'text-success' }
    if (diff > 0) return { label: `+${formatMoney(diff)} sobrante`, color: 'text-success' }
    return { label: `${formatMoney(diff)} faltante`, color: 'text-destructive' }
  }

  const diffInfo = diffDisplay(difference)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-foreground/40 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-in-out ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={closePanel}
      />
      <div
        className={`relative w-full max-w-md bg-background border-l border-border flex flex-col shadow-xl transition-transform duration-200 ease-in-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Detalle de sesión</h2>
          <button onClick={closePanel} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-destructive p-5">
              <span>No se pudo cargar el detalle</span>
              <Button variant="outline" size="sm" onClick={fetchDetail}>Reintentar</Button>
            </div>
          ) : loading ? (
            <Skeleton isLoading>
              <div className="p-5 space-y-5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">Abierta</span>
                  <span className="text-xs text-muted-foreground">0m</span>
                </div>
                <div className="border border-border rounded-lg divide-y divide-border text-sm">
                  {[['Apertura', '00/00/0000 00:00 · —'], ['Fondo inicial', '$0,00']].map(([label, val]) => (
                    <div key={label} className="flex justify-between px-3 py-2.5">
                      <span className="text-muted-foreground">{label}</span>
                      <span>{val}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ventas</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[['Cantidad', '0'], ['Total', '$0,00']].map(([label, val]) => (
                      <div key={label} className="bg-muted/40 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                        <p className="text-lg font-semibold">{val}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Por método de pago</p>
                  <div className="border border-border rounded-lg divide-y divide-border">
                    {['Efectivo', 'Tarjeta'].map(label => (
                      <div key={label} className="flex items-center justify-between px-3 py-2.5 text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">$0,00</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Skeleton>
          ) : detail ? (
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

              {/* Arqueo (closed sessions only) */}
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

              {/* Digital balances */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Cuentas digitales</p>

                {!showDigital ? (
                  <button
                    onClick={() => setShowDigital(true)}
                    className="w-full text-sm text-primary border border-dashed border-primary/30 rounded-lg py-2.5 hover:bg-primary/5 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
                  >
                    Registrar saldo de cuentas
                  </button>
                ) : (
                  <div className="space-y-3">
                    {hasPendingReconciliation && (
                      <p className="text-xs text-warning bg-warning/10 rounded-lg px-3 py-2">
                        Esta sesión tiene ventas digitales sin reconciliar
                      </p>
                    )}

                    {DIGITAL_METHODS.map(method => {
                      const { salesTotal, expected, diff } = calcDigital(method)
                      return (
                        <div key={method} className="border border-border rounded-lg divide-y divide-border text-sm">
                          <div className="px-3 py-2 bg-muted/30">
                            <span className="text-xs font-medium">{PAYMENT_METHOD_LABELS[method]}</span>
                          </div>
                          <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                            <span className="text-muted-foreground shrink-0">Saldo inicial</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              value={edits[method].opening}
                              onChange={e => setEdits(prev => ({ ...prev, [method]: { ...prev[method], opening: e.target.value } }))}
                              className="h-7 w-32 text-right text-sm"
                            />
                          </div>
                          <div className="flex justify-between px-3 py-2.5">
                            <span className="text-muted-foreground">Ventas</span>
                            <span>{formatMoney(salesTotal)}</span>
                          </div>
                          {expected !== null && (
                            <div className="flex justify-between px-3 py-2.5">
                              <span className="text-muted-foreground">Esperado</span>
                              <span className="font-medium">{formatMoney(expected)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between px-3 py-2.5 gap-3">
                            <span className="text-muted-foreground shrink-0">Saldo final</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              value={edits[method].closing}
                              onChange={e => setEdits(prev => ({ ...prev, [method]: { ...prev[method], closing: e.target.value } }))}
                              className="h-7 w-32 text-right text-sm"
                            />
                          </div>
                          {diff !== null && (
                            <div className={`flex justify-between px-3 py-2.5 font-semibold ${diff === 0 ? 'text-success' : diff > 0 ? 'text-success' : 'text-destructive'}`}>
                              <span>Diferencia</span>
                              <span>
                                {diff === 0 ? 'Cuadra exacto' : diff > 0 ? `+${formatMoney(diff)} sobrante` : `${formatMoney(diff)} faltante`}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {saveError && <p className="text-xs text-destructive">{saveError}</p>}

                    <Button
                      size="sm"
                      className="w-full"
                      onClick={handleSaveDigital}
                      disabled={!isDirty || saving}
                    >
                      {saving ? 'Guardando…' : 'Guardar saldos'}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {detail?.status === 'open' && onCloseSession && (
          <div className="border-t border-border p-4 shrink-0">
            <Button variant="destructive" className="w-full" onClick={onCloseSession}>
              Cerrar caja
            </Button>
          </div>
        )}

        {detail?.status === 'closed' && (
          <div className="border-t border-border p-4 shrink-0">
            <Button variant="outline" className="w-full gap-2" onClick={() => window.print()}>
              <Printer size={16} />
              Imprimir cierre
            </Button>
          </div>
        )}
      </div>

      {/* Comprobante de cierre imprimible (oculto en pantalla; solo @media print). */}
      {detail?.status === 'closed' && (
        <CashCloseDocument businessName={businessName} detail={detail} />
      )}
    </div>
  )
}
