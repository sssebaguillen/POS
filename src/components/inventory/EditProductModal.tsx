'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronRight, Upload, X } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct } from '@/components/inventory/types'
import { validateImageUrl } from '@/lib/validation'
import FieldGroup from '@/components/inventory/FieldGroup'

interface EditProductModalProps {
  open: boolean
  onClose: () => void
  product: InventoryProduct
  businessId: string | null
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  priceLists: PriceList[]
  existingOverrides: PriceListOverride[]
  onSaved: (updated: Partial<InventoryProduct>, nextOverrides: PriceListOverride[]) => void
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
  businessId,
  categories,
  brands,
  priceLists,
  existingOverrides,
  onSaved,
}: EditProductModalProps) {
  const defaultPriceList = priceLists.find(pl => pl.is_default) ?? null

  const [form, setForm] = useState<FormState>(() => toFormState(product))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isPriceEdited, setIsPriceEdited] = useState<boolean>(() => existingOverrides.length > 0)
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(
    () => new Set(existingOverrides.map(o => o.price_list_id))
  )
  const [brandInput, setBrandInput] = useState(product.brand?.name ?? '')
  const [showBrandOptions, setShowBrandOptions] = useState(false)
  const [categoryInput, setCategoryInput] = useState(() => {
    const matchedCategory = categories.find(category => category.id === (product.category_id ?? ''))
    return matchedCategory?.name ?? product.categories?.name ?? ''
  })
  const [showCategoryOptions, setShowCategoryOptions] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(product.image_url ?? null)
  const [imageSource, setImageSource] = useState<'upload' | 'url' | null>(
    (product.image_source as 'upload' | 'url' | null) ?? null
  )
  const [imageTab, setImageTab] = useState<'upload' | 'url'>(
    product.image_source === 'url' ? 'url' : 'upload'
  )
  const [externalUrlInput, setExternalUrlInput] = useState(
    product.image_source === 'url' ? (product.image_url ?? '') : ''
  )
  const [urlError, setUrlError] = useState('')
  const [imageUploading, setImageUploading] = useState(false)
  const [imgError, setImgError] = useState(false)

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

  const filteredCategories = useMemo(() => {
    const query = categoryInput.trim().toLowerCase()
    if (!query) return categories
    return categories.filter(category => category.name.toLowerCase().includes(query))
  }, [categories, categoryInput])

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

  async function handleFileUpload(file: File) {
    if (!businessId) return
    setImageUploading(true)
    setErrors(prev => ({ ...prev, image: '' }))
    const ext = file.name.split('.').pop() ?? 'jpg'
    const filename = `${businessId}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filename, file, { upsert: true })
    if (uploadError) {
      setErrors(prev => ({ ...prev, image: `Error al subir imagen: ${uploadError.message}` }))
      setImageUploading(false)
      return
    }
    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(filename)
    setImageUrl(urlData.publicUrl)
    setImageSource('upload')
    setImageUploading(false)
  }

  function handlePriceChange(value: string) {
    setForm(prev => ({ ...prev, price: value }))
    setErrors(prev => ({ ...prev, price: '' }))

    if (suggestedPrice === null) {
      setIsPriceEdited(true)
      setSelectedListIds(new Set(existingOverrides.map(o => o.price_list_id)))
      return
    }

    const parsedPrice = Number(value)
    if (!value.trim() || !Number.isFinite(parsedPrice)) {
      setIsPriceEdited(false)
      setSelectedListIds(new Set(existingOverrides.map(o => o.price_list_id)))
      return
    }

    const edited = Math.abs(parsedPrice - suggestedPrice) > 0.01
    setIsPriceEdited(edited)
    if (!edited) setSelectedListIds(new Set(existingOverrides.map(o => o.price_list_id)))
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const validationErrors = validate()
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const parsedCost = Number(form.cost)
    const parsedPrice = Number(form.price)

    setIsSaving(true)

    let nextOverrides: PriceListOverride[] = []

    if (parsedCost > 0 && Number.isFinite(parsedPrice)) {
      const multiplier = parsedPrice / parsedCost

      if (isPriceEdited) {
        const upsertResults = await Promise.all(
          [...selectedListIds].map(listId =>
            supabase
              .from('price_list_overrides')
              .upsert(
                { price_list_id: listId, product_id: product.id, brand_id: null, multiplier },
                { onConflict: 'price_list_id,product_id' }
              )
              .select('id, price_list_id, product_id, brand_id, multiplier')
              .single()
          )
        )

        const deleteTargets = existingOverrides.filter(o => !selectedListIds.has(o.price_list_id))
        if (deleteTargets.length > 0) {
          await Promise.all(
            deleteTargets.map(o =>
              supabase.from('price_list_overrides').delete().eq('id', o.id)
            )
          )
        }

        nextOverrides = upsertResults
          .filter(r => !r.error && r.data)
          .map(r => ({
            id: r.data!.id,
            price_list_id: r.data!.price_list_id,
            product_id: r.data!.product_id,
            brand_id: r.data!.brand_id,
            multiplier: Number(r.data!.multiplier),
          }))

        for (const r of upsertResults) {
          if (r.error) console.error('Failed to upsert price list override:', r.error.message)
        }
      } else {
        if (existingOverrides.length > 0) {
          await Promise.all(
            existingOverrides.map(o =>
              supabase.from('price_list_overrides').delete().eq('id', o.id)
            )
          )
        }
        nextOverrides = []
      }
    } else {
      nextOverrides = existingOverrides
    }

    setIsSaving(false)

    onSaved(
      {
        name: form.name.trim(),
        price: parsedPrice,
        cost: parsedCost || 0,
        stock: Math.trunc(Number(form.stock) || 0),
        min_stock: Math.trunc(Number(form.min_stock) || 0),
        sku: form.sku.trim() || null,
        brand_id: form.brand_id || null,
        barcode: form.barcode.trim() || null,
        category_id: form.category_id || null,
        show_in_catalog: form.show_in_catalog,
        image_url: imageUrl,
        image_source: imageSource,
      },
      nextOverrides
    )
  }

  function handleClose() {
    const matchedCategory = categories.find(category => category.id === (product.category_id ?? ''))
    setForm(toFormState(product))
    setBrandInput(product.brand?.name ?? '')
    setShowBrandOptions(false)
    setCategoryInput(matchedCategory?.name ?? product.categories?.name ?? '')
    setShowCategoryOptions(false)
    setErrors({})
    setIsPriceEdited(existingOverrides.length > 0)
    setSelectedListIds(new Set(existingOverrides.map(o => o.price_list_id)))
    setImageUrl(product.image_url ?? null)
    setImageSource((product.image_source as 'upload' | 'url' | null) ?? null)
    setImageTab(product.image_source === 'url' ? 'url' : 'upload')
    setExternalUrlInput(product.image_source === 'url' ? (product.image_url ?? '') : '')
    setUrlError('')
    setImageUploading(false)
    setImgError(false)
    setShowAdvanced(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="modal-header px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Editar producto</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-4">
            <div className="space-y-3.5">

              {/* Información */}
              <div>
                <p className="mb-2 text-[10px] font-semibold text-subtle uppercase tracking-widest">Información</p>
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

                  {/* Categoría */}
                  <FieldGroup label="Categoría">
                    <div className="relative">
                      <Input
                        value={categoryInput}
                        onFocus={() => setShowCategoryOptions(true)}
                        onBlur={() => {
                          setTimeout(() => {
                            setShowCategoryOptions(false)
                            if (!form.category_id) setCategoryInput('')
                          }, 120)
                        }}
                        onChange={event => {
                          const nextValue = event.target.value
                          setCategoryInput(nextValue)
                          setShowCategoryOptions(true)
                          const exactCategory = categories.find(category => category.name.toLowerCase() === nextValue.trim().toLowerCase())
                          setField('category_id', exactCategory ? exactCategory.id : '')
                        }}
                        placeholder="Seleccionar categoría"
                        className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                      />
                      {showCategoryOptions && (
                        <div className="absolute z-20 mt-1 w-full overflow-y-auto max-h-52 surface-elevated">
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm text-body hover:bg-hover-bg transition-colors"
                            onMouseDown={event => {
                              event.preventDefault()
                              setField('category_id', '')
                              setCategoryInput('')
                              setShowCategoryOptions(false)
                            }}
                          >
                            Sin categoría
                          </button>
                          {filteredCategories.map(category => (
                            <button
                              key={category.id}
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm text-body hover:bg-hover-bg transition-colors"
                              onMouseDown={event => {
                                event.preventDefault()
                                setField('category_id', category.id)
                                setCategoryInput(category.name)
                                setShowCategoryOptions(false)
                              }}
                            >
                              {category.icon} {category.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </FieldGroup>

                  {/* Marca */}
                  <FieldGroup label="Marca">
                    <div className="relative">
                      <Input
                        value={brandInput}
                        onFocus={() => setShowBrandOptions(true)}
                        onBlur={() => {
                          setTimeout(() => {
                            setShowBrandOptions(false)
                            if (!form.brand_id) setBrandInput('')
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
                </div>
              </div>

              <div className="border-t border-edge my-1" />

              {/* Precios */}
              <div>
                <p className="mb-2 text-[10px] font-semibold text-subtle uppercase tracking-widest">Precios</p>
                <div className="grid grid-cols-2 gap-3.5">
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
                    {margin !== null && (
                      <p className="text-caption text-emerald-600 dark:text-emerald-400 font-medium">
                        Margen: {margin}% · Ganancia por unidad: ${(Number(form.price) - Number(form.cost)).toFixed(2)}
                      </p>
                    )}
                  </FieldGroup>

                  <FieldGroup
                    label="Precio"
                    badge={isPriceEdited && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-600 dark:text-amber-400 border border-amber-200">
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
                </div>
              </div>

              <div className="border-t border-edge my-1" />

              {/* Stock */}
              <div>
                <p className="mb-2 text-[10px] font-semibold text-subtle uppercase tracking-widest">Stock</p>
                <div className="grid grid-cols-2 gap-3.5">
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
                </div>
              </div>

              {/* Collapsable — Imagen y detalles adicionales */}
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-edge bg-surface hover:bg-hover-bg transition-colors text-left"
              >
                <ChevronRight className={`w-3.5 h-3.5 text-hint transition-transform shrink-0 ${showAdvanced ? 'rotate-90' : ''}`} />
                <span className="text-xs font-medium text-subtle">Imagen y detalles adicionales</span>
                <span className="text-xs text-hint ml-1">· SKU, código de barras, foto</span>
              </button>

              {showAdvanced && (
                <div className="grid grid-cols-2 gap-3.5">
                  <FieldGroup label="SKU">
                    <Input
                      value={form.sku}
                      onChange={event => setField('sku', event.target.value)}
                      placeholder="Ej: PSTACC-500"
                      className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                    />
                  </FieldGroup>

                  <FieldGroup label="Código de barras">
                    <Input
                      value={form.barcode}
                      onChange={event => setField('barcode', event.target.value)}
                      placeholder="Ej: 7790001234567"
                      className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                    />
                  </FieldGroup>

                  <div className="col-span-2">
                    <p className="text-label text-subtle mb-2">Imagen del producto</p>
                    {imageUrl && imageSource === 'upload' ? (
                      <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface px-3 py-3">
                        <img
                          src={imageUrl}
                          alt="Vista previa"
                          className="h-20 w-20 rounded-lg object-cover border border-edge shrink-0"
                        />
                        <div className="flex flex-col gap-1.5 pt-1 min-w-0">
                          <p className="text-xs text-hint">Imagen subida</p>
                          <button
                            type="button"
                            onClick={() => {
                              setImageUrl(null)
                              setImageSource(null)
                            }}
                            className="text-xs text-red-500 hover:text-red-600 text-left"
                          >
                            Quitar imagen
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-edge overflow-hidden">
                        <div className="flex border-b border-edge">
                          <button
                            type="button"
                            onClick={() => setImageTab('upload')}
                            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                              imageTab === 'upload'
                                ? 'bg-surface text-body border-b-2 border-primary'
                                : 'bg-surface-alt text-hint hover:text-subtle'
                            }`}
                          >
                            Subir archivo
                          </button>
                          <button
                            type="button"
                            onClick={() => setImageTab('url')}
                            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                              imageTab === 'url'
                                ? 'bg-surface text-body border-b-2 border-primary'
                                : 'bg-surface-alt text-hint hover:text-subtle'
                            }`}
                          >
                            URL externa
                          </button>
                        </div>
                        <div className="p-3">
                          {imageTab === 'upload' && (
                            <label className="flex flex-col items-center gap-2 cursor-pointer rounded-xl border border-dashed border-edge bg-surface px-4 py-5 hover:border-primary/40 transition-colors">
                              <Upload className="h-5 w-5 text-hint" />
                              <span className="text-xs text-hint">
                                {imageUploading ? 'Subiendo...' : 'Arrastrá o hacé clic para seleccionar'}
                              </span>
                              <span className="text-[10px] text-hint">PNG, JPG, WebP · máx. 2 MB</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                disabled={imageUploading}
                                onChange={e => {
                                  const file = e.target.files?.[0]
                                  if (file) void handleFileUpload(file)
                                }}
                              />
                            </label>
                          )}
                          {imageTab === 'upload' && errors.image && (
                            <p className="text-caption text-red-500 mt-1">{errors.image}</p>
                          )}
                          {imageTab === 'url' && (
                            <div className="flex flex-col gap-2">
                              <div className="flex gap-2">
                                <Input
                                  value={externalUrlInput}
                                  onChange={e => {
                                    setExternalUrlInput(e.target.value)
                                    setUrlError('')
                                    if (imageSource === 'url') {
                                      setImageUrl(null)
                                      setImageSource(null)
                                    }
                                  }}
                                  placeholder="https://..."
                                  className={`h-9 rounded-xl text-sm bg-surface ${urlError ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-ring/50 focus-visible:border-ring'}`}
                                />
                                <Button
                                  type="button"
                                  onClick={() => {
                                    const error = validateImageUrl(externalUrlInput)
                                    setUrlError(error)
                                    if (!error && externalUrlInput) {
                                      setImgError(false)
                                      setImageUrl(externalUrlInput)
                                      setImageSource('url')
                                    }
                                  }}
                                  className="h-9 px-4 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                                >
                                  Confirmar
                                </Button>
                              </div>
                              {urlError && <p className="text-caption text-red-500">{urlError}</p>}
                              {imageUrl && imageSource === 'url' && (
                                <div className="flex items-start gap-3">
                                  {imgError ? (
                                    <div className="h-20 w-20 rounded-lg border-2 border-red-400 bg-red-50 shrink-0 flex items-center justify-center p-1">
                                      <p className="text-[10px] text-red-500 text-center leading-tight">No se pudo cargar. Verificá que la URL sea pública y directa.</p>
                                    </div>
                                  ) : (
                                    <img
                                      src={imageUrl}
                                      alt="Vista previa"
                                      className="h-20 w-20 rounded-lg object-cover border border-edge shrink-0"
                                      onLoad={() => setImgError(false)}
                                      onError={() => setImgError(true)}
                                    />
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setImageUrl(null)
                                      setImageSource(null)
                                      setExternalUrlInput('')
                                      setUrlError('')
                                      setImgError(false)
                                    }}
                                    className="text-xs text-red-500 hover:text-red-600 mt-1"
                                  >
                                    Quitar imagen
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-edge px-5 py-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setField('show_in_catalog', !form.show_in_catalog)}
              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${form.show_in_catalog ? 'bg-primary' : 'bg-muted-foreground'}`}
              aria-label="Cambiar visibilidad en catálogo"
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${form.show_in_catalog ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-xs text-subtle mr-auto">{form.show_in_catalog ? 'Visible en catálogo' : 'Oculto en catálogo'}</span>
            <Button type="button" variant="cancel" onClick={handleClose} disabled={isSaving} className="h-9 px-5 rounded-xl text-sm">
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving} className="h-9 px-5 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground">
              {isSaving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
