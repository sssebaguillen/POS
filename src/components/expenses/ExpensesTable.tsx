'use client'

import { useState, useMemo } from 'react'
import { Paperclip, Trash2 } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EXPENSE_CATEGORY_LABELS, type Expense } from './types'

interface Props {
  expenses: Expense[]
  businessId: string
  supabaseClient: SupabaseClient
  onDeleted: (id: string) => void
}

export default function ExpensesTable({ expenses, businessId, supabaseClient, onDeleted }: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  if (expenses.length === 0) {
    return (
      <div className="surface-card px-6 py-16 flex flex-col items-center gap-2">
        <p className="text-body font-medium">Sin gastos para el período</p>
        <p className="text-sm text-hint">Registrá un nuevo gasto con el botón de arriba</p>
      </div>
    )
  }

  return (
    <div className="surface-card overflow-hidden">
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
                  <a
                    href={expense.attachment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center text-primary hover:text-primary/70 transition-colors"
                    title={expense.attachment_name ?? 'Adjunto'}
                  >
                    <Paperclip size={15} />
                  </a>
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
  )
}
