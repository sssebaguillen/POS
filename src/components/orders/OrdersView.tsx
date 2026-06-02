'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/format'
import StatusBadge from './StatusBadge'
import OrderDetailPanel from './OrderDetailPanel'
import { acknowledgeOrdersSeen } from './UnreadBadge'
import { type CatalogOrderRow, type CatalogOrderStatus } from './types'

type GroupFilter = 'pendientes' | 'en_curso' | 'cerrados'

const PENDIENTES_STATUSES: CatalogOrderStatus[] = ['recibido']
const EN_CURSO_STATUSES: CatalogOrderStatus[] = ['aceptado', 'en_camino', 'listo_retiro']
const CERRADOS_STATUSES: CatalogOrderStatus[] = ['completado', 'rechazado', 'cancelado']

const CERRADOS_SUB: { status: CatalogOrderStatus; label: string }[] = [
  { status: 'completado', label: 'Completados' },
  { status: 'rechazado',  label: 'Rechazados'  },
  { status: 'cancelado',  label: 'Cancelados'  },
]

const VIEWED_IDS_KEY = 'orders-viewed-ids'

function readViewedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(VIEWED_IDS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === 'string'))
      : new Set()
  } catch {
    return new Set()
  }
}

function writeViewedIds(ids: Set<string>) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(VIEWED_IDS_KEY, JSON.stringify([...ids]))
}

function elapsedLabel(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
  if (mins < 1)   return 'Ahora mismo'
  if (mins < 60)  return `Hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Hace ${hours} h`
  return `Hace ${Math.floor(hours / 24)} d`
}

function cardClass(
  order: CatalogOrderRow,
  group: GroupFilter,
  viewedIds: Set<string>,
  viewedMounted: boolean,
): string {
  if (viewedMounted && group === 'pendientes' && !viewedIds.has(order.id)) {
    return 'border-amber-300 bg-amber-50/40 dark:border-amber-500/50 dark:bg-amber-500/[0.06]'
  }
  if (group === 'en_curso' && order.status === 'listo_retiro') {
    return 'border-edge bg-surface ring-1 ring-primary/20'
  }
  return 'border-edge bg-surface hover:border-primary/30 hover:bg-surface-alt/40'
}

interface Props {
  initialOrders: CatalogOrderRow[]
  businessId: string
  operatorId: string | null
}

