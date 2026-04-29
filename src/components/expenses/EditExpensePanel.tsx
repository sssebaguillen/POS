'use client'

import { useEffect, useRef, useState } from 'react'
import { Info, Lock, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/DatePicker'
import SupplierSelectDropdown from './SupplierSelectDropdown'
import ExpenseAttachmentUploader from './ExpenseAttachmentUploader'
import MercaderiaItemsSection from './MercaderiaItemsSection'
import {
  EXPENSE_CATEGORY_LABELS,
  type Expense,
  type ExpenseAttachmentType,
  type MercaderiaItem,
} from './types'

interface AttachmentState {
  url: string
  type: ExpenseAttachmentType
  name: string
}

interface Props {
  expense: Expense
  businessId: string
  supabaseClient: SupabaseClient
  onUpdated: () => void
  onClose: () => void
  canUpdateStock?: boolean
}

export default function EditExpensePanel({
  expense,
  businessId,
  supabaseClient: supabase,
  onUpdated,
  onClose,
  canUpdateStock = false,
}: Props) {
  const isMercaderia = expense.category === 'mercaderia'

  const [description, setDescription] = useState(expense.description)
  const [date, setDate] = useState(expense.date ?? new Date().toISOString().slice(0, 10))
  const [supplierId, setSupplierId] = useState<string | null>(expense.supplier_id)
  const [notes, setNotes] = useState(expense.notes ?? '')
  const [amount, setAmount] = useState(isMercaderia ? '' : String(expense.amount))
  const [attachment, setAttachment] = useState<AttachmentState | null>(
    expense.attachment_url && expense.attachment_type
      ? { url: expense.attachment_url, type: expense.attachment_type, name: expense.attachment_name ?? '' }
      : null
  )
  const [mercaderiaItems, setMercaderiaItems] = useState<MercaderiaItem[]>([])
  const [loadingItems, setLoadingItems] = useState(isMercaderia)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const searchInputRef = useRef<HTMLDivElement>(null)
  const firstItemCostRef = useRef<HTMLInputElement>(null)
  const totalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isMercaderia) return
    supabase
      .from('expense_items')
      .select('product_id, product_name, quantity, unit_cost, update_cost')
      .eq('expense_id', expense.id)
      .then(({ data }) => {
        if (data) {
          setMercaderiaItems(
            data.map(item => ({
              product_id: item.product_id,
              product_name: item.product_name,
              quantity: item.quantity,
              unit_cost: item.unit_cost,
              update_cost: item.update_cost,
              _original_cost: item.unit_cost,
            }))
          )
        }
        setLoadingItems(false)
      })
  }, [expense.id, isMercaderia, supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!description.trim()) {
      setError('La descripción es obligatoria')
      return
    }

    if (isMercaderia) {
      if (mercaderiaItems.length === 0) {
        setError('Agregá al menos un producto')
        return
      }
      setSaving(true)
      const { data, error: rpcError } = await supabase.rpc('update_mercaderia_expense', {
        p_business_id: businessId,
        p_expense_id: expense.id,
        p_description: description.trim(),
        p_date: date || null,
        p_supplier_id: supplierId,
        p_notes: notes.trim() || null,
        p_items: mercaderiaItems.map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
          update_cost: i.update_cost,
        })),
      })
      setSaving(false)
      if (rpcError || !data?.success) {
        const errKey = data?.error
        if (errKey === 'unauthorized') {
          setError('Sin permiso para editar este gasto')
        } else if (errKey === 'not_found') {
          setError('No se encontró el gasto')
        } else {
          setError(rpcError?.message ?? 'No se pudo guardar los cambios')
        }
        return
      }
      onUpdated()
      onClose()
      return
    }

    const numAmount = parseFloat(amount)
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setError('El monto debe ser mayor a 0')
      return
    }

    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('update_expense', {
      p_business_id: businessId,
      p_expense_id: expense.id,
      p_description: description.trim(),
      p_date: date || null,
      p_supplier_id: supplierId,
      p_notes: notes.trim() || null,
      p_amount: numAmount,
      p_attachment_url: attachment?.url ?? null,
      p_attachment_type: attachment?.type ?? null,
      p_attachment_name: attachment?.name ?? null,
    })
    setSaving(false)
    if (rpcError || !data?.success) {
      const errKey = data?.error
      if (errKey === 'unauthorized') {
        setError('Sin permiso para editar este gasto')
      } else if (errKey === 'not_found') {
        setError('No se encontró el gasto')
      } else {
        setError(rpcError?.message ?? 'No se pudo guardar los cambios')
      }
      return
    }
    onUpdated()
    onClose()
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md surface-elevated border-l border-edge flex flex-col" style={{ borderRadius: 0 }}>
      <div className="h-14 border-b border-edge/60 flex items-center justify-between px-5 shrink-0">
        <h2 className="font-semibold text-heading">Editar gasto</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
        >
          <X size={18} />
        </button>
      </div>

      <form id="edit-expense-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {isMercaderia && (
          <div className="flex items-start gap-2.5 rounded-xl border border-blue-400/30 bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2.5 text-sm text-blue-700 dark:text-blue-300">
            <Info size={14} className="shrink-0 mt-0.5" />
            <span>Estás editando una compra de mercadería. Los cambios se reflejarán en el inventario automáticamente.</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-label text-hint">Categoría</label>
          <div
            className="flex items-center w-full h-9 rounded-lg border border-input bg-muted/40 px-3 text-sm text-hint cursor-not-allowed select-none"
            title="La categoría no puede modificarse"
          >
            <span className="flex-1">{EXPENSE_CATEGORY_LABELS[expense.category]}</span>
            <Lock size={12} className="text-hint/50 shrink-0" />
          </div>
        </div>

        {isMercaderia ? (
          <div className="space-y-1.5">
            <label className="text-label text-hint">Productos</label>
            {loadingItems ? (
              <div className="flex items-center justify-center py-8 text-hint text-sm">
                Cargando productos...
              </div>
            ) : (
              <MercaderiaItemsSection
                businessId={businessId}
                supabaseClient={supabase}
                items={mercaderiaItems}
                onItemsChange={setMercaderiaItems}
                canUpdateStock={canUpdateStock}
                searchInputRef={searchInputRef}
                firstItemCostRef={firstItemCostRef}
                totalRef={totalRef}
              />
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-label text-hint">
              Monto <span className="text-destructive">*</span>
            </label>
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
        )}

        <div className="space-y-1.5">
          <label className="text-label text-hint">
            Descripción <span className="text-destructive">*</span>
          </label>
          <Input
            value={description}
            onChange={e => { setDescription(e.target.value); setError(null) }}
            placeholder="Ej: Compra de mercadería"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-label text-hint">Fecha</label>
          <DatePicker value={date} onChange={setDate} className="w-full" />
        </div>

        <div className="space-y-1.5">
          <label className="text-label text-hint">Proveedor (opcional)</label>
          <SupplierSelectDropdown
            value={supplierId}
            onChange={setSupplierId}
            businessId={businessId}
            supabaseClient={supabase}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-label text-hint">Notas (opcional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Información adicional..."
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-body placeholder:text-hint resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-input/30"
          />
        </div>

        {!isMercaderia && (
          <div className="space-y-1.5">
            <label className="text-label text-hint">Adjunto (opcional)</label>
            <ExpenseAttachmentUploader
              businessId={businessId}
              onUpload={setAttachment}
              onRemove={() => setAttachment(null)}
              current={attachment}
            />
          </div>
        )}

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
          className="flex-1 h-9 rounded-lg text-sm"
          onClick={onClose}
          disabled={saving}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          form="edit-expense-form"
          className="flex-1 h-9 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
          disabled={saving || loadingItems}
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </div>
    </div>
  )
}
