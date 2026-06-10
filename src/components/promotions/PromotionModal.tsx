'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import SelectDropdown from '@/components/ui/SelectDropdown'
import { isPromotionLive, type Promotion, type PromotionKind } from '@/lib/promotions'
import { coveredProductIds, describePromotion, type NamedRef, type PromoProductRef } from '@/components/promotions/types'
import { translateDbError, ERR } from '@/lib/errors'

// Tipo visible en la UI — los dos de cantidad mapean al kind 'quantity' (N/K/P)
type UiKind = 'percent' | 'offer_price' | 'nxm' | 'second_unit'

const UI_KIND_OPTIONS: { value: UiKind; title: string; hint: string }[] = [
  { value: 'percent', title: 'Porcentaje', hint: 'Ej: 20% de descuento' },
  { value: 'offer_price', title: 'Precio de oferta', hint: 'Ej: $800 (antes $1.000)' },
  { value: 'nxm', title: 'Lleva X, paga Y', hint: 'Ej: 2x1, 3x2' },
  { value: 'second_unit', title: '2da unidad al X%', hint: 'Ej: 2da unidad al 50%' },
]

type ScopeType = 'product' | 'category' | 'brand'

interface FormState {
  name: string
  uiKind: UiKind
  percent: string
  offerPrice: string
  takeQty: string
  payQty: string
  secondUnitPct: string
  scopeType: ScopeType
  productId: string | null
  categoryId: string | null
  brandId: string | null
  startsAt: string
  endsAt: string
  showInCatalog: boolean
}

function toLocalDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function emptyForm(): FormState {
  return {
    name: '',
    uiKind: 'percent',
    percent: '',
    offerPrice: '',
    takeQty: '2',
    payQty: '1',
    secondUnitPct: '50',
    scopeType: 'product',
    productId: null,
    categoryId: null,
    brandId: null,
    startsAt: '',
    endsAt: '',
    showInCatalog: true,
  }
}

function formFromPromotion(promo: Promotion): FormState {
  const uiKind: UiKind =
    promo.kind === 'quantity'
      ? ((promo.pay_percent ?? 0) > 0 && promo.group_size === 2 && promo.affected_units === 1 ? 'second_unit' : 'nxm')
      : promo.kind
  return {
    name: promo.name,
    uiKind,
    percent: promo.percent != null ? String(promo.percent) : '',
    offerPrice: promo.offer_price != null ? String(promo.offer_price) : '',
    takeQty: promo.group_size != null ? String(promo.group_size) : '2',
    payQty: promo.group_size != null && promo.affected_units != null ? String(promo.group_size - promo.affected_units) : '1',
    secondUnitPct: promo.pay_percent != null && promo.pay_percent > 0 ? String(promo.pay_percent) : '50',
    scopeType: promo.product_id ? 'product' : promo.category_id ? 'category' : 'brand',
    productId: promo.product_id,
    categoryId: promo.category_id,
    brandId: promo.brand_id,
    startsAt: toLocalDateInput(promo.starts_at),
    endsAt: toLocalDateInput(promo.ends_at),
    showInCatalog: promo.show_in_catalog,
  }
}

interface Props {
  open: boolean
  onClose: () => void
  businessId: string
  operatorId: string | null
  products: PromoProductRef[]
  categories: NamedRef[]
  brands: NamedRef[]
  existingPromotions: Promotion[]
  /** null = crear, Promotion = editar */
  initial: Promotion | null
  onSaved: () => void
}

