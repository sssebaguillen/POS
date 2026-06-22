'use client'

import { useState, useMemo, useCallback } from 'react'
import { Vault } from '@phosphor-icons/react/dist/ssr'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/shared/PageHeader'
import OpenSessionModal from '@/components/pos/OpenSessionModal'
import CloseSessionModal from '@/components/pos/CloseSessionModal'
import SessionDetailPanel from '@/components/cash-sessions/SessionDetailPanel'
import type { ActiveSessionRow, SessionRow } from '@/app/(app)/cash-sessions/page'

interface Props {
  businessId: string
  businessName: string
  activeSession: ActiveSessionRow | null
  initialSessions: SessionRow[]
  initialTotal: number
  operatorId: string | null
}

const PAGE_SIZE = 20

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

function DiffBadge({ diff, formatMoney }: { diff: number | null; formatMoney: (n: number) => string }) {
  if (diff === null) return <span className="text-muted-foreground text-xs">—</span>
  if (diff === 0) return <span className="text-xs font-medium text-success">Cuadra</span>
  if (diff > 0) return <span className="text-xs font-medium text-success">+{formatMoney(diff)}</span>
  return <span className="text-xs font-medium text-destructive">{formatMoney(diff)}</span>
}

export default function CashSessionsView({ businessId, businessName, activeSession: initialActiveSession, initialSessions, initialTotal, operatorId }: Props) {
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])

  const [activeSession, setActiveSession] = useState<ActiveSessionRow | null>(initialActiveSession)
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions)
  const [total, setTotal] = useState(initialTotal)
  const [offset, setOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)

  const [showOpenModal, setShowOpenModal] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null)

  const refetchSessions = useCallback(async (): Promise<SessionRow[]> => {
    const [activeResult, listResult] = await Promise.all([
      supabase.rpc('get_active_session'),
      supabase.rpc('get_sessions_list', { p_limit: PAGE_SIZE, p_offset: 0 }),
    ])
    if (activeResult.data !== undefined) setActiveSession(activeResult.data as ActiveSessionRow | null)
    const listData = listResult.data as { success: boolean; data: SessionRow[]; total: number } | null
    if (listData?.success) {
      const rows = listData.data ?? []
      setSessions(rows)
      setTotal(listData.total)
      setOffset(0)
      return rows
    }
    return []
  }, [supabase])

  async function loadMore() {
    const newOffset = offset + PAGE_SIZE
    setLoadingMore(true)
    setLoadMoreError(false)
    const { data, error } = await supabase.rpc('get_sessions_list', { p_limit: PAGE_SIZE, p_offset: newOffset })
    const result = data as { success: boolean; data: SessionRow[]; total: number } | null
    if (error || !result?.success) {
      // Sin esto, un fallo de transporte dejaba al usuario creyendo que llegó al
      // final del historial (perdiendo filas del trail de auditoría en silencio).
      console.error('get_sessions_list (loadMore) failed', error)
      setLoadMoreError(true)
      setLoadingMore(false)
      return
    }
    setSessions(prev => [...prev, ...(result.data ?? [])])
    setOffset(newOffset)
    setLoadingMore(false)
  }

  async function handleOpened(sessionId: string) {
    setShowOpenModal(false)
    await refetchSessions()
  }

  async function handleClosed() {
    // Capturamos el id de la sesión que se está cerrando ANTES de limpiar el estado,
    // para reabrir su detalle (con el botón "Imprimir cierre") apenas se cierra.
    // Esto vive SOLO acá (/cash-sessions); el cierre desde /pos no auto-abre nada.
    const closedId = activeSession?.id ?? null
    setShowCloseModal(false)
    setActiveSession(null)
    const rows = await refetchSessions()
    const closedRow = closedId ? rows.find(s => s.id === closedId) ?? null : null
    setSelectedSession(closedRow)
  }

  function openActiveSessionDetail() {
    if (!activeSession) return
    const match = sessions.find(s => s.id === activeSession.id)
    if (match) setSelectedSession(match)
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="Caja" />

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
          {/* Active session card */}
          {activeSession ? (
            <div
              className="border border-emerald-500/30 bg-emerald-500/5 rounded-xl p-4 cursor-pointer hover:bg-emerald-500/10 transition-colors"
              onClick={openActiveSessionDetail}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Vault size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Caja abierta</p>
                    <p className="text-xs text-muted-foreground">
                      Desde {formatDateTime(activeSession.opened_at)} · {activeSession.opened_by_name}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold">{formatMoney(activeSession.sales_total)}</p>
                  <p className="text-xs text-muted-foreground">
                    {activeSession.sales_count} {activeSession.sales_count === 1 ? 'venta' : 'ventas'}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 text-xs"
                    onClick={e => { e.stopPropagation(); setShowCloseModal(true) }}
                  >
                    Cerrar caja
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-border rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Vault size={16} className="shrink-0" />
                <span className="text-sm">La caja está cerrada</span>
              </div>
              <Button size="sm" onClick={() => setShowOpenModal(true)}>
                Abrir caja
              </Button>
            </div>
          )}

          {/* Sessions history table */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Historial{total > 0 ? ` (${total})` : ''}
            </p>

            {sessions.length === 0 ? (
              <div className="border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
                No hay sesiones registradas aún
              </div>
            ) : (
              <div className="surface-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="border-b border-edge/60 text-left text-hint">
                      <tr>
                        <th className="px-4 py-3">Apertura</th>
                        <th className="px-4 py-3">Abrió</th>
                        <th className="px-4 py-3 hidden md:table-cell">Cerró</th>
                        <th className="px-4 py-3 hidden md:table-cell">Duración</th>
                        <th className="px-4 py-3 text-right">Ventas</th>
                        <th className="px-4 py-3 text-right">Total</th>
                        <th className="px-4 py-3 text-right hidden lg:table-cell">Esperado</th>
                        <th className="px-4 py-3 text-right hidden lg:table-cell">Contado</th>
                        <th className="px-4 py-3 text-right" title="Diferencia">Dif.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map(s => (
                        <tr
                          key={s.id}
                          onClick={() => setSelectedSession(s)}
                          className="border-b border-edge/40 last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div>{formatDateTime(s.opened_at)}</div>
                            {s.status === 'open' && (
                              <span className="inline-block text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium mt-0.5">
                                Abierta
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{s.opened_by_name}</td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                            {s.closed_by_name ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                            {formatDuration(s.duration_seconds)}
                          </td>
                          <td className="px-4 py-3 text-right">{s.sales_count}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatMoney(s.sales_total)}</td>
                          <td className="px-4 py-3 text-right hidden lg:table-cell">
                            {s.expected_amount !== null ? formatMoney(s.expected_amount) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right hidden lg:table-cell">
                            {s.closing_amount !== null ? formatMoney(s.closing_amount) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {s.status === 'open'
                              ? <span className="text-xs text-muted-foreground">—</span>
                              : <DiffBadge diff={s.difference} formatMoney={formatMoney} />
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {sessions.length < total && (
                  <div className="border-t border-edge/60 px-4 py-3 text-center space-y-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? 'Cargando…' : `Ver más (${total - sessions.length} restantes)`}
                    </Button>
                    {loadMoreError && (
                      <p className="text-xs text-destructive">No pudimos cargar más sesiones. Intenta de nuevo.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <OpenSessionModal
        open={showOpenModal}
        operatorId={operatorId}
        onOpened={handleOpened}
        onClose={() => setShowOpenModal(false)}
      />

      {selectedSession && (
        <SessionDetailPanel
          session={selectedSession}
          operatorId={operatorId}
          businessName={businessName}
          onClose={() => setSelectedSession(null)}
          onCloseSession={selectedSession.status === 'open' ? () => {
            setSelectedSession(null)
            setShowCloseModal(true)
          } : undefined}
        />
      )}

      {activeSession && (
        <CloseSessionModal
          open={showCloseModal}
          sessionId={activeSession.id}
          operatorId={operatorId}
          onClosed={handleClosed}
          onClose={() => setShowCloseModal(false)}
        />
      )}
    </>
  )
}
