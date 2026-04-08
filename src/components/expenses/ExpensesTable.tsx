'use client'

import { useState, useMemo, useRef } from 'react'
import { Paperclip, Trash2, Loader2 } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EXPENSE_CATEGORY_LABELS, type Expense, type ExpenseAttachmentType } from './types'
import ExpenseAttachmentModal from './ExpenseAttachmentModal'

/** Extracts the storage path from either a legacy full Supabase URL or a bare path. */
function extractStoragePath(url: string): string {
  if (url.startsWith('http')) {
    const marker = '/expense-receipts/'
    const idx = url.indexOf(marker)
    if (idx !== -1) return url.slice(idx + marker.length)
  }
  return url
}

interface Props {
  expenses: Expense[]
  businessId: string
  supabaseClient: SupabaseClient
  onDeleted: (id: string) => void
}

export default function ExpensesTable({ expenses, businessId, supabaseClient, onDeleted }: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [modal, setModal] = useState<{
    signedUrl: string
    type: ExpenseAttachmentType | null
    name: string | null
  } | null>(null)
  const latestRequestRef = useRef(0)

  async function handleDelete(id: string) {
    setDeletingId(id)
    const { data, error } = await supabase.rpc('delete_expense', {
      p_business_id: businessId,
      p_expense_id: id,
    })
    setDeletingId(null)
    if (error || !data?.success) {
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
              <td className="px-4 py-3 text-body max-w-[200px] truncate">{expense.description}</td>
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
                  onClick={() => handleDelete(expense.id)}
                  disabled={deletingId === expense.id}
                  className="p-1.5 rounded-lg text-hint hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                  title="Eliminar gasto"
                >
                  <Trash2 size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {modal && (
      <ExpenseAttachmentModal
        signedUrl={modal.signedUrl}
        type={modal.type}
        name={modal.name}
        onClose={() => setModal(null)}
      />
    )}
  </>
  )
}
