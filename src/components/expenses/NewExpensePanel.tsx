'use client'

import { useRef, useState } from 'react'
import { trackExpenseCreated } from '@/lib/analytics'
import { ERR } from '@/lib/errors'
import { X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/DatePicker'
import SelectDropdown from '@/components/ui/SelectDropdown'
import ExpenseAttachmentUploader from './ExpenseAttachmentUploader'
import ExpenseScanCard, { type ExpenseSuggestion } from './ExpenseScanCard'
import SupplierSelectDropdown from './SupplierSelectDropdown'
import MercaderiaItemsSection from './MercaderiaItemsSection'
import MercaderiaOnboarding, { MERCADERIA_ONBOARDING_KEY } from '@/components/onboarding/MercaderiaOnboarding'
import { useSlidePanelAnimation } from '@/components/shared/useSlidePanelAnimation'
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
  file?: File
}

// Normaliza un nombre de proveedor para el match difuso: minúsculas, sin acentos, sin sufijos
// societarios (S.R.L./S.A./SAS) ni puntuación.
function normalizeSupplierName(x: string): string {
  return x
    .toLowerCase()
    .normalize('NFD')
    .replace(/\b(s\.?r\.?l\.?|s\.?a\.?s\.?|s\.?a\.?|srl|sas|sa)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

interface Props {
  businessId: string
  operatorId: string | null
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
  operatorId,
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
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem(MERCADERIA_ONBOARDING_KEY)
  )

  const isMercaderia = category === 'mercaderia'

  const searchInputRef = useRef<HTMLDivElement>(null)
  const firstItemCostRef = useRef<HTMLInputElement>(null)
  const totalRef = useRef<HTMLDivElement>(null)
  const { visible, closePanel } = useSlidePanelAnimation({ onClose })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!description.trim()) {
      setError(ERR.EXP41)
      return
    }

    if (isMercaderia) {
      if (mercaderiaItems.length === 0) {
        setError(ERR.EXP43)
        return
      }
      setSaving(true)
      try {
        const { data, error: rpcError } = await supabase.rpc('create_mercaderia_expense', {
          p_business_id: businessId,
          p_description: description.trim(),
          p_date: date || null,
          p_supplier_id: supplierId,
          p_operator_id: operatorId,
          p_notes: notes.trim() || null,
          p_items: mercaderiaItems.map(i => ({
            product_id: i.product_id,
            product_name: i.product_name,
            variant_id: i.variant_id ?? undefined,
            quantity: i.quantity,
            unit_cost: i.unit_cost,
            update_cost: i.update_cost,
          })),
          p_update_stock: canUpdateStock,
        })
        if (rpcError || !data?.success) {
          const errKey = data?.error
          if (errKey === 'no_items') {
            setError(ERR.EXP43)
          } else if (errKey === 'unauthorized') {
            setError(ERR.EXP2)
          } else if (errKey === 'cost_conflict') {
            setError(ERR.EXP5)
          } else {
            setError(ERR.EXP1)
          }
          return
        }
        trackExpenseCreated({
          tipo: 'mercaderia',
          update_stock: canUpdateStock,
          update_cost: mercaderiaItems.some(i => i.update_cost),
          line_count: mercaderiaItems.length,
        })
        onCreated()
        closePanel()
      } catch {
        setError(ERR.EXP1)
      } finally {
        setSaving(false)
      }
      return
    }

    const numAmount = parseFloat(amount)
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setError(ERR.EXP42)
      return
    }

    setSaving(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('create_expense', {
        p_business_id: businessId,
        p_category: category,
        p_amount: numAmount,
        p_description: description.trim(),
        p_date: date || null,
        p_supplier_id: supplierId,
        p_operator_id: operatorId,
        p_attachment_url: attachment?.url ?? null,
        p_attachment_type: attachment?.type ?? null,
        p_attachment_name: attachment?.name ?? null,
        p_notes: notes.trim() || null,
      })
      if (rpcError || !data?.success) {
        setError(ERR.EXP1)
        return
      }
      trackExpenseCreated({
        tipo: category,
        update_stock: false,
        update_cost: false,
        line_count: 0,
      })
      onCreated()
      closePanel()
    } catch {
      setError(ERR.EXP1)
    } finally {
      setSaving(false)
    }
  }

  async function findSupplierMatch(name: string): Promise<string | null> {
    const target = normalizeSupplierName(name)
    if (target.length < 3) return null
    const { data } = await supabase
      .from('suppliers')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('is_active', true)
    if (!data) return null
    let best: { id: string; len: number } | null = null
    for (const sup of data as { id: string; name: string }[]) {
      const n = normalizeSupplierName(sup.name)
      if (n.length < 3) continue
      if (target.includes(n) || n.includes(target)) {
        if (!best || n.length > best.len) best = { id: sup.id, len: n.length }
      }
    }
    return best?.id ?? null
  }

  async function handleApplySuggestion(s: ExpenseSuggestion) {
    setCategory(s.category)
    if (s.amount != null) setAmount(String(s.amount))
    if (s.description) setDescription(s.description)
    if (s.date) setDate(s.date)
    setError(null)
    if (s.supplier_name) {
      const id = await findSupplierMatch(s.supplier_name)
      if (id) setSupplierId(id)
    }
  }

  return (
    <>
      <div
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-md surface-elevated border-l border-edge flex flex-col transition-transform duration-200 ease-in-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ borderRadius: 0 }}
      >
        <div className="h-14 border-b border-edge/60 flex items-center justify-between px-5 shrink-0">
          <h2 className="font-semibold text-heading">Nuevo gasto</h2>
          <button
            type="button"
            onClick={closePanel}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
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
                operatorId={operatorId}
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
              operatorId={operatorId}
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
              {attachment && (
                <ExpenseScanCard
                  attachment={attachment}
                  supabaseClient={supabase}
                  onApply={handleApplySuggestion}
                />
              )}
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
            onClick={closePanel}
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
          active={visible}
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
