'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/DatePicker'
import SelectDropdown from '@/components/ui/SelectDropdown'
import ExpenseAttachmentUploader from './ExpenseAttachmentUploader'
import SupplierSelectDropdown from './SupplierSelectDropdown'
import MercaderiaItemsSection from './MercaderiaItemsSection'
import MercaderiaOnboarding, { MERCADERIA_ONBOARDING_KEY } from '@/components/onboarding/MercaderiaOnboarding'
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseAttachmentType,
  type MercaderiaItem,
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
  canUpdateStock?: boolean
}

const categoryOptions = EXPENSE_CATEGORIES.map(c => ({
  value: c,
  label: EXPENSE_CATEGORY_LABELS[c],
}))

export default function NewExpensePanel({
  businessId,
  supabaseClient: supabase,
  onCreated,
  onClose,
  canUpdateStock = false,
}: Props) {
  const [category, setCategory] = useState<ExpenseCategory>('mercaderia')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [supplierId, setSupplierId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [attachment, setAttachment] = useState<AttachmentState | null>(null)
  const [mercaderiaItems, setMercaderiaItems] = useState<MercaderiaItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const isMercaderia = category === 'mercaderia'

  const searchInputRef = useRef<HTMLDivElement>(null)
  const firstItemCostRef = useRef<HTMLInputElement>(null)
  const totalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (category === 'mercaderia') {
      const done = localStorage.getItem(MERCADERIA_ONBOARDING_KEY)
      if (!done) setShowOnboarding(true)
    }
  }, [category])

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
      const { data, error: rpcError } = await supabase.rpc('create_mercaderia_expense', {
        p_business_id: businessId,
        p_description: description.trim(),
        p_date: date || null,
        p_supplier_id: supplierId,
        p_operator_id: null,
        p_notes: notes.trim() || null,
        p_items: mercaderiaItems.map(i => ({
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
          update_cost: i.update_cost,
        })),
        p_update_stock: canUpdateStock,
      })
      setSaving(false)
      if (rpcError || !data?.success) {
        const errKey = data?.error
        if (errKey === 'no_items') {
          setError('Agregá al menos un producto')
        } else if (errKey === 'unauthorized') {
          setError('Sin permiso para registrar gastos')
        } else {
          setError(rpcError?.message ?? 'No se pudo registrar el gasto')
        }
        return
      }
      onCreated()
      onClose()
      return
    }

    const numAmount = parseFloat(amount)
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setError('El monto debe ser mayor a 0')
      return
    }

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
    <>
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md surface-elevated border-l border-edge flex flex-col" style={{ borderRadius: 0 }}>
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

        <form id="new-expense-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          <div className="space-y-1.5">
            <label className="text-label text-hint">Categoría</label>
            <SelectDropdown
              value={category}
              onChange={v => setCategory(v as ExpenseCategory)}
              options={categoryOptions}
              usePortal
            />
          </div>

          {isMercaderia ? (
            <div className="space-y-1.5">
              <label className="text-label text-hint">Productos</label>
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
            form="new-expense-form"
            className="flex-1 h-9 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={saving}
          >
            {saving ? 'Guardando...' : 'Registrar gasto'}
          </Button>
        </div>
      </div>

      {showOnboarding && (
        <MercaderiaOnboarding
          active={true}
          searchInputRef={searchInputRef}
          firstItemCostRef={firstItemCostRef}
          totalRef={totalRef}
          hasItems={mercaderiaItems.length > 0}
          onComplete={() => {
            localStorage.setItem(MERCADERIA_ONBOARDING_KEY, 'true')
            setShowOnboarding(false)
          }}
        />
      )}
    </>
  )
}
