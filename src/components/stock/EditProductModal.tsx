'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceList, PriceListOverride } from '@/components/price-lists/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct } from '@/components/stock/types'

interface EditProductModalProps {
  open: boolean
  onClose: () => void
  product: InventoryProduct
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  defaultPriceList?: PriceList | null
  existingOverride?: PriceListOverride | null
  onSaved: (updated: Partial<InventoryProduct>) => void
}

function FieldGroup({
  label,
  badge,
  required,
  error,
  children,
}: {
  label: string
  badge?: React.ReactNode
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-semibold text-subtle uppercase tracking-wide">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {badge}
      </div>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}

interface FormState {
  name: string
  price: string
  cost: string
  stock: string
  min_stock: string
  sku: string
  brand_id: string
  barcode: string
  category_id: string
  show_in_catalog: boolean
}

function toFormState(product: InventoryProduct): FormState {
  return {
    name: product.name,
    price: String(product.price),
    cost: String(product.cost),
    stock: String(product.stock),
    min_stock: String(product.min_stock),
    sku: product.sku ?? '',
    brand_id: product.brand_id ?? '',
    barcode: product.barcode ?? '',
    category_id: product.category_id ?? '',
    show_in_catalog: product.show_in_catalog ?? true,
  }
}

export default function EditProductModal({
  open,
  onClose,
  product,
  categories,
  brands,
  defaultPriceList = null,
  existingOverride = null,
  onSaved,
}: EditProductModalProps) {
  const [form, setForm] = useState<FormState>(() => toFormState(product))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPriceEdited, setIsPriceEdited] = useState<boolean>(() => existingOverride !== null)
  const [brandInput, setBrandInput] = useState(product.brand?.name ?? '')
  const [showBrandOptions, setShowBrandOptions] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const suggestedPrice = useMemo(() => {
    const cost = Number(form.cost)
    if (!defaultPriceList || !Number.isFinite(cost) || cost <= 0) return null
    return cost * defaultPriceList.multiplier
  }, [form.cost, defaultPriceList])

  const filteredBrands = useMemo(() => {
    const query = brandInput.trim().toLowerCase()
    if (!query) return brands
    return brands.filter(brand => brand.name.toLowerCase().includes(query))
  }, [brands, brandInput])

  const margin = useMemo(() => {
    const price = Number(form.price)
    const cost = Number(form.cost)
    if (!Number.isFinite(price) || !Number.isFinite(cost) || price <= 0) return null
    return Math.round(((price - cost) / price) * 100)
  }, [form.price, form.cost])

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: '' }))
  }

  function handlePriceChange(value: string) {
    setForm(prev => ({ ...prev, price: value }))
    setErrors(prev => ({ ...prev, price: '' }))

    if (suggestedPrice === null) {
      setIsPriceEdited(false)
      return
    }

    const parsedPrice = Number(value)
    if (!value.trim() || !Number.isFinite(parsedPrice)) {
      setIsPriceEdited(false)
      return
    }

    setIsPriceEdited(Math.abs(parsedPrice - suggestedPrice) > 0.01)
  }

  function handleCostChange(value: string) {
    setErrors(prev => ({ ...prev, cost: '' }))

    const parsedCost = Number(value)
    const shouldApplySuggested =
      defaultPriceList !== null &&
      Number.isFinite(parsedCost) &&
      parsedCost > 0 &&
      !isPriceEdited

    if (shouldApplySuggested) {
      setForm(prev => ({
        ...prev,
        cost: value,
        price: (parsedCost * defaultPriceList.multiplier).toFixed(2),
      }))
      return
    }

    setForm(prev => ({ ...prev, cost: value }))
  }

  function validate() {
    const nextErrors: Record<string, string> = {}

    if (!form.name.trim()) {
      nextErrors.name = 'El nombre es obligatorio'
    }

    const parsedPrice = Number(form.price)
    if (!form.price || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      nextErrors.price = 'Precio inválido'
    }

    if (form.cost) {
      const parsedCost = Number(form.cost)
      if (!Number.isFinite(parsedCost) || parsedCost < 0) {
        nextErrors.cost = 'Costo inválido'
      }
    }

    const parsedStock = Number(form.stock)
    if (!form.stock || !Number.isFinite(parsedStock) || parsedStock < 0) {
      nextErrors.stock = 'Stock inválido'
    }

    if (form.min_stock) {
      const parsedMinStock = Number(form.min_stock)
      if (!Number.isFinite(parsedMinStock) || parsedMinStock < 0) {
        nextErrors.min_stock = 'Stock mínimo inválido'
      }
    }

    return nextErrors
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    onSaved({
      name: form.name.trim(),
      price: Number(form.price),
      cost: Number(form.cost) || 0,
      stock: Math.trunc(Number(form.stock) || 0),
      min_stock: Math.trunc(Number(form.min_stock) || 0),
      sku: form.sku.trim() || null,
      brand_id: form.brand_id || null,
      barcode: form.barcode.trim() || null,
      category_id: form.category_id || null,
      show_in_catalog: form.show_in_catalog,
    })

    // best-effort override upsert/delete
    void (async () => {
      const parsedCost = Number(form.cost)
      const parsedPrice = Number(form.price)

      if (!defaultPriceList || parsedCost <= 0 || !Number.isFinite(parsedPrice)) return

      if (isPriceEdited && Math.abs(parsedPrice - (parsedCost * defaultPriceList.multiplier)) > 0.01) {
        const { error } = await supabase
          .from('price_list_overrides')
          .upsert(
            {
              price_list_id: defaultPriceList.id,
              product_id: product.id,
              brand_id: null,
              multiplier: parsedPrice / parsedCost,
            },
            { onConflict: 'price_list_id,product_id' }
          )

        if (error) {
          console.error('Failed to upsert product override from edit modal:', error.message)
        }
      } else if (!isPriceEdited && existingOverride) {
        const { error } = await supabase
          .from('price_list_overrides')
          .delete()
          .eq('id', existingOverride.id)

        if (error) {
          console.error('Failed to delete product override from edit modal:', error.message)
        }
      }
    })()
  }

  function handleClose() {
    setForm(toFormState(product))
    setBrandInput(product.brand?.name ?? '')
    setShowBrandOptions(false)
    setErrors({})
    setIsPriceEdited(existingOverride !== null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="bg-primary px-6 py-3.5 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Editar producto</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            aria-label="Cerrar modal"
          >
            <span className="text-white text-sm">X</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-4">
            <div className="grid grid-cols-2 gap-3.5">
              <div className="col-span-2">
                <FieldGroup label="Nombre" required error={errors.name}>
                  <Input
                    value={form.name}
                    onChange={event => setField('name', event.target.value)}
                    placeholder="Ej: Pan sin TACC x500g"
                    className={`h-9 rounded-xl text-sm bg-surface ${errors.name ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                    autoFocus
                  />
                </FieldGroup>
              </div>

              <FieldGroup label="Categoría">
                <SelectDropdown
                  value={form.category_id}
                  onChange={value => setField('category_id', value)}
                  options={[
                    { value: '', label: 'Sin categoría' },
                    ...categories.map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })),
                  ]}
                />
              </FieldGroup>

              <FieldGroup label="SKU">
                <Input
                  value={form.sku}
                  onChange={event => setField('sku', event.target.value)}
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
                      setField('brand_id', exactBrand ? exactBrand.id : '')
                    }}
                    placeholder="Seleccionar marca"
                    className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                  />

                  {showBrandOptions && (
                    <div className="absolute z-20 mt-1 w-full overflow-y-auto max-h-52 glass-popover">
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
                              setField('brand_id', brand.id)
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
                  onChange={event => setField('barcode', event.target.value)}
                  placeholder="Ej: 7790001234567"
                  className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                />
              </FieldGroup>

              <FieldGroup
                label="Precio"
                badge={isPriceEdited && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200">
                    personalizado
                  </span>
                )}
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
                    onChange={event => handlePriceChange(event.target.value)}
                    placeholder="0"
                    className={`h-9 rounded-xl text-sm pl-7 bg-surface ${errors.price ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                  />
                </div>
              </FieldGroup>

              <FieldGroup label="Costo" error={errors.cost}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={event => handleCostChange(event.target.value)}
                    placeholder="0"
                    className={`h-9 rounded-xl text-sm pl-7 bg-surface ${errors.cost ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                  />
                </div>
                {margin !== null && <p className="text-[11px] text-emerald-600 font-medium">{margin}% margen</p>}
              </FieldGroup>

              <FieldGroup label="Stock actual" required error={errors.stock}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={event => setField('stock', event.target.value)}
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
                  onChange={event => setField('min_stock', event.target.value)}
                  placeholder="0"
                  className={`h-9 rounded-xl text-sm bg-surface ${errors.min_stock ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                />
              </FieldGroup>

              <div className="col-span-2">
                <label className="w-full flex items-center justify-between cursor-pointer select-none rounded-xl border border-edge bg-surface px-3 py-2.5">
                  <span className="text-xs font-semibold text-subtle uppercase tracking-wide">Mostrar en catálogo</span>
                  <button
                    type="button"
                    onClick={() => setField('show_in_catalog', !form.show_in_catalog)}
                    className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${form.show_in_catalog ? 'bg-primary' : 'bg-muted-foreground'}`}
                    aria-label="Cambiar visibilidad en catálogo"
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${form.show_in_catalog ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                  </button>
                </label>
              </div>
            </div>
          </div>

          <div className="border-t border-edge-soft bg-surface-alt/80 px-6 py-3.5 flex items-center justify-end gap-2.5">
            <Button type="button" variant="cancel" onClick={handleClose} className="h-9 px-5 rounded-xl text-sm">
              Cancelar
            </Button>
            <Button type="submit" className="h-9 px-5 rounded-xl text-sm bg-primary hover:bg-primary/90 text-primary-foreground">
              Guardar cambios
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}