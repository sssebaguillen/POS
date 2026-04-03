'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import type { PriceList } from '@/components/price-lists/types'
import type { InventoryBrand } from '@/components/stock/types'

function FieldGroup({ label, required, error, hint, children }: {
  label: React.ReactNode
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label className="text-label text-subtle">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-caption text-emerald-600 dark:text-emerald-400 font-medium">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-caption text-red-500">{error}</p>}
    </div>
  )
}

interface Category {
  id: string
  name: string
  icon: string
}

interface NewProduct {
  id: string
  name: string
  price: number
  cost: number
  stock: number
  min_stock: number
  is_active: boolean
  category_id: string | null
  sku: string | null
  brand_id?: string | null
  brand?: { id: string; name: string } | null
  barcode: string | null
  categories?: { name: string; icon: string } | null
}

interface Props {
  open: boolean
  onClose: () => void
  businessId: string | null
  priceLists: PriceList[]
  categories: Category[]
  brands: InventoryBrand[]
  onCreated: (product: NewProduct) => void
}

const EMPTY_FORM = {
  name: '',
  sku: '',
  brand_id: '',
  barcode: '',
  category_id: '',
  price: '',
  cost: '',
  stock: '',
  min_stock: '',
  is_active: true,
}

export default function NewProductModal({ open, onClose, businessId, priceLists, categories, brands, onCreated }: Props) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPriceEdited, setIsPriceEdited] = useState(false)
  const [brandInput, setBrandInput] = useState('')
  const [showBrandOptions, setShowBrandOptions] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  const defaultPriceList = priceLists.find(pl => pl.is_default) ?? null

  const defaultSelectedIds = (): Set<string> =>
    new Set(defaultPriceList ? [defaultPriceList.id] : [])

  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(defaultSelectedIds)

  const filteredBrands = useMemo(() => {
    const query = brandInput.trim().toLowerCase()
    if (!query) return brands
    return brands.filter(brand => brand.name.toLowerCase().includes(query))
  }, [brands, brandInput])

  const suggestedPrice = (() => {
    if (!defaultPriceList) return null
    const parsedCost = Number(form.cost)
    if (!Number.isFinite(parsedCost) || parsedCost <= 0) return null
    return parsedCost * defaultPriceList.multiplier
  })()

  function set(field: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: '' }))
  }

  function handleCostChange(value: string) {
    setErrors(prev => ({ ...prev, cost: '' }))

    if (!defaultPriceList) {
      setForm(prev => ({ ...prev, cost: value }))
      return
    }

    const parsedCost = Number(value)
    if (!value.trim() || !Number.isFinite(parsedCost) || parsedCost <= 0) {
      setForm(prev => ({ ...prev, cost: value, price: '' }))
      setIsPriceEdited(false)
      setSelectedListIds(defaultSelectedIds())
      return
    }

    const nextSuggestedPrice = (parsedCost * defaultPriceList.multiplier).toFixed(2)
    setForm(prev => ({ ...prev, cost: value, price: nextSuggestedPrice }))
    setIsPriceEdited(false)
    setSelectedListIds(defaultSelectedIds())
  }

  function handlePriceChange(value: string) {
    setErrors(prev => ({ ...prev, price: '' }))
    setForm(prev => ({ ...prev, price: value }))

    if (suggestedPrice === null) {
      setIsPriceEdited(false)
      setSelectedListIds(defaultSelectedIds())
      return
    }

    const parsedPrice = Number(value)
    if (!value.trim() || !Number.isFinite(parsedPrice)) {
      setIsPriceEdited(false)
      setSelectedListIds(defaultSelectedIds())
      return
    }

    const edited = Math.abs(parsedPrice - suggestedPrice) > 0.01
    setIsPriceEdited(edited)
    if (!edited) setSelectedListIds(defaultSelectedIds())
  }

  function validate() {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'El nombre es obligatorio'
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 0) e.price = 'Precio inválido'
    if (form.cost && (isNaN(Number(form.cost)) || Number(form.cost) < 0)) e.cost = 'Costo inválido'
    if (form.stock && (isNaN(Number(form.stock)) || Number(form.stock) < 0)) e.stock = 'Stock inválido'
    if (form.min_stock && (isNaN(Number(form.min_stock)) || Number(form.min_stock) < 0)) e.min_stock = 'Mínimo inválido'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    if (!businessId) {
      setErrors({ _global: 'No se encontró el negocio activo.' })
      return
    }

    setLoading(true)
    const payload = {
      business_id: businessId,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      brand_id: form.brand_id || null,
      barcode: form.barcode.trim() || null,
      category_id: form.category_id || null,
      price: Number(form.price),
      cost: Number(form.cost) || 0,
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      is_active: form.is_active,
    }

    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select('id, name, price, cost, stock, min_stock, is_active, category_id, sku, brand_id, brands(id, name), barcode, categories(name, icon)')
      .single()

    setLoading(false)
    if (error || !data) {
      setErrors({ _global: error?.message ?? 'Error al crear el producto' })
      return
    }

    if (isPriceEdited && payload.cost > 0 && selectedListIds.size > 0) {
      const multiplier = payload.price / payload.cost
      void (async () => {
        const { error: overrideError } = await supabase
          .from('price_list_overrides')
          .insert(
            [...selectedListIds].map(listId => ({
              price_list_id: listId,
              product_id: data.id,
              brand_id: null,
              multiplier,
            }))
          )
        if (overrideError) {
          console.error('Failed to create price list overrides for new product:', overrideError.message)
        }
      })()
    }

    const created: NewProduct = {
      ...data,
      price: Number(data.price),
      cost: Number(data.cost),
      brand: Array.isArray(data.brands)
        ? (data.brands[0] ?? null)
        : (data.brands ?? null),
      categories: Array.isArray(data.categories)
        ? (data.categories[0] ?? null)
        : (data.categories ?? null),
    }

    onCreated(created)
    setForm(EMPTY_FORM)
    setBrandInput('')
    setShowBrandOptions(false)
    setErrors({})
    setIsPriceEdited(false)
    setSelectedListIds(defaultSelectedIds())
    onClose()
    setIsPriceEdited(false)
    onClose()
  }

  function handleClose() {
    setForm(EMPTY_FORM)
    setBrandInput('')
    setShowBrandOptions(false)
    setErrors({})
    setIsPriceEdited(false)
    setSelectedListIds(defaultSelectedIds())
    onClose()
  }

  const margin = form.price && form.cost && Number(form.price) > 0
    ? Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100)
    : null

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        {/* Header */}
        <div className="modal-header px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Nuevo producto</h2>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 gap-3.5">

              {errors._global && (
                <p className="col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{errors._global}</p>
              )}

              {/* Nombre */}
              <div className="col-span-2">
                <FieldGroup label="Nombre" required error={errors.name}>
                  <Input
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Ej: Pan sin TACC x500g"
                    className={`h-9 rounded-xl text-sm bg-surface ${errors.name ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                    autoFocus
                  />
                </FieldGroup>
              </div>

              {/* Categoría */}
              <FieldGroup label="Categoría">
                <SelectDropdown
                  value={form.category_id}
                  onChange={value => set('category_id', value)}
                  options={[
                    { value: '', label: 'Sin categoría' },
                    ...categories.map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })),
                  ]}
                />
              </FieldGroup>

              {/* Estado */}
              <div className="flex items-end">
                <label className="w-full flex items-center justify-between cursor-pointer select-none rounded-xl border border-edge bg-surface px-3 py-2.5">
                  <span className="text-xs font-semibold text-subtle uppercase tracking-wide">Activo</span>
                  <button
                    type="button"
                    onClick={() => set('is_active', !form.is_active)}
                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${form.is_active ? 'bg-primary' : 'bg-muted-foreground'}`}
                    aria-label="Cambiar estado activo"
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                  </button>
                </label>
              </div>

              <FieldGroup
                label={
                  <span className="inline-flex items-center gap-1.5">
                    Precio venta
                    {isPriceEdited && (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-amber-600 dark:text-amber-400">
                        personalizado
                      </span>
                    )}
                  </span>
                }
                required
                error={errors.price}
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={e => handlePriceChange(e.target.value)}
                    placeholder="0"
                    className={`h-9 rounded-xl text-sm pl-7 bg-surface ${errors.price ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                  />
                </div>
              </FieldGroup>
              <FieldGroup label="Costo" error={errors.cost} hint={margin !== null ? `${margin}% margen` : undefined}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={e => handleCostChange(e.target.value)}
                    placeholder="0"
                    className={`h-9 rounded-xl text-sm pl-7 bg-surface ${errors.cost ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                  />
                </div>
              </FieldGroup>

              {isPriceEdited && priceLists.length > 0 && (
                <div className="col-span-2 rounded-xl border border-edge bg-surface-alt px-3 py-2.5 flex flex-col gap-2">
                  <p className="text-xs text-subtle">Aplicar este precio como override en:</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {priceLists.map(list => (
                      <label key={list.id} className="flex items-center gap-2 cursor-pointer select-none">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={selectedListIds.has(list.id)}
                          onClick={() => setSelectedListIds(prev => {
                            const next = new Set(prev)
                            if (next.has(list.id)) next.delete(list.id)
                            else next.add(list.id)
                            return next
                          })}
                          className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                            selectedListIds.has(list.id)
                              ? 'bg-primary border-primary'
                              : 'border-edge bg-surface'
                          }`}
                        >
                          {selectedListIds.has(list.id) && (
                            <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-none stroke-white stroke-[2]"><path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          )}
                        </button>
                        <span className="text-xs text-body">
                          {list.name}
                          {list.is_default && <span className="ml-1 text-hint">(default)</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <FieldGroup label="Stock inicial" error={errors.stock}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={e => set('stock', e.target.value)}
                  placeholder="0"
                  className={`h-9 rounded-xl text-sm bg-surface ${errors.stock ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                />
              </FieldGroup>
              <FieldGroup label="Stock mínimo" error={errors.min_stock}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.min_stock}
                  onChange={e => set('min_stock', e.target.value)}
                  placeholder="0"
                  className={`h-9 rounded-xl text-sm bg-surface ${errors.min_stock ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                />
              </FieldGroup>

              <FieldGroup label="SKU">
                <Input
                  value={form.sku}
                  onChange={e => set('sku', e.target.value)}
                  placeholder="Ej: PSTACC-500"
                  className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                />
              </FieldGroup>
              <FieldGroup label="Marca">
                <div className="relative">
                  <Input
                    value={brandInput}
                    onFocus={() => setShowBrandOptions(true)}
                    onBlur={() => {
                      setTimeout(() => {
                        setShowBrandOptions(false)
                        if (!form.brand_id) {
                          setBrandInput('')
                        }
                      }, 120)
                    }}
                    onChange={event => {
                      const nextValue = event.target.value
                      setBrandInput(nextValue)
                      setShowBrandOptions(true)

                      const exactBrand = brands.find(brand => brand.name.toLowerCase() === nextValue.trim().toLowerCase())
                      set('brand_id', exactBrand ? exactBrand.id : '')
                    }}
                    placeholder="Seleccionar marca"
                    className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                  />

                  {showBrandOptions && (
                    <div className="absolute z-20 mt-1 w-full overflow-y-auto max-h-52 surface-elevated">
                      {filteredBrands.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-hint">
                          No se encontró la marca. Creala desde el botón Marcas.
                        </div>
                      ) : (
                        filteredBrands.map(brand => (
                          <button
                            key={brand.id}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-body hover:bg-hover-bg transition-colors"
                            onMouseDown={event => {
                              event.preventDefault()
                              set('brand_id', brand.id)
                              setBrandInput(brand.name)
                              setShowBrandOptions(false)
                            }}
                          >
                            {brand.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </FieldGroup>
              <FieldGroup label="Código de barras">
                <Input
                  value={form.barcode}
                  onChange={e => set('barcode', e.target.value)}
                  placeholder="Ej: 7790001234567"
                  className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                />
              </FieldGroup>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-edge-soft bg-surface-alt/80 px-6 py-3.5 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="cancel"
              onClick={handleClose}
              disabled={loading}
              className="h-9 px-5 rounded-xl text-sm"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="h-9 px-5 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {loading ? 'Guardando…' : 'Crear producto'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
