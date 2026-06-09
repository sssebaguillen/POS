'use client'

import { useState, useMemo, useEffect, memo, useRef } from 'react'
import { useMutation, useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Printer, Trash2, X } from 'lucide-react'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildReceiptData } from '@/lib/printer/receipt'
import { useCurrency, useFormatMoney } from '@/lib/context/CurrencyContext'
import type { ReceiptData } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import { getSaleDetail, updateSale, deleteSale } from '@/lib/api/sales'
import type { PaymentMethod } from '@/lib/constants/domain'
import { isPaymentMethod, normalizePayment, PAYMENT_OPTIONS, PAYMENT_TONE } from '@/lib/payments'
import { ACCENT_CHIP } from '@/lib/accent-colors'
import { useToast } from '@/hooks/useToast'
import SelectDropdown from '@/components/ui/SelectDropdown'
import PopNumber from '@/components/shared/PopNumber'
import { DynamicIcon } from '@/components/inventory/CategoryIconPreview'
import type { SalesHistoryRow, SalesHistoryPage, SalesHistoryOperator } from '@/lib/types'

const PAGE_SIZE = 50
const OWNER_SENTINEL = '00000000-0000-0000-0000-000000000000'

interface SaleItem {
  id: string
  product_id: string
  variant_label: string | null
  product_name: string
  product_icon: string | null
  product_icon_color: string | null
  quantity: number
  unit_price: number
}

interface SaleDetail extends SalesHistoryRow {
  items: SaleItem[]
}

interface Cursor {
  created_at: string
  id: string
}

interface Props {
  businessId: string | null
  businessName: string
  operatorId: string | null
  from: string                       // ISO — inicio del período seleccionado
  to: string                         // ISO — fin del período seleccionado
  operators: SalesHistoryOperator[]  // para el dropdown de filtro
}

