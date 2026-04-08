'use client'

import { useState, useMemo, memo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Printer, Trash2 } from 'lucide-react'
import ReceiptPreviewModal from '@/components/pos/ReceiptPreviewModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buildReceiptData } from '@/lib/printer/receipt'
import type { ReceiptData } from '@/lib/printer/types'
import { createClient } from '@/lib/supabase/client'
import { normalizePayment, PAYMENT_LABELS } from '@/lib/payments'
import { useToast } from '@/hooks/useToast'
import Toast from '@/components/shared/Toast'

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
  method: string
}

interface SaleDetail extends SaleRow {
  items: SaleItem[]
  operator_name: string | null
}

interface SaleItemQueryRow {
  id: string
  product_id: string
  product_name: string
  product_icon: string | null
  quantity: number
  unit_price: number
}

interface Props {
  rows: SaleRow[]
  businessId: string | null
  businessName: string
}

function SalesHistoryTable({ rows, businessId, businessName }: Props) {
  const [localRows, setLocalRows] = useState<SaleRow[]>(rows)
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)
  const [saleDetails, setSaleDetails] = useState<Record<string, SaleDetail>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [editingSale, setEditingSale] = useState<SaleDetail | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [receiptPreview, setReceiptPreview] = useState<ReceiptData | null>(null)
  const [receiptError, setReceiptError] = useState('')
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const { toast, showToast, dismissToast } = useToast()

  const filteredRows = useMemo(() => {
    return localRows.filter(row => {
      const q = searchQuery.trim().toLowerCase()
      if (!q) return true
      const detail = saleDetails[row.id]
      const matchesBasic =
        row.id.toLowerCase().includes(q) ||
        row.method.toLowerCase().includes(q) ||
        row.total.toString().includes(q)
      const matchesDetail = detail
        ? detail.items.some(i => i.product_name.toLowerCase().includes(q)) ||
          (detail.operator_name?.toLowerCase().includes(q) ?? false)
        : false
      return matchesBasic || matchesDetail
    })
  }, [localRows, searchQuery, saleDetails])

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
    const { data, error } = await supabase.rpc('get_sale_detail', {
      p_sale_id: saleId,
      p_business_id: businessId,
    })
    if (error || !data?.success) {
      setLoadingDetailId(null)
      setReceiptError(error?.message ?? 'No se pudo cargar el detalle de la venta.')
      return null
    }
    const row = localRows.find(s => s.id === saleId)
    if (!row) {
      setLoadingDetailId(null)
      return null
    }
    const detail: SaleDetail = {
      ...row,
      status: data.status ?? row.status,
      method: data.payment_method ?? row.method,
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
    setReceiptError('')
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
      }))
    } catch (receiptBuildError) {
      console.error(receiptBuildError)
      setReceiptError(
        receiptBuildError instanceof Error
          ? receiptBuildError.message
          : 'No se pudo preparar el ticket de la venta.'
      )
    }
  }

  const deleteMutation = useMutation({
    mutationFn: async (saleId: string) => {
      const { data, error } = await supabase.rpc('delete_sale', {
        p_sale_id: saleId,
        p_business_id: businessId!,
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
      setLocalRows(prev => prev.filter(s => s.id !== saleId))
      setSaleDetails(prev => { const next = { ...prev }; delete next[saleId]; return next })
      if (expandedSaleId === saleId) setExpandedSaleId(null)
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      showToast({ message: 'Venta eliminada' })
    },
    onSettled: () => {
      setDeletingId(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (vars: {
      saleId: string
      items: { product_id: string; quantity: number; unit_price: number }[]
      paymentMethod: string
      status: string
    }) => {
      const { data, error } = await supabase.rpc('update_sale', {
        p_sale_id: vars.saleId,
        p_business_id: businessId!,
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
      setLocalRows(prev =>
        prev.map(s =>
          s.id === result.saleId
            ? { ...s, subtotal: result.total, total: result.total, method: result.paymentMethod, status: result.status }
            : s
        )
      )
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
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      showToast({ message: 'Venta actualizada' })
    },
  })

  const mutationError = deleteMutation.error?.message ?? updateMutation.error?.message ?? null

  function handleDeleteSale(saleId: string) {
    if (!businessId) return
    deleteMutation.mutate(saleId)
  }

  function handleUpdateSale(
    saleId: string,
    updatedItems: { product_id: string; quantity: number; unit_price: number }[],
    paymentMethod: string,
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
        <p className="font-semibold text-heading">Historial detallado</p>
        <div className="flex flex-wrap gap-2">
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar por id, método, producto..."
            className="h-9 flex-1 min-w-[160px] rounded-lg text-sm"
          />
          {searchQuery && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-xs h-9"
              onClick={() => setSearchQuery('')}
            >
              Limpiar
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-subtle">
          <span>Total de ventas: <strong className="text-body">{filteredRows.length}</strong></span>
          <span>Total recaudado: <strong className="text-body">${summaryTotal.toLocaleString('es-AR')}</strong></span>
          {mostUsedMethod && (
            <span>Método más usado: <strong className="text-body">{normalizePayment(mostUsedMethod)}</strong></span>
          )}
        </div>
        {receiptError && (
          <p className="text-xs text-red-500">{receiptError}</p>
        )}
        {mutationError && (
          <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            <p className="text-xs text-red-600 dark:text-red-400">{mutationError}</p>
            <button
              className="text-xs text-red-500 hover:text-red-700 underline ml-2"
              onClick={() => { deleteMutation.reset(); updateMutation.reset() }}
            >
              Cerrar
            </button>
          </div>
        )}
      </div>

      {/* Sale list */}
      {filteredRows.length === 0 ? (
        <div className="p-8 text-center text-sm text-hint">No hay ventas para mostrar</div>
      ) : (
        <ul className="p-3 space-y-1.5">
          {filteredRows.map((sale, index) => {
            const isExpanded = expandedSaleId === sale.id
            const detail = saleDetails[sale.id]
            const isLoadingDetail = loadingDetailId === sale.id
            const isDeleting = deletingId === sale.id
            const saleNumber = filteredRows.length - index

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
                        ${sale.total.toLocaleString('es-AR')}
                      </span>
                      {isLoadingDetail ? (
                        <span className="w-3 h-3 border-2 border-hint border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <span className={`text-[10px] text-hint transition-transform duration-150 inline-block ${isExpanded ? '-rotate-180' : ''}`}>
                          ▾
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                      isExpanded
                        ? 'bg-primary/10 border-primary/20 text-primary dark:bg-primary/20 dark:border-primary/30'
                        : 'bg-surface-alt border-edge text-body'
                    }`}>
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
                          {detail.items.reduce((sum, i) => sum + i.quantity, 0)} item{detail.items.reduce((sum, i) => sum + i.quantity, 0) !== 1 ? 's' : ''}
                        </span>
                        {detail.items.slice(0, 4).map(item =>
                          item.product_icon ? (
                            <span key={item.product_id} className="text-xs leading-none">{item.product_icon}</span>
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
                              <span className="text-sm leading-none shrink-0">{item.product_icon}</span>
                            )}
                            <span className="truncate text-xs">{item.product_name}</span>
                            <span className="text-hint shrink-0 text-xs">×{item.quantity}</span>
                          </span>
                          <span className="text-xs font-semibold text-heading tabular-nums shrink-0 ml-3">
                            ${(item.quantity * item.unit_price).toLocaleString('es-AR')}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex justify-between items-center border-t border-dashed border-primary/20 dark:border-primary/15 pt-2 mb-1">
                      <span className="text-xs font-semibold text-heading">Total cobrado</span>
                      <span className="text-xs font-bold text-primary tabular-nums">
                        ${detail.total.toLocaleString('es-AR')}
                      </span>
                    </div>

                    {detail.operator_name && (
                      <p className="text-[11px] text-hint mb-2.5">Por: {detail.operator_name}</p>
                    )}

                            <div className="flex items-center justify-between gap-2 mt-2.5">
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => setEditingSale(detail)}
                                  className="text-[11px] px-2.5 py-1 rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleDeleteSale(sale.id)}
                                  disabled={isDeleting}
                                  className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-500 bg-surface hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:bg-transparent dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                >
                                  {isDeleting ? '…' : 'Eliminar'}
                                </button>
                              </div>
                              <button
                                onClick={() => handleOpenReceiptPreview(sale.id)}
                                className="text-[11px] px-2.5 py-1 rounded-lg border border-edge text-body bg-surface hover:bg-hover-bg transition-colors inline-flex items-center gap-1.5"
                              >
                                <Printer size={12} />
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

      {editingSale && (
        <div className="absolute inset-0 z-40 bg-background flex flex-col">
          <div className="flex items-center gap-3 px-4 h-12 border-b border-edge shrink-0">
            <button
              onClick={() => setEditingSale(null)}
              className="text-hint hover:text-body transition-colors text-sm"
            >
              ← Volver
            </button>
            <span className="text-sm font-semibold text-heading">
              Editar venta · {formatTime(editingSale.created_at)}
            </span>
          </div>
          <EditSalePanel
            sale={editingSale}
            onSave={(updatedItems, paymentMethod, status) =>
              handleUpdateSale(editingSale.id, updatedItems, paymentMethod, status)
            }
            onCancel={() => setEditingSale(null)}
          />
        </div>
      )}

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
  onSave: (items: { product_id: string; quantity: number; unit_price: number }[], paymentMethod: string, status: string) => void
  onCancel: () => void
}) {
  const PAYMENT_OPTIONS: { value: string; label: string }[] = [
    { value: 'cash', label: PAYMENT_LABELS.cash },
    { value: 'card', label: PAYMENT_LABELS.card },
    { value: 'mercadopago', label: PAYMENT_LABELS.mercadopago },
    { value: 'transfer', label: PAYMENT_LABELS.transfer },
  ]
  const [items, setItems] = useState(sale.items.map(i => ({ ...i })))
  const [paymentMethod, setPaymentMethod] = useState(sale.method)
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
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {items.map(item => (
          <div key={item.product_id} className="flex items-center gap-3 py-2 border-b border-edge-soft">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-heading truncate">{item.product_name}</p>
              <p className="text-xs text-hint">${item.unit_price.toLocaleString('es-AR')} c/u</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => updateQty(item.product_id, item.quantity - 1)}
                className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors text-xs"
              >
                −
              </button>
              <span className="text-sm font-semibold w-6 text-center tabular-nums">{item.quantity}</span>
              <button
                onClick={() => updateQty(item.product_id, item.quantity + 1)}
                className="w-6 h-6 rounded-md bg-surface-alt hover:bg-hover-bg flex items-center justify-center transition-colors text-xs"
              >
                +
              </button>
            </div>
            <p className="text-sm font-semibold text-heading tabular-nums w-20 text-right shrink-0">
              ${(item.quantity * item.unit_price).toLocaleString('es-AR')}
            </p>
            <button
              onClick={() => removeItem(item.product_id)}
              className="text-faint hover:text-red-400 transition-colors shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-edge space-y-3 shrink-0">
        <div>
          <p className="text-xs text-hint mb-1.5">Método de pago</p>
          <div className="flex flex-wrap gap-1.5">
            {PAYMENT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setPaymentMethod(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
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
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  saleStatus === opt.value
                    ? opt.value === 'completed'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : opt.value === 'cancelled'
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-red-500 text-white border-red-500'
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
            ${total.toLocaleString('es-AR')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="cancel"
            className="h-10 rounded-xl text-sm"
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button
            className="h-10 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
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
