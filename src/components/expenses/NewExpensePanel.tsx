'use client'

import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import ExpenseAttachmentUploader from './ExpenseAttachmentUploader'
import SupplierSelectDropdown from './SupplierSelectDropdown'
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseAttachmentType,
} from './types'

interface AttachmentState {
  url: string
  type: ExpenseAttachmentType
  name: string
}

interface Props {
  businessId: string
  supabaseClient: SupabaseClient
  onCreated: () => void
  onClose: () => void
}

const categoryOptions = EXPENSE_CATEGORIES.map(c => ({
  value: c,
  label: EXPENSE_CATEGORY_LABELS[c],
}))

export default function NewExpensePanel({ businessId, supabaseClient, onCreated, onClose }: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const [category, setCategory] = useState<ExpenseCategory>('mercaderia')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [attachment, setAttachment] = useState<AttachmentState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const numAmount = parseFloat(amount)
    if (!description.trim()) { setError('La descripción es obligatoria'); return }
    if (!amount || isNaN(numAmount) || numAmount <= 0) { setError('El monto debe ser mayor a 0'); return }

    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('create_expense', {
      p_business_id: businessId,
      p_category: category,
      p_amount: numAmount,
      p_description: description.trim(),
      p_date: date || null,
      p_supplier_id: supplierId,
      p_operator_id: null,
      p_attachment_url: attachment?.url ?? null,
      p_attachment_type: attachment?.type ?? null,
      p_attachment_name: attachment?.name ?? null,
      p_notes: notes.trim() || null,
    })
    setSaving(false)
    if (rpcError || !data?.success) {
      setError(rpcError?.message ?? 'No se pudo registrar el gasto')
      return
    }
    onCreated()
    onClose()
  }

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col">
      <div className="h-14 border-b border-edge/60 flex items-center justify-between px-5 shrink-0">
        <h2 className="font-semibold text-heading">Nuevo gasto</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
        >
          <X size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-body">Categoría</label>
          <SelectDropdown
            value={category}
            onChange={v => setCategory(v as ExpenseCategory)}
            options={categoryOptions}
            usePortal
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-body">Monto <span className="text-destructive">*</span></label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={e => { setAmount(e.target.value); setError(null) }}
            placeholder="0.00"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-body">Descripción <span className="text-destructive">*</span></label>
          <Input
            value={description}
            onChange={e => { setDescription(e.target.value); setError(null) }}
            placeholder="Ej: Compra de mercadería"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-body">Fecha</label>
          <Input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-body">Proveedor (opcional)</label>
          <SupplierSelectDropdown
            value={supplierId}
            onChange={setSupplierId}
            businessId={businessId}
            supabaseClient={supabase}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-body">Notas (opcional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Información adicional..."
            className="w-full rounded-xl border border-edge bg-input px-3 py-2 text-sm text-body placeholder:text-hint resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-body">Adjunto (opcional)</label>
          <ExpenseAttachmentUploader
            businessId={businessId}
            onUpload={setAttachment}
            onRemove={() => setAttachment(null)}
            current={attachment}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
            {error}
          </p>
        )}
      </form>

      <div className="border-t border-edge/60 px-5 py-4 flex gap-3 shrink-0">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onClose}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          className="btn-primary-gradient flex-1"
          disabled={saving}
          onClick={handleSubmit}
        >
          {saving ? 'Guardando...' : 'Registrar gasto'}
        </Button>
      </div>
    </div>
  )
}