export default function PromotionModal({
  open,
  onClose,
  businessId,
  operatorId,
  products,
  categories,
  brands,
  existingPromotions,
  initial,
  onSaved,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [form, setForm] = useState<FormState>(emptyForm())
  const [productQuery, setProductQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(initial ? formFromPromotion(initial) : emptyForm())
      setProductQuery('')
      setError(null)
    }
  }, [open, initial])

  const requiresProductScope = form.uiKind === 'offer_price' || form.uiKind === 'nxm' || form.uiKind === 'second_unit'
  const effectiveScopeType: ScopeType = requiresProductScope ? 'product' : form.scopeType

  // Precio de oferta no aplica a productos con variantes (un precio fijo sobre N variantes es ambiguo)
  const selectableProducts = useMemo(
    () => (form.uiKind === 'offer_price' ? products.filter(p => !p.has_variants) : products),
    [products, form.uiKind]
  )

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) return []
    return selectableProducts.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [selectableProducts, productQuery])

  const selectedProduct = form.productId ? products.find(p => p.id === form.productId) ?? null : null

  // Mapeo UI → kind/params de la RPC
  const rpcValues = useMemo(() => {
    if (form.uiKind === 'percent') {
      return { kind: 'percent' as PromotionKind, percent: parseFloat(form.percent) || 0, offerPrice: null as number | null, groupSize: null as number | null, affectedUnits: null as number | null, payPercent: null as number | null }
    }
    if (form.uiKind === 'offer_price') {
      return { kind: 'offer_price' as PromotionKind, percent: null, offerPrice: parseFloat(form.offerPrice) || 0, groupSize: null, affectedUnits: null, payPercent: null }
    }
    if (form.uiKind === 'second_unit') {
      return { kind: 'quantity' as PromotionKind, percent: null, offerPrice: null, groupSize: 2, affectedUnits: 1, payPercent: parseFloat(form.secondUnitPct) || 0 }
    }
    const take = parseInt(form.takeQty, 10) || 0
    const pay = parseInt(form.payQty, 10) || 0
    return { kind: 'quantity' as PromotionKind, percent: null, offerPrice: null, groupSize: take, affectedUnits: take - pay, payPercent: 0 }
  }, [form])

  const previewText = useMemo(() => {
    const target =
      effectiveScopeType === 'product'
        ? selectedProduct?.name
        : effectiveScopeType === 'category'
          ? categories.find(c => c.id === form.categoryId)?.name
          : brands.find(b => b.id === form.brandId)?.name
    if (!target) return null
    if (form.uiKind === 'percent') {
      const pct = parseFloat(form.percent)
      return pct > 0 ? `${pct}% de descuento en ${target}` : null
    }
    if (form.uiKind === 'offer_price') {
      const price = parseFloat(form.offerPrice)
      return price > 0 ? `${target} a precio de oferta` : null
    }
    if (form.uiKind === 'second_unit') {
      const pct = parseFloat(form.secondUnitPct)
      return pct >= 0 && pct < 100 ? `${target}: la 2da unidad paga el ${pct}% del precio` : null
    }
    const take = parseInt(form.takeQty, 10)
    const pay = parseInt(form.payQty, 10)
    if (take >= 2 && pay >= 1 && pay < take) {
      const free = take - pay
      return `${target}: cada ${take} unidades, ${free} ${free === 1 ? 'va' : 'van'} gratis (${take}x${pay})`
    }
    return null
  }, [form, effectiveScopeType, selectedProduct, categories, brands])

  // Aviso de solapamiento: promos vigentes cuyo alcance comparte productos con esta
  const overlapping = useMemo(() => {
    const scope = {
      product_id: effectiveScopeType === 'product' ? form.productId : null,
      category_id: effectiveScopeType === 'category' ? form.categoryId : null,
      brand_id: effectiveScopeType === 'brand' ? form.brandId : null,
    }
    if (!scope.product_id && !scope.category_id && !scope.brand_id) return []
    const newCovered = coveredProductIds(scope, products)
    if (newCovered.size === 0 && scope.product_id === null) return []
    return existingPromotions.filter(promo => {
      if (initial && promo.id === initial.id) return false
      if (!isPromotionLive(promo)) return false
      const covered = coveredProductIds(promo, products)
      if (scope.product_id) {
        // Producto puntual: matchea si la otra promo lo cubre directa o indirectamente
        const target = products.find(p => p.id === scope.product_id)
        return (
          covered.has(scope.product_id) ||
          (target !== null && target !== undefined && (
            (promo.category_id !== null && promo.category_id === target.category_id) ||
            (promo.brand_id !== null && promo.brand_id === target.brand_id)
          ))
        )
      }
      for (const id of newCovered) {
        if (covered.has(id)) return true
      }
      return false
    })
  }, [effectiveScopeType, form.productId, form.categoryId, form.brandId, existingPromotions, products, initial])

  const isValid = useMemo(() => {
    if (!form.name.trim()) return false
    if (effectiveScopeType === 'product' && !form.productId) return false
    if (effectiveScopeType === 'category' && !form.categoryId) return false
    if (effectiveScopeType === 'brand' && !form.brandId) return false
    if (form.uiKind === 'percent') {
      const pct = parseFloat(form.percent)
      if (!(pct > 0 && pct <= 100)) return false
    }
    if (form.uiKind === 'offer_price' && !(parseFloat(form.offerPrice) > 0)) return false
    if (form.uiKind === 'nxm') {
      const take = parseInt(form.takeQty, 10)
      const pay = parseInt(form.payQty, 10)
      if (!(take >= 2 && take <= 100 && pay >= 1 && pay < take)) return false
    }
    if (form.uiKind === 'second_unit') {
      const pct = parseFloat(form.secondUnitPct)
      if (!(pct >= 0 && pct < 100)) return false
    }
    if (form.startsAt && form.endsAt && form.endsAt <= form.startsAt) return false
    return true
  }, [form, effectiveScopeType])

  async function handleSave() {
    if (!isValid || saving) return
    if (!operatorId) {
      setError(ERR.INV2)
      return
    }
    setSaving(true)
    setError(null)

    const params = {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_name: form.name.trim(),
      p_kind: rpcValues.kind,
      p_percent: rpcValues.percent,
      p_offer_price: rpcValues.offerPrice,
      p_group_size: rpcValues.groupSize,
      p_affected_units: rpcValues.affectedUnits,
      p_pay_percent: rpcValues.payPercent,
      p_product_id: effectiveScopeType === 'product' ? form.productId : null,
      p_category_id: effectiveScopeType === 'category' ? form.categoryId : null,
      p_brand_id: effectiveScopeType === 'brand' ? form.brandId : null,
      p_starts_at: form.startsAt ? new Date(`${form.startsAt}T00:00:00`).toISOString() : null,
      p_ends_at: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
      p_show_in_catalog: form.showInCatalog,
    }

    const { data, error: rpcError } = initial
      ? await supabase.rpc('update_promotion', { ...params, p_promotion_id: initial.id, p_is_active: initial.is_active })
      : await supabase.rpc('create_promotion', params)

    setSaving(false)
    const result = data as { success?: boolean; error?: string } | null
    if (rpcError || !result?.success) {
      setError(translateDbError(rpcError?.message ?? result?.error ?? '', 'No se pudo guardar la promoción'))
      return
    }
    onSaved()
    onClose()
  }

  const inputCls = 'w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-heading placeholder:text-hint focus:outline-none focus:border-primary'

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg p-0 gap-0 max-h-[90dvh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge/60 shrink-0">
          <DialogTitle className="text-base font-semibold text-heading">
            {initial ? 'Editar promoción' : 'Nueva promoción'}
          </DialogTitle>
          <button onClick={onClose} className="text-hint hover:text-body transition-colors" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Nombre */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-subtle">Nombre</label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Oferta de la semana"
              className="h-9 text-sm"
            />
          </div>

          {/* Tipo */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-subtle">Tipo de promo</label>
            <div className="grid grid-cols-2 gap-2">
              {UI_KIND_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, uiKind: opt.value }))}
                  className={`text-left rounded-xl border p-2.5 transition-[transform,border-color,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] ${
                    form.uiKind === opt.value
                      ? 'border-primary bg-primary/10'
                      : 'border-edge hover:border-primary/40 hover:bg-primary/5'
                  }`}
                >
                  <p className={`text-xs font-semibold ${form.uiKind === opt.value ? 'text-[var(--primary-active-text)]' : 'text-heading'}`}>{opt.title}</p>
                  <p className="text-[10px] text-hint mt-0.5">{opt.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Valor según tipo */}
          {form.uiKind === 'percent' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-subtle">Porcentaje de descuento</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={100} step="any"
                  value={form.percent}
                  onChange={e => setForm(f => ({ ...f, percent: e.target.value }))}
                  placeholder="20"
                  className={`${inputCls} w-24 tabular-nums`}
                />
                <span className="text-sm text-hint">%</span>
              </div>
            </div>
          )}
          {form.uiKind === 'offer_price' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-subtle">Precio de oferta</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-hint">$</span>
                <input
                  type="number" min={0} step="any"
                  value={form.offerPrice}
                  onChange={e => setForm(f => ({ ...f, offerPrice: e.target.value }))}
                  placeholder="800"
                  className={`${inputCls} w-32 tabular-nums`}
                />
              </div>
              <p className="text-[11px] text-hint">Solo para productos sin variantes. Si el producto tiene variantes, usa porcentaje.</p>
            </div>
          )}
          {form.uiKind === 'nxm' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-subtle">Cantidades</label>
              <div className="flex items-center gap-2 text-sm text-body">
                <span>Lleva</span>
                <input
                  type="number" min={2} max={100} step={1}
                  value={form.takeQty}
                  onChange={e => setForm(f => ({ ...f, takeQty: e.target.value }))}
                  className={`${inputCls} w-16 text-center tabular-nums`}
                />
                <span>paga</span>
                <input
                  type="number" min={1} step={1}
                  value={form.payQty}
                  onChange={e => setForm(f => ({ ...f, payQty: e.target.value }))}
                  className={`${inputCls} w-16 text-center tabular-nums`}
                />
              </div>
            </div>
          )}
          {form.uiKind === 'second_unit' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-subtle">La 2da unidad paga el…</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={99} step="any"
                  value={form.secondUnitPct}
                  onChange={e => setForm(f => ({ ...f, secondUnitPct: e.target.value }))}
                  className={`${inputCls} w-24 tabular-nums`}
                />
                <span className="text-sm text-hint">% del precio</span>
              </div>
            </div>
          )}

          {/* Alcance */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-subtle">Alcance</label>
            {requiresProductScope ? (
              <p className="text-[11px] text-hint -mt-0.5">Este tipo de promo aplica a un producto específico.</p>
            ) : (
              <div className="flex gap-1.5">
                {([['product', 'Producto'], ['category', 'Categoría'], ['brand', 'Marca']] as [ScopeType, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, scopeType: value }))}
                    className={`pill-tab ${form.scopeType === value ? 'bg-primary/10 text-primary border border-primary/20' : ''}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {effectiveScopeType === 'product' && (
              selectedProduct ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <p className="text-sm font-medium text-heading truncate">{selectedProduct.name}</p>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, productId: null }))}
                    className="text-hint hover:text-red-500 transition-colors shrink-0"
                    aria-label="Quitar producto"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
                  <input
                    type="text"
                    value={productQuery}
                    onChange={e => setProductQuery(e.target.value)}
                    placeholder="Buscar producto..."
                    className={`${inputCls} pl-8`}
                  />
                  {filteredProducts.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full divide-y divide-edge-soft rounded-lg border border-edge bg-surface shadow-md overflow-hidden">
                      {filteredProducts.map(p => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => { setForm(f => ({ ...f, productId: p.id })); setProductQuery('') }}
                            className="w-full text-left px-3 py-1.5 text-sm text-body hover:bg-hover-bg transition-colors"
                          >
                            {p.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            )}
            {effectiveScopeType === 'category' && (
              <SelectDropdown
                value={form.categoryId ?? ''}
                onChange={v => setForm(f => ({ ...f, categoryId: v || null }))}
                options={categories.map(c => ({ value: c.id, label: c.name }))}
                placeholder="Elegir categoría..."
                usePortal
              />
            )}
            {effectiveScopeType === 'brand' && (
              <SelectDropdown
                value={form.brandId ?? ''}
                onChange={v => setForm(f => ({ ...f, brandId: v || null }))}
                options={brands.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Elegir marca..."
                usePortal
              />
            )}
          </div>

          {/* Vigencia */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-subtle">Vigencia (opcional)</label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <span className="text-[10px] text-hint uppercase tracking-wide">Desde</span>
                <input
                  type="date"
                  value={form.startsAt}
                  onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-hint uppercase tracking-wide">Hasta</span>
                <input
                  type="date"
                  value={form.endsAt}
                  onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <p className="text-[11px] text-hint">Sin fechas, la promo queda vigente hasta que la pauses o archives.</p>
          </div>

          {/* Catálogo */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.showInCatalog}
              onChange={e => setForm(f => ({ ...f, showInCatalog: e.target.checked }))}
              className="accent-[var(--primary)]"
            />
            <span className="text-sm text-body">Destacar en la sección Ofertas del catálogo online</span>
          </label>

          {/* Preview */}
          {previewText && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
              <p className="text-xs text-[var(--primary-active-text)] font-medium">{previewText}</p>
            </div>
          )}

          {/* Solapamiento */}
          {overlapping.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-3 py-2 space-y-1">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={13} />
                Se superpone con {overlapping.length === 1 ? 'otra promo vigente' : `${overlapping.length} promos vigentes`}
              </p>
              <ul className="text-[11px] text-amber-700/90 dark:text-amber-400/90 space-y-0.5">
                {overlapping.slice(0, 4).map(p => (
                  <li key={p.id}>· {p.name} — {describePromotion(p)}</li>
                ))}
                {overlapping.length > 4 && <li>· y {overlapping.length - 4} más…</li>}
              </ul>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80">
                Cada producto aplica una sola promo: gana la más específica y, a igual alcance, la más reciente.
              </p>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="grid grid-cols-2 gap-2 px-5 py-4 border-t border-edge/60 shrink-0">
          <Button variant="cancel" className="h-9 rounded-lg text-sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="h-9 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={!isValid || saving}
            onClick={handleSave}
          >
            {saving ? 'Guardando…' : initial ? 'Guardar cambios' : 'Crear promoción'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