export default function OrdersView({ initialOrders, operatorId }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('pendientes')
  const [subFilter, setSubFilter] = useState<CatalogOrderStatus | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set())
  const [viewedMounted, setViewedMounted] = useState(false)
  const [pendientesHighlight, setPendientesHighlight] = useState(false)

  // Hydrate viewedIds from localStorage after mount (SSR-safe).
  useEffect(() => {
    setViewedIds(readViewedIds())
    setViewedMounted(true)
  }, [])
  const prevPendientesRef = useRef(initialOrders.filter(o => PENDIENTES_STATUSES.includes(o.status)).length)

  const { data: orders = initialOrders, isFetching, refetch } = useQuery<CatalogOrderRow[]>({
    queryKey: ['catalog_orders'],
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - 30)
      const { data, error } = await supabase.rpc('get_catalog_orders', {
        p_status: null,
        p_from: since.toISOString(),
        p_to: null,
      })
      if (error) throw error
      return ((data ?? []) as CatalogOrderRow[]).map(row => ({
        ...row,
        subtotal: Number(row.subtotal),
        total: Number(row.total),
        item_count: Number(row.item_count),
      }))
    },
    initialData: initialOrders,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    staleTime: 0,
  })

  // Mark orders read for the whole business whenever this list refreshes —
  // being on /orders means everything visible is "seen", including new orders
  // that arrive while we're here. Persists in businesses.catalog_orders_read_at.
  useEffect(() => {
    acknowledgeOrdersSeen().then(() => {
      queryClient.invalidateQueries({ queryKey: ['catalog_orders_unread'] })
    })
  }, [orders, queryClient])

  const pendientesCount = useMemo(
    () => orders.filter(o => PENDIENTES_STATUSES.includes(o.status)).length,
    [orders],
  )
  const enCursoCount = useMemo(
    () => orders.filter(o => EN_CURSO_STATUSES.includes(o.status)).length,
    [orders],
  )

  // Pulse the Pendientes chip when new orders arrive (including on mount if count > 0)
  useEffect(() => {
    if (pendientesCount > prevPendientesRef.current) {
      setPendientesHighlight(true)
    }
    prevPendientesRef.current = pendientesCount
  }, [pendientesCount])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const groupStatuses =
      groupFilter === 'pendientes' ? PENDIENTES_STATUSES :
      groupFilter === 'en_curso'   ? EN_CURSO_STATUSES   :
      CERRADOS_STATUSES
    return orders.filter(o => {
      if (!groupStatuses.includes(o.status)) return false
      if (groupFilter === 'cerrados' && subFilter && o.status !== subFilter) return false
      if (term) {
        const haystack = `${o.order_number} ${o.customer_name} ${o.customer_phone}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [orders, groupFilter, subFilter, search])

  const handleStatusChanged = () => {
    refetch()
    queryClient.invalidateQueries({ queryKey: ['catalog_orders_unread'] })
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Pedidos online">
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-3 gap-2"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Actualizar
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6">
          <div className="surface-card overflow-hidden">
            <div className="p-4 border-b border-edge-soft space-y-3">
              <p className="font-semibold text-heading font-display">Pedidos</p>
              {/* Primary group filter + search */}
              <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={groupFilter === 'pendientes'}
              onClick={() => { setGroupFilter('pendientes'); setSubFilter(null); setPendientesHighlight(false) }}
              className={cn(
                'pill-tab transition-[transform,color,background-color,border-color] duration-150 ease-[var(--ease-out)]',
                groupFilter === 'pendientes'
                  ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'
                  : pendientesHighlight && pendientesCount > 0
                    ? 'ring-2 ring-primary/60 animate-pulse'
                    : '',
              )}
            >
              Pendientes{pendientesCount > 0 ? ` · ${pendientesCount}` : ''}
            </button>
            <button
              type="button"
              aria-pressed={groupFilter === 'en_curso'}
              onClick={() => { setGroupFilter('en_curso'); setSubFilter(null) }}
              className={cn(
                'pill-tab',
                groupFilter === 'en_curso'
                  ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'
                  : '',
              )}
            >
              En curso{enCursoCount > 0 ? ` · ${enCursoCount}` : ''}
            </button>
            <button
              type="button"
              aria-pressed={groupFilter === 'cerrados'}
              onClick={() => { setGroupFilter('cerrados'); setSubFilter(null) }}
              className={cn(
                'pill-tab',
                groupFilter === 'cerrados'
                  ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'
                  : '',
              )}
            >
              Cerrados
            </button>
                <Input
                  type="search"
                  aria-label="Buscar pedidos"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por número, nombre o teléfono..."
                  className="flex-1 min-w-[180px] h-9 rounded-lg text-sm"
                />
              </div>

              {/* Secondary sub-filter — only when Cerrados is active */}
              {groupFilter === 'cerrados' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {CERRADOS_SUB.map(({ status, label }) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={subFilter === status}
                      onClick={() => setSubFilter(subFilter === status ? null : status)}
                      className={cn(
                        'pill-tab py-1 px-3 text-xs',
                        subFilter === status
                          ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'
                          : 'text-muted-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-hint">
                {orders.length === 0
                  ? 'Cuando un cliente envíe un pedido desde tu catálogo online, aparecerá acá.'
                  : groupFilter === 'pendientes'
                    ? 'Sin pedidos pendientes. Todo al día.'
                    : groupFilter === 'en_curso'
                      ? 'No hay pedidos en curso en este momento.'
                      : search
                        ? 'No hay pedidos que coincidan con la búsqueda.'
                        : 'No hay pedidos cerrados en los últimos 30 días.'}
              </div>
            ) : (
              <ul className="p-3 space-y-1.5">
                {filtered.map(order => (
                  <li key={order.id}>
                    <button
                      type="button"
                      className={cn(
                        'w-full text-left rounded-xl border px-4 py-3 transition-[transform,background-color,border-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]',
                        cardClass(order, groupFilter, viewedIds, viewedMounted),
                      )}
                      onClick={() => {
                        setSelectedId(order.id)
                        setViewedIds(prev => {
                          if (prev.has(order.id)) return prev
                          const next = new Set(prev).add(order.id)
                          writeViewedIds(next)
                          return next
                        })
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          {/* Primary: number + status + delivery type */}
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-heading">Pedido #{order.order_number}</span>
                            <StatusBadge status={order.status} />
                            {order.delivery_type === 'delivery' && (
                              <span className="text-xs text-hint">Delivery</span>
                            )}
                          </div>
                          {/* Secondary: customer name */}
                          <p className="text-sm text-body truncate">{order.customer_name}</p>
                          {/* Tertiary: item count */}
                          <p className="text-xs text-hint">
                            {order.item_count} {order.item_count === 1 ? 'producto' : 'productos'}
                          </p>
                        </div>
                        {/* Trailing: total + elapsed time */}
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-heading">{formatMoney(order.total)}</p>
                          <p className="mt-0.5 text-xs text-hint">{elapsedLabel(order.created_at)}</p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {selectedId && (
        <OrderDetailPanel
          orderId={selectedId}
          operatorId={operatorId}
          onClose={() => setSelectedId(null)}
          onStatusChanged={handleStatusChanged}
        />
      )}
    </div>
  )
}