function SalesHistoryTable({ businessId, businessName, operatorId, from, to, operators }: Props) {
  const currency = useCurrency()
  const fmt = useFormatMoney()
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const { showToast } = useToast()

  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [saleDetails, setSaleDetails] = useState<Record<string, SaleDetail>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [editingSale, setEditingSale] = useState<SaleDetail | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterMethod, setFilterMethod] = useState<PaymentMethod | null>(null)
  const [filterOperatorId, setFilterOperatorId] = useState('')
  const [receiptPreview, setReceiptPreview] = useState<ReceiptData | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const deleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Debounce de la búsqueda para no disparar el query en cada tecla
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 350)
    return () => clearTimeout(t)
  }, [searchQuery])

  const { data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['sales-history', businessId, from, to, filterMethod, filterOperatorId, debouncedSearch],
    enabled: !!businessId,
    initialPageParam: null as Cursor | null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async ({ pageParam }) => {
      const { data: rpcResult, error } = await supabase.rpc('get_sales_history', {
        p_business_id: businessId,
        p_from: from,
        p_to: to,
        p_method: filterMethod,
        p_operator_id: filterOperatorId === '' ? null : filterOperatorId,
        p_search: debouncedSearch || null,
        p_before_created_at: pageParam?.created_at ?? null,
        p_before_id: pageParam?.id ?? null,
        p_limit: PAGE_SIZE,
      })
      if (error) throw new Error(error.message)
      return (rpcResult as unknown as SalesHistoryPage) ?? { data: [], total: 0, summary: null }
    },
    getNextPageParam: (lastPage): Cursor | undefined => {
      if (lastPage.data.length < PAGE_SIZE) return undefined
      const last = lastPage.data[lastPage.data.length - 1]
      return { created_at: last.created_at, id: last.id }
    },
  })

  const allRows = useMemo<SalesHistoryRow[]>(
    () => (data?.pages ?? []).flatMap(p => p.data),
    [data]
  )
  const visibleRows = useMemo(() => allRows.filter(r => !deletedIds.has(r.id)), [allRows, deletedIds])

  const firstPage = data?.pages[0]
  const total = firstPage?.total ?? visibleRows.length
  const summary = firstPage?.summary ?? null
  const summaryLoaded = summary !== null  // false solo en la carga inicial (evita el flash 0→real de PopNumber)
  const deletedVisibleCount = allRows.length - visibleRows.length
  const summaryCount = Math.max((summary?.count ?? total) - deletedVisibleCount, 0)

  const operatorOptions = useMemo(() => [
    { value: '', label: 'Todos' },
    { value: OWNER_SENTINEL, label: 'Dueño' },
    ...operators.map(o => ({ value: o.id, label: o.name })),
  ], [operators])

  const hasActiveFilters = !!debouncedSearch || filterMethod !== null || filterOperatorId !== ''

  function clearAllFilters() {
    setSearchQuery('')
    setFilterMethod(null)
    setFilterOperatorId('')
  }

  function invalidateHistory() {
    queryClient.invalidateQueries({ queryKey: ['sales-history', businessId] })
  }

  async function loadSaleDetail(saleId: string): Promise<SaleDetail | null> {
    if (saleDetails[saleId]) return saleDetails[saleId]
    if (!businessId) return null
    setLoadingDetailId(saleId)
    const result = await getSaleDetail(supabase, { saleId, businessId })
    if (!result.ok) {
      setLoadingDetailId(null)
      setLocalError(result.error)
      return null
    }
    const row = allRows.find(s => s.id === saleId)
    if (!row) {
      setLoadingDetailId(null)
      return null
    }
    const detail: SaleDetail = {
      ...row,
      status: result.data.status ?? row.status,
      method: isPaymentMethod(result.data.payment_method) ? result.data.payment_method : row.method,
      operator_name: result.data.operator_name ?? null,
      items: (result.data.items ?? []).map((item) => ({
        id: item.id,
        product_id: item.product_id ?? '',
        variant_label: item.variant_label ?? null,
        product_name: item.product_name,
        product_icon: item.product_icon ?? null,
        product_icon_color: item.product_icon_color ?? null,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
      })),
    }
    setSaleDetails(prev => ({ ...prev, [saleId]: detail }))
    setLoadingDetailId(null)
    return detail
  }

  async function fetchSaleDetail(saleId: string) {
    if (saleDetails[saleId]) {
      setExpandedSaleId(prev => (prev === saleId ? null : saleId))
      return
    }
    const detail = await loadSaleDetail(saleId)
    if (!detail) return
    setExpandedSaleId(saleId)
  }

  async function handleOpenReceiptPreview(saleId: string) {
    setLocalError(null)
    const detail = await loadSaleDetail(saleId)
    if (!detail) return
    try {
      setReceiptPreview(buildReceiptData({
        businessName,
        sale: {
          id: detail.id,
          created_at: detail.created_at,
          subtotal: detail.subtotal,
          discount: detail.discount,
          total: detail.total,
          paymentMethod: detail.method ?? 'cash',
        },
        items: detail.items,
        currency,
      }))
    } catch (receiptBuildError) {
      console.error(receiptBuildError)
      setLocalError(
        receiptBuildError instanceof Error
          ? receiptBuildError.message
          : 'No se pudo preparar el ticket de la venta.'
      )
    }
  }

  const updateMutation = useMutation({
    mutationFn: async (vars: {
      saleId: string
      items: { product_id: string; quantity: number; unit_price: number }[]
      paymentMethod: PaymentMethod
      status: string
    }) => {
      if (!businessId) throw new Error('businessId requerido')
      const result = await updateSale(supabase, {
        saleId: vars.saleId,
        businessId,
        items: vars.items.map(i => ({
          product_id: i.product_id,
          variant_id: null,
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
        paymentMethod: vars.paymentMethod,
        operatorId,
        status: vars.status,
      })
      if (!result.ok) throw new Error(result.error)
      return { ...vars, total: Number(result.data.total) }
    },
    onSuccess: (result) => {
      setSaleDetails(prev => {
        const existing = prev[result.saleId]
        if (!existing) return prev
        return {
          ...prev,
          [result.saleId]: {
            ...existing,
            subtotal: result.total,
            total: result.total,
            method: result.paymentMethod,
            status: result.status,
            items: result.items.map(i => {
              const found = existing.items.find(ei => ei.product_id === i.product_id)
              return {
                id: found?.id ?? '',
                product_id: i.product_id,
                variant_label: found?.variant_label ?? null,
                product_name: found?.product_name ?? '',
                product_icon: found?.product_icon ?? null,
                product_icon_color: found?.product_icon_color ?? null,
                quantity: i.quantity,
                unit_price: i.unit_price,
              }
            }),
          },
        }
      })
      setEditingSale(null)
      showToast({ message: 'Venta actualizada' })
      invalidateHistory()
    },
  })

  const mutationError = updateMutation.error?.message ?? null
  const displayError = localError ?? mutationError

  function dismissError() {
    setLocalError(null)
    updateMutation.reset()
  }

  function handleDeleteSale(saleId: string) {
    if (!businessId) return
    const TOAST_DURATION = 6000
    setLocalError(null)
    setDeletedIds(prev => new Set([...prev, saleId]))
    if (expandedSaleId === saleId) setExpandedSaleId(null)

    showToast({
      message: 'Venta eliminada',
      duration: TOAST_DURATION,
      onUndo: () => {
        const timer = deleteTimersRef.current.get(saleId)
        if (timer !== undefined) {
          clearTimeout(timer)
          deleteTimersRef.current.delete(saleId)
        }
        setDeletedIds(prev => {
          const next = new Set(prev)
          next.delete(saleId)
          return next
        })
      },
    })

    const timer = setTimeout(async () => {
      deleteTimersRef.current.delete(saleId)
      const result = await deleteSale(supabase, { saleId, businessId, operatorId })
      if (!result.ok) {
        setDeletedIds(prev => {
          const next = new Set(prev)
          next.delete(saleId)
          return next
        })
        setLocalError(result.error)
        return
      }
      setSaleDetails(prev => { const next = { ...prev }; delete next[saleId]; return next })
      invalidateHistory()
    }, TOAST_DURATION + 500)

    deleteTimersRef.current.set(saleId, timer)
  }

  function handleUpdateSale(
    saleId: string,
    updatedItems: { product_id: string; quantity: number; unit_price: number }[],
    paymentMethod: PaymentMethod,
    status: string
  ) {
    if (!businessId) return
    updateMutation.mutate({ saleId, items: updatedItems, paymentMethod, status })
  }

  function formatTime(dateString: string) {
    return new Date(dateString).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="relative surface-card overflow-hidden">
      {/* Filters + summary */}
      <div className="p-4 border-b border-edge-soft space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-heading font-display">Historial detallado</p>
          {isFetching && !isFetchingNextPage && (
            <span className="text-xs text-primary animate-pulse">actualizando…</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar por producto, operador..."
            className="h-9 w-[260px] shrink-0 rounded-lg text-sm"
          />
          <div className="flex flex-wrap gap-1.5 flex-1">
            {PAYMENT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilterMethod(prev => prev === opt.value ? null : opt.value)}
                className={`pill-tab ${filterMethod === opt.value ? `${ACCENT_CHIP[PAYMENT_TONE[opt.value]]} border` : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {operators.length >= 1 && (
            <SelectDropdown
              value={filterOperatorId}
              onChange={setFilterOperatorId}
              options={operatorOptions}
              className="w-[160px] shrink-0"
              usePortal
            />
          )}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="pill-tab text-hint hover:text-body shrink-0"
            >
              Limpiar todo
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-stretch gap-x-5 gap-y-2 px-4 py-2.5 bg-muted/50 rounded-xl">
          <div className="flex flex-col gap-0.5">
            <span className="text-label text-hint">Ventas</span>
            {summaryLoaded ? (
              <PopNumber value={String(summaryCount)} className="text-base font-semibold text-heading tabular-nums leading-tight" />
            ) : (
              <span className="block h-5 w-10 rounded bg-faint/50 animate-pulse" aria-hidden />
            )}
          </div>
          <div className="w-px bg-border self-stretch hidden sm:block" />
          <div className="flex flex-col gap-0.5">
            <span className="text-label text-hint">Recaudado</span>
            {summaryLoaded ? (
              <PopNumber value={fmt(summary?.total_revenue ?? 0)} className="text-base font-semibold text-heading tabular-nums leading-tight" />
            ) : (
              <span className="block h-5 w-20 rounded bg-faint/50 animate-pulse" aria-hidden />
            )}
          </div>
          {summary?.top_method && (
            <>
              <div className="w-px bg-border self-stretch hidden sm:block" />
              <div className="flex flex-col gap-0.5">
                <span className="text-label text-hint">Método</span>
                <span className="text-base font-semibold text-heading leading-tight">{normalizePayment(summary.top_method)}</span>
              </div>
            </>
          )}
        </div>
        {displayError && (
          <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            <p className="text-xs text-red-600 dark:text-red-400">{displayError}</p>
            <button
              className="p-0.5 rounded text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300 transition-colors ml-2 shrink-0"
              onClick={dismissError}
              aria-label="Cerrar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Sale list */}
      {visibleRows.length === 0 ? (
        <div className="p-8 text-center text-sm text-hint">
          {hasActiveFilters ? (
            <>
              No hay ventas con los filtros activos.{' '}
              <button className="underline hover:text-body transition-colors" onClick={clearAllFilters}>
                Limpiar filtros
              </button>
            </>
          ) : 'No hay ventas para mostrar'}
        </div>
      ) : (
        <>
          <ul className="p-3 space-y-1.5">
            {visibleRows.map((sale) => {
              const isExpanded = expandedSaleId === sale.id
              const detail = saleDetails[sale.id]
              const isLoadingDetail = loadingDetailId === sale.id
              const itemCount = sale.item_count ?? 0
              const methodLabel = sale.method ? normalizePayment(sale.method) : 'sin dato'

              return (
                <li
                  key={sale.id}
                  className={`rounded-xl border transition-all overflow-hidden ${
                    isExpanded
                      ? 'bg-primary/5 border-primary/30 dark:bg-primary/10 dark:border-primary/20'
                      : 'bg-surface border-edge hover:border-primary/30 hover:bg-surface-alt/40'
                  }`}
                >
                  <button
                    className="w-full px-4 py-3 text-left"
                    onClick={() => fetchSaleDetail(sale.id)}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Contraer' : 'Ver'} detalle, Venta #${sale.id.slice(0, 6)}, ${fmt(sale.total)}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-semibold text-heading tabular-nums shrink-0">
                          {formatTime(sale.created_at)}
                        </span>
                        <span className="text-xs text-hint shrink-0">· #{sale.id.slice(0, 6)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-sm font-bold tabular-nums ${isExpanded ? 'text-primary' : 'text-heading'}`}>
                          {fmt(sale.total)}
                        </span>
                        {isLoadingDetail ? (
                          <span className="w-3 h-3 border-2 border-hint border-t-transparent rounded-full animate-spin" role="status" aria-label="Cargando" />
                        ) : (
                          <span className={`text-[10px] text-hint transition-transform duration-150 inline-block ${isExpanded ? '-rotate-180' : ''}`} aria-hidden="true">
                            ▾
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                        isPaymentMethod(sale.method)
                          ? ACCENT_CHIP[PAYMENT_TONE[sale.method]]
                          : 'bg-surface-alt border-edge text-body'
                      }`}>
                        {methodLabel}
                      </span>
                      {sale.status === 'cancelled' && (
                        <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-medium bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400">
                          Cancelada
                        </span>
                      )}
                      {sale.status === 'refunded' && (
                        <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-medium bg-red-50 border-red-200 text-red-600 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
                          Reembolsada
                        </span>
                      )}
                      {itemCount > 0 && (
                        <>
                          <span className="text-[11px] text-hint">
                            {itemCount} item{itemCount !== 1 ? 's' : ''}
                          </span>
                          {(sale.item_icons ?? []).map((ic, i) =>
                            ic.icon ? (
                              <DynamicIcon key={i} name={ic.icon} size={13} color={ic.color ?? undefined} />
                            ) : null
                          )}
                        </>
                      )}
                    </div>
                  </button>

                  {isExpanded && detail && (
                    <div className="px-4 pb-3 border-t border-dashed border-primary/20 dark:border-primary/15">
                      <ul className="space-y-1 pt-2.5 mb-2.5">
                        {detail.items.map(item => (
                          <li key={item.id} className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-1.5 text-body min-w-0">
                              {item.product_icon && (
                                <DynamicIcon name={item.product_icon} size={14} color={item.product_icon_color ?? undefined} className="shrink-0" />
                              )}
                              <span className="truncate text-xs">
                                {item.product_name}
                                {item.variant_label && (
                                  <span className="text-hint"> · {item.variant_label}</span>
                                )}
                              </span>
                              <span className="text-hint shrink-0 text-xs">×{item.quantity}</span>
                            </span>
                            <span className="text-xs font-semibold text-heading tabular-nums shrink-0 ml-3">
                              {fmt(item.quantity * item.unit_price)}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <div className="flex justify-between items-center border-t border-dashed border-primary/20 dark:border-primary/15 pt-2 mb-1">
                        <span className="text-xs font-semibold text-heading">Total cobrado</span>
                        <span className="text-xs font-bold text-primary tabular-nums">
                          {fmt(detail.total)}
                        </span>
                      </div>

                      {detail.operator_name && (
                        <p className="text-[11px] text-hint mb-2.5">Por: {detail.operator_name}</p>
                      )}

                      <div className="flex items-center justify-between gap-2 mt-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setEditingSale(detail)}
                            className="h-8 px-3 text-xs rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors"
                          >
                            Editar
                          </button>
                          {confirmingDeleteId === sale.id ? (
                            <>
                              <span className="text-xs text-red-500 dark:text-red-400 font-medium">¿Eliminar?</span>
                              <button
                                onClick={() => { setConfirmingDeleteId(null); handleDeleteSale(sale.id) }}
                                className="h-9 px-3 text-xs rounded-lg border border-red-300 text-red-600 bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                              >
                                Sí
                              </button>
                              <button
                                onClick={() => setConfirmingDeleteId(null)}
                                className="h-8 px-3 text-xs rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors"
                              >
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setConfirmingDeleteId(sale.id)}
                              className="h-8 px-3 text-xs rounded-lg border border-red-200 text-red-500 bg-surface hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:bg-transparent dark:hover:bg-red-500/10 transition-colors"
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => handleOpenReceiptPreview(sale.id)}
                          className="h-8 px-3 text-xs rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors inline-flex items-center gap-1.5"
                        >
                          <Printer size={11} />
                          Imprimir
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {hasNextPage && (
            <div className="px-3 pb-3 pt-1">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full h-9 rounded-lg border border-edge text-sm text-body hover:bg-hover-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
              </button>
            </div>
          )}
        </>
      )}

      <Dialog open={!!editingSale} onOpenChange={nextOpen => !nextOpen && setEditingSale(null)}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden bg-card max-h-[90vh] flex flex-col" showCloseButton={false}>
          <DialogTitle className="sr-only">Editar venta</DialogTitle>
          <DialogDescription className="sr-only">Editar los detalles de la venta</DialogDescription>
          {editingSale && (
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
                <span className="text-base font-semibold text-heading">
                  Editar venta · {formatTime(editingSale.created_at)}
                </span>
                <button
                  onClick={() => setEditingSale(null)}
                  className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
                  aria-label="Cerrar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <EditSalePanel
                sale={editingSale}
                onSave={(updatedItems, paymentMethod, status) =>
                  handleUpdateSale(editingSale.id, updatedItems, paymentMethod, status)
                }
                onCancel={() => setEditingSale(null)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      {receiptPreview && (
        <ReceiptPreviewModal
          receipt={receiptPreview}
          onClose={() => setReceiptPreview(null)}
        />
      )}

    </div>
  )
}

export default memo(SalesHistoryTable)

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'completed', label: 'Completada' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'refunded', label: 'Reembolsada' },
]

function EditSalePanel({
  sale,
  onSave,
  onCancel,
}: {
  sale: SaleDetail
  onSave: (items: { product_id: string; quantity: number; unit_price: number }[], paymentMethod: PaymentMethod, status: string) => void
  onCancel: () => void
}) {
  const fmt = useFormatMoney()
  const [items, setItems] = useState(sale.items.map(i => ({ ...i })))
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(isPaymentMethod(sale.method) ? sale.method : 'cash')
  const [saleStatus, setSaleStatus] = useState(sale.status ?? 'completed')

  function updateQty(productId: string, qty: number) {
    if (qty < 1) return
    setItems(prev => prev.map(i => i.product_id === productId ? { ...i, quantity: qty } : i))
  }

  function removeItem(productId: string) {
    setItems(prev => prev.filter(i => i.product_id !== productId))
  }

  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  return (
    <div className="flex flex-col h-full">
      <div className="overflow-y-auto px-5 py-3 space-y-1 flex-1 min-h-0">
        {items.map(item => (
          <div key={item.product_id} className="flex items-center gap-3 py-2 border-b border-edge-soft">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-heading truncate">{item.product_name}</p>
              <p className="text-xs text-hint">{fmt(item.unit_price)} c/u</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => updateQty(item.product_id, item.quantity - 1)}
                className="w-8 h-8 rounded-lg border border-edge hover:bg-hover-bg flex items-center justify-center transition-colors text-sm text-body"
              >
                −
              </button>
              <span className="text-sm font-semibold w-8 text-center tabular-nums">{item.quantity}</span>
              <button
                onClick={() => updateQty(item.product_id, item.quantity + 1)}
                className="w-8 h-8 rounded-lg border border-edge hover:bg-hover-bg flex items-center justify-center transition-colors text-sm text-body"
              >
                +
              </button>
            </div>
            <p className="text-sm font-semibold text-heading tabular-nums w-20 text-right shrink-0">
              {fmt(item.quantity * item.unit_price)}
            </p>
            <button
              onClick={() => removeItem(item.product_id)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-faint hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="px-5 py-4 border-t border-edge space-y-3 shrink-0">
        <div>
          <p className="text-xs text-hint mb-1.5">Método de pago</p>
          <div className="flex flex-wrap gap-1.5">
            {PAYMENT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPaymentMethod(opt.value)}
                className={`h-8 px-3 text-xs rounded-full border transition-colors ${
                  paymentMethod === opt.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-edge text-body hover:bg-hover-bg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-hint mb-1.5">Estado</p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSaleStatus(opt.value)}
                className={`h-8 px-3 text-xs rounded-full border transition-colors ${
                  saleStatus === opt.value
                    ? opt.value === 'completed'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : opt.value === 'cancelled'
                        ? 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-300'
                        : 'bg-red-100 border-red-300 text-red-700 dark:bg-red-500/20 dark:border-red-500/40 dark:text-red-400'
                    : 'border-edge text-body hover:bg-hover-bg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-baseline">
          <span className="text-sm text-subtle">Total</span>
          <span className="text-lg font-semibold text-heading tabular-nums">
            {fmt(total)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="cancel"
            className="h-9 rounded-lg text-sm"
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button
            className="h-9 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={items.length === 0}
            onClick={() =>
              onSave(
                items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
                paymentMethod,
                saleStatus
              )
            }
          >
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  )
}
