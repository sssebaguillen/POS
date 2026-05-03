'use client'

import { useState, useMemo, memo } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Printer, Trash2, X } from 'lucide-react'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildReceiptData } from '@/lib/printer/receipt'
import { useCurrency, useFormatMoney } from '@/lib/context/CurrencyContext'
import type { ReceiptData } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import type { PaymentMethod } from '@/lib/constants/domain'
import { isPaymentMethod, normalizePayment, PAYMENT_OPTIONS } from '@/lib/payments'
import { useToast } from '@/hooks/useToast'
import Toast from '@/components/shared/Toast'
import SelectDropdown from '@/components/ui/SelectDropdown'

interface SaleItem {
  id: string
  product_id: string
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
}

interface SaleRow {
  id: string
  subtotal: number
  discount: number
  created_at: string
  total: number
  status: string | null
  method: PaymentMethod | 'sin dato'
  product_names: string[]
  operator_name: string | null
}

interface SaleDetail extends SaleRow {
  items: SaleItem[]
}

interface SaleItemQueryRow {
  id: string
  product_id: string
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
}

interface SaleDetailRpcResult {
  success: boolean
  status: string | null
  payment_method: string | null
  operator_name: string | null
  items: SaleItemQueryRow[] | null
}

interface Props {
  rows: SaleRow[]
  businessId: string | null
  businessName: string
  onSaleDeleted?: (id: string) => void
}

