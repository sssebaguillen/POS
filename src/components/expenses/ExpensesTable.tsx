'use client'

import { useState, useMemo, useRef } from 'react'
import { Paperclip, Trash2, Loader2 } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EXPENSE_CATEGORY_LABELS, type Expense, type ExpenseAttachmentType } from './types'
import ExpenseAttachmentModal from './ExpenseAttachmentModal'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/useToast'
import Toast from '@/components/shared/Toast'

/** Extracts the storage path from either a legacy full Supabase URL or a bare path. */
function extractStoragePath(url: string): string {
  if (url.startsWith('http')) {
    const marker = '/expense-receipts/'
    const idx = url.indexOf(marker)
    if (idx !== -1) return url.slice(idx + marker.length)
  }
  return url
}

interface ExpenseItem {
  product_name: string
  quantity: number
  update_cost: boolean
}

interface Props {
  expenses: Expense[]
  businessId: string
  supabaseClient: SupabaseClient
  onDeleted: (id: string) => void
}

export default function ExpensesTable({ expenses, businessId, supabaseClient, onDeleted }: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const { toast, showToast, dismissToast } = useToast()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loadingItemsId, setLoadingItemsId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null)
  const [pendingItems, setPendingItems] = useState<ExpenseItem[] | null>(null)
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [modal, setModal] = useState<{
    signedUrl: string
    type: ExpenseAttachmentType | null
    name: string | null
  } | null>(null)
  const latestRequestRef = useRef(0)

  async function handleTrashClick(expense: Expense) {
    if (expense.category === 'mercaderia') {
      setLoadingItemsId(expense.id)
      const { data } = await supabase
        .from('expense_items')
        .select('product_name, quantity, update_cost')
        .eq('expense_id', expense.id)
      setLoadingItemsId(null)
      setPendingItems((data as ExpenseItem[] | null) ?? [])
    } else {
      setPendingItems(null)
    }
    setPendingDelete(expense)
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setPendingDelete(null)
    setDeletingId(id)
    const { data, error } = await supabase.rpc('delete_expense', {
      p_business_id: businessId,
      p_expense_id: id,
    })
    setDeletingId(null)
    if (error || !data?.success) {
      showToast({ message: 'No se pudo eliminar el gasto. Intenta de nuevo.' })
      return
    }
    onDeleted(id)
  }

  async function handleOpenAttachment(
    expenseId: string,
    rawUrl: string,
    type: ExpenseAttachmentType | null,
    name: string | null,
  ) {
    const requestId = ++latestRequestRef.current
    setAttachmentError(null)
    setLoadingAttachmentId(expenseId)
    const path = extractStoragePath(rawUrl)
    const { data, error } = await supabase.storage
      .from('expense-receipts')
      .createSignedUrl(path, 3600)
    if (requestId !== latestRequestRef.current) return
    setLoadingAttachmentId(null)
    if (error || !data?.signedUrl) {
      setAttachmentError('No se pudo cargar el documento. Intenta de nuevo.')
      return
    }
    setModal({ signedUrl: data.signedUrl, type, name })
  }

  if (expenses.length === 0) {
    return (
      <div className="surface-card px-6 py-16 flex flex-col items-center gap-2">
        <p className="text-body font-medium">Sin gastos para el período</p>
        <p className="text-sm text-hint">Registrá un nuevo gasto con el botón de arriba</p>
      </div>
    )
  }

  return (
    <>
      <div className="surface-card overflow-hidden">
        {attachmentError && (
          <div className="px-4 py-2 text-xs text-destructive border-b border-edge/40 bg-destructive/5">
            {attachmentError}
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="border-b border-edge/60">
            <tr className="text-xs text-hint font-medium">
              <th className="text-left px-4 py-3">Fecha</th>
              <th className="text-left px-4 py-3">Categoría</th>
              <th className="text-left px-4 py-3">Descripción</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Proveedor</th>
              <th className="text-right px-4 py-3">Monto</th>
              <th className="text-center px-4 py-3 hidden lg:table-cell">Adjunto</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(expense => (
              <tr key={expense.id} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                <td className="px-4 py-3 text-hint text-xs whitespace-nowrap">
                  {new Date(expense.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    {EXPENSE_CATEGORY_LABELS[expense.category]}
                  </span>
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  <span className="text-body truncate block">{expense.description}</span>
                  {expense.category === 'mercaderia' && (expense.item_count ?? 0) > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {expense.item_count} producto{expense.item_count !== 1 ? 's' : ''}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-hint hidden md:table-cell">
                  {expense.supplier?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-heading">
                  ${expense.amount.toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-3 text-center hidden lg:table-cell">
                  {expense.attachment_url ? (
                    <button
                      type="button"
                      onClick={() => handleOpenAttachment(expense.id, expense.attachment_url!, expense.attachment_type, expense.attachment_name)}
                      disabled={loadingAttachmentId === expense.id}
                      className="inline-flex items-center justify-center text-primary hover:text-primary/70 transition-colors disabled:opacity-50"
                      title={expense.attachment_name ?? 'Ver adjunto'}
                    >
                      {loadingAttachmentId === expense.id
                        ? <Loader2 size={15} className="animate-spin" />
                        : <Paperclip size={15} />
                      }
                    </button>
                  ) : (
                    <span className="text-hint opacity-30"><Paperclip size={15} /></span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleTrashClick(expense)}
                    disabled={deletingId === expense.id || loadingItemsId === expense.id}
                    className="p-1.5 rounded-lg text-hint hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    title="Eliminar gasto"
                  >
                    {(deletingId === expense.id || loadingItemsId === expense.id)
                      ? <Loader2 size={15} className="animate-spin" />
                      : <Trash2 size={15} />
                    }
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <DeleteExpenseDialog
          expense={pendingDelete}
          items={pendingItems}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {modal && (
        <ExpenseAttachmentModal
          signedUrl={modal.signedUrl}
          type={modal.type}
          name={modal.name}
          onClose={() => setModal(null)}
        />
      )}

      {toast && (
        <Toast message={toast.message} duration={toast.duration} onDismiss={dismissToast} />
      )}
    </>
  )
}

function DeleteExpenseDialog({
  expense,
  items,
  onConfirm,
  onCancel,
}: {
  expense: Expense
  items: ExpenseItem[] | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const formattedAmount = `$${expense.amount.toLocaleString('es-AR')}`
  const isMercaderia = expense.category === 'mercaderia'
  const isMedium = expense.category === 'sueldos' || expense.category === 'proveedores'
  const hasCostUpdate = isMercaderia && items !== null && items.some(i => i.update_cost)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl">
        <div className={`px-5 py-4 ${isMercaderia ? 'space-y-2' : 'space-y-1'}`}>
          <p className="font-semibold text-heading">
            {isMercaderia ? '¿Eliminar compra de mercadería?' : '¿Eliminar este gasto?'}
          </p>

          {isMercaderia ? (
            <>
              <p className="text-sm text-body">
                Esta acción revertirá el stock de los productos involucrados. No se puede deshacer.
              </p>
              {hasCostUpdate && (
                <p className="text-sm text-body">
                  El costo de compra de los productos afectados será eliminado y deberá actualizarse manualmente.
                </p>
              )}
              {items && items.length > 0 && (
                <ul className="mt-1 rounded-lg border border-edge divide-y divide-edge">
                  {items.map((item, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-body truncate">{item.product_name}</span>
                      <span className="shrink-0 font-medium text-heading ml-4">−{item.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm font-medium text-heading">{formattedAmount}</p>
            </>
          ) : isMedium ? (
            <p className="text-sm text-body">{expense.description} · {formattedAmount}</p>
          ) : (
            <p className="text-sm text-body">{formattedAmount}</p>
          )}
        </div>

        <div className="px-5 py-3 flex justify-end gap-2 border-t border-edge">
          <Button variant="cancel" className="h-9 px-5 rounded-lg text-sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" className="h-9 px-5 rounded-lg text-sm" onClick={onConfirm}>
            {isMercaderia ? 'Entiendo, eliminar' : 'Eliminar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