function SalesHistoryTable({ rows, businessId, businessName, onSaleDeleted }: Props) {
  const router = useRouter()
  const currency = useCurrency()
  const fmt = useFormatMoney()
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [saleDetails, setSaleDetails] = useState<Record<string, SaleDetail>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [editingSale, setEditingSale] = useState<SaleDetail | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMethod, setFilterMethod] = useState<PaymentMethod | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [filterOperatorName, setFilterOperatorName] = useState('')
  const [receiptPreview, setReceiptPreview] = useState<ReceiptData | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])
  const { toast, showToast, dismissToast } = useToast()

  // Filter out deleted items
  const visibleRows = useMemo(() => rows.filter(r => !deletedIds.has(r.id)), [rows, deletedIds])

  const filteredRows = useMemo(() => {
    return visibleRows.filter(row => {
      // text search (full-capability, unchanged)
      const q = searchQuery.trim().toLowerCase()
      if (q) {
        const normalizedMethod = normalizePayment(row.method).toLowerCase()
        const matchesBasic =
          row.id.toLowerCase().includes(q) ||
          row.method.toLowerCase().includes(q) ||
          normalizedMethod.includes(q) ||
          row.total.toString().includes(q)
        const matchesProducts = row.product_names.some(name => name.toLowerCase().includes(q))
        const matchesOperator = row.operator_name ? row.operator_name.toLowerCase().includes(q) : false
        const detail = saleDetails[row.id]
        const matchesDetail = detail
          ? detail.items.some(i => i.product_name.toLowerCase().includes(q)) ||
            (detail.operator_name?.toLowerCase().includes(q) ?? false)
          : false
        if (!matchesBasic && !matchesProducts && !matchesOperator && !matchesDetail) return false
      }
      // chip filters — AND with text search and each other
      if (filterMethod !== null && row.method !== filterMethod) return false
      if (filterStatus !== null && row.status !== filterStatus) return false
      if (filterOperatorName !== '') {
        if (filterOperatorName === '__owner__') {
          if (row.operator_name !== null) return false
        } else {
          if (row.operator_name !== filterOperatorName) return false
        }
      }
      return true
    })
  }, [visibleRows, searchQuery, filterMethod, filterStatus, filterOperatorName, saleDetails])

  const operatorOptions = useMemo(() => {
    const names = [...new Set(visibleRows.map(r => r.operator_name).filter(Boolean))] as string[]
    const hasOwnerSales = visibleRows.some(r => r.operator_name === null)
    return [
      { value: '', label: 'Todos' },
      ...(hasOwnerSales ? [{ value: '__owner__', label: 'Dueño' }] : []),
      ...names.map(name => ({ value: name, label: name })),
    ]
  }, [visibleRows])

  const hasActiveFilters = !!searchQuery || filterMethod !== null || filterStatus !== null || filterOperatorName !== ''

  const summaryTotal = useMemo(
    () => filteredRows.reduce((acc, r) => acc + r.total, 0),
    [filteredRows]
  )

  const mostUsedMethod = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredRows.forEach(r => {
      counts[r.method] = (counts[r.method] ?? 0) + 1
    })
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
    return winner ? winner[0] : null
  }, [filteredRows])

  async function loadSaleDetail(saleId: string): Promise<SaleDetail | null> {
    if (saleDetails[saleId]) {
      return saleDetails[saleId]
    }

    setLoadingDetailId(saleId)
    const { data: detailResult, error } = await supabase.rpc('get_sale_detail', {
      p_sale_id: saleId,
      p_business_id: businessId,
    })
    const data = detailResult as SaleDetailRpcResult | null
    if (error || !data?.success) {
      setLoadingDetailId(null)
      setLocalError(error?.message ?? 'No se pudo cargar el detalle de la venta.')
      return null
    }
    const row = rows.find(s => s.id === saleId)
    if (!row) {
      setLoadingDetailId(null)
      return null
    }
    const detail: SaleDetail = {
      ...row,
      status: data.status ?? row.status,
      method: isPaymentMethod(data.payment_method) ? data.payment_method : row.method,
      operator_name: data.operator_name ?? null,
      items: (data.items ?? []).map((item: SaleItemQueryRow) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        product_icon: item.product_icon ?? null,
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
          paymentMethod: detail.method,
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

  const deleteMutation = useMutation({
    mutationFn: async (saleId: string) => {
      if (!businessId) throw new Error('businessId requerido')
      const { data, error } = await supabase.rpc('delete_sale', {
        p_sale_id: saleId,
        p_business_id: businessId,
      })
      if (error || !data?.success) {
        throw new Error(error?.message ?? 'No se pudo eliminar la venta')
      }
      return saleId
    },
    onMutate: (saleId) => {
      setDeletingId(saleId)
    },
    onSuccess: (saleId) => {
      setDeletedIds(prev => new Set([...prev, saleId]))
      onSaleDeleted?.(saleId)
      setSaleDetails(prev => { const next = { ...prev }; delete next[saleId]; return next })
      if (expandedSaleId === saleId) setExpandedSaleId(null)
      showToast({ message: 'Venta eliminada' })
      router.refresh()
    },
    onSettled: () => {
      setDeletingId(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (vars: {
      saleId: string
      items: { product_id: string; quantity: number; unit_price: number }[]
      paymentMethod: PaymentMethod
      status: string
    }) => {
      if (!businessId) throw new Error('businessId requerido')
      const { data, error } = await supabase.rpc('update_sale', {
        p_sale_id: vars.saleId,
        p_business_id: businessId,
        p_items: vars.items,
        p_payment_method: vars.paymentMethod,
        p_status: vars.status,
      })
      if (error || !data?.success) {
        throw new Error(error?.message ?? 'No se pudo actualizar la venta')
      }
      return { ...vars, total: Number(data.total) }
    },
    onSuccess: (result) => {
      // Update saleDetails for immediate UI feedback; main data updates via parent revalidation
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
                product_name: found?.product_name ?? '',
                product_icon: found?.product_icon ?? null,
                quantity: i.quantity,
                unit_price: i.unit_price,
              }
            }),
          },
        }
      })
      setEditingSale(null)
      showToast({ message: 'Venta actualizada' })
    },
  })

  const mutationError = deleteMutation.error?.message ?? updateMutation.error?.message ?? null
  const displayError = localError ?? mutationError

  function dismissError() {
    setLocalError(null)
    deleteMutation.reset()
    updateMutation.reset()
  }

  function clearAllFilters() {
    setSearchQuery('')
    setFilterMethod(null)
    setFilterStatus(null)
    setFilterOperatorName('')
  }

  function handleDeleteSale(saleId: string) {
    if (!businessId) return
    deleteMutation.mutate(saleId)
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
    return new Date(dateString).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="relative surface-card overflow-hidden">
      {/* Filters + summary */}
      <div className="p-4 border-b border-edge-soft space-y-3">
        <p className="font-semibold text-heading font-display">Historial detallado</p>

        {/* Row 1: search + method chips + clear */}
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
                className={`pill-tab ${filterMethod === opt.value ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30' : ''}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="pill-tab text-hint hover:text-body shrink-0"
            >
              Limpiar todo
            </button>
          )}
        </div>

        {/* Row 2: status chips + operator dropdown */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterStatus(prev => prev === 'cancelled' ? null : 'cancelled')}
            className={`pill-tab ${filterStatus === 'cancelled' ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30' : ''}`}
          >
            Canceladas
          </button>
          <button
            onClick={() => setFilterStatus(prev => prev === 'refunded' ? null : 'refunded')}
            className={`pill-tab ${filterStatus === 'refunded' ? 'bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30' : ''}`}
          >
            Reembolsadas
          </button>
          {operatorOptions.length >= 3 && (
            <SelectDropdown
              value={filterOperatorName}
              onChange={setFilterOperatorName}
              options={operatorOptions}
              className="w-[160px]"
              usePortal
            />
          )}
        </div>
        <div className="flex flex-wrap items-stretch gap-x-5 gap-y-2 px-4 py-2.5 bg-muted/50 rounded-xl">
          <div className="flex flex-col gap-0.5">
            <span className="text-label text-hint">Ventas</span>
            <span className="text-base font-semibold text-heading tabular-nums leading-tight">{filteredRows.length}</span>
          </div>
          <div className="w-px bg-border self-stretch hidden sm:block" />
          <div className="flex flex-col gap-0.5">
            <span className="text-label text-hint">Recaudado</span>
            <span className="text-base font-semibold text-heading tabular-nums leading-tight">{fmt(summaryTotal)}</span>
          </div>
          {mostUsedMethod && (
            <>
              <div className="w-px bg-border self-stretch hidden sm:block" />
              <div className="flex flex-col gap-0.5">
                <span className="text-label text-hint">Método</span>
                <span className="text-base font-semibold text-heading leading-tight">{normalizePayment(mostUsedMethod)}</span>
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
      {filteredRows.length === 0 ? (
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
        <ul className="p-3 space-y-1.5">
          {filteredRows.map((sale, index) => {
            const isExpanded = expandedSaleId === sale.id
            const detail = saleDetails[sale.id]
            const isLoadingDetail = loadingDetailId === sale.id
            const isDeleting = deletingId === sale.id
            const saleNumber = filteredRows.length - index

            const totalQty = detail ? detail.items.reduce((sum, i) => sum + i.quantity, 0) : 0

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
                  className="w-full px-3.5 py-2.5 text-left"
                  onClick={() => fetchSaleDetail(sale.id)}
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Contraer' : 'Ver'} detalle, Venta #${saleNumber}, ${fmt(sale.total)}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-semibold text-heading tabular-nums shrink-0">
                        {formatTime(sale.created_at)}
                      </span>
                      <span className="text-xs text-hint shrink-0">· Venta #{saleNumber}</span>
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
                    <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-medium bg-surface-alt border-edge text-body">
                      {normalizePayment(sale.method)}
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
                    {detail && (
                      <>
                        <span className="text-[11px] text-hint">
                          {totalQty} item{totalQty !== 1 ? 's' : ''}
                        </span>
                        {detail.items.slice(0, 4).map(item =>
                          item.product_icon ? (
                            <span key={item.product_id} className="text-xs leading-none" aria-hidden="true">{item.product_icon}</span>
                          ) : null
                        )}
                      </>
                    )}
                  </div>
                </button>

                {isExpanded && detail && (
                  <div className="px-3.5 pb-3 border-t border-dashed border-primary/20 dark:border-primary/15">
                    <ul className="space-y-1 pt-2.5 mb-2.5">
                      {detail.items.map(item => (
                        <li key={item.id} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1.5 text-body min-w-0">
                            {item.product_icon && (
                              <span className="text-sm leading-none shrink-0" aria-hidden="true">{item.product_icon}</span>
                            )}
                            <span className="truncate text-xs">{item.product_name}</span>
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
                              disabled={isDeleting}
                              className="h-9 px-3 text-xs rounded-lg border border-red-300 text-red-600 bg-red-50 dark:border-red-500/40 dark:text-red-400 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors disabled:opacity-50"
                            >
                              Sí
                            </button>
                            <button
                              onClick={() => setConfirmingDeleteId(null)}
                              disabled={isDeleting}
                              className="h-8 px-3 text-xs rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors disabled:opacity-50"
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmingDeleteId(sale.id)}
                            disabled={isDeleting}
                            aria-busy={isDeleting || undefined}
                            aria-label={isDeleting ? 'Eliminando venta…' : undefined}
                            className="h-8 px-3 text-xs rounded-lg border border-red-200 text-red-500 bg-surface hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:bg-transparent dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          >
                            {isDeleting ? '…' : 'Eliminar'}
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
                  className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
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

      {toast && <Toast message={toast.message} duration={toast.duration} onDismiss={dismissToast} />}
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
