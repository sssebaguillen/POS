'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronRight, Upload, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import type { PriceList } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import { validateImageUrl } from '@/lib/validation'
import FieldGroup from '@/components/inventory/FieldGroup'
import { useCurrency } from '@/lib/context/CurrencyContext'
import { getCurrencySymbol } from '@/lib/format'

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
  image_url?: string | null
  image_source?: 'upload' | 'url' | null
  categories?: { name: string; icon: string } | null
}

interface Props {
  /** When true, renders only the form (no Dialog). Used by onboarding wizard. */
  embedded?: boolean
  open?: boolean
  onClose: () => void
  businessId: string | null
  priceLists: PriceList[]
  categories: Category[]
  brands: InventoryBrand[]
  onCreated: (product: NewProduct) => void
  /** Called after a successful create (in addition to onCreated). */
  onSuccess?: (product: NewProduct) => void
  /** Pre-fill the product name field. */
  initialName?: string
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

export default function NewProductModal({
  embedded = false,
  open = false,
  onClose,
  businessId,
  priceLists,
  categories,
  brands,
  onCreated,
  onSuccess,
  initialName,
}: Props) {
  const [form, setForm] = useState(() => initialName ? { ...EMPTY_FORM, name: initialName } : EMPTY_FORM)

  useEffect(() => {
    if (open && initialName) {
      setForm(prev => ({ ...prev, name: initialName }))
    }
  }, [open, initialName])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPriceEdited, setIsPriceEdited] = useState(false)
  const [brandInput, setBrandInput] = useState('')
  const [showBrandOptions, setShowBrandOptions] = useState(false)
  const [categoryInput, setCategoryInput] = useState('')
  const [showCategoryOptions, setShowCategoryOptions] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageSource, setImageSource] = useState<'upload' | 'url' | null>(null)
  const [imageTab, setImageTab] = useState<'upload' | 'url'>('upload')
  const [externalUrlInput, setExternalUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')
  const [imageUploading, setImageUploading] = useState(false)
  const [imgError, setImgError] = useState(false)
  const supabase = useMemo(() => createClient(), [])
  const currency = useCurrency()
  const currencySymbol = getCurrencySymbol(currency)

  const defaultPriceList = priceLists.find(pl => pl.is_default) ?? null

  const defaultSelectedIds = (): Set<string> =>
    new Set(defaultPriceList ? [defaultPriceList.id] : [])

  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(defaultSelectedIds)

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

  const suggestedPrice = (() => {
    if (!defaultPriceList) return null
    const parsedCost = Number(form.cost)
    if (!Number.isFinite(parsedCost) || parsedCost <= 0) return null
    return parsedCost * defaultPriceList.multiplier
  })()

  function resetFormState() {
    setForm(EMPTY_FORM)
    setBrandInput('')
    setShowBrandOptions(false)
    setCategoryInput('')
    setShowCategoryOptions(false)
    setErrors({})
    setIsPriceEdited(false)
    setSelectedListIds(defaultSelectedIds())
    setImageUrl(null)
    setImageSource(null)
    setImageTab('upload')
    setExternalUrlInput('')
    setUrlError('')
    setShowAdvanced(false)
  }

  function set(field: string, value: string | boolean) {
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
      setIsPriceEdited(true)
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
      image_url: imageUrl,
      image_source: imageSource,
    }

    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select('id, name, price, cost, stock, min_stock, is_active, category_id, sku, brand_id, brands(id, name), barcode, image_url, image_source, categories(name, icon)')
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
      image_url: data.image_url ?? null,
      image_source: (data.image_source as 'upload' | 'url' | null) ?? null,
      categories: Array.isArray(data.categories)
        ? (data.categories[0] ?? null)
        : (data.categories ?? null),
    }

    onCreated(created)
    onSuccess?.(created)
    resetFormState()
    if (!embedded) {
      onClose()
    }
  }

  function handleClose() {
    resetFormState()
    onClose()
  }

  const margin = form.price && form.cost && Number(form.price) > 0
    ? Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100)
    : null

  if (!embedded && !open) {
    return null
  }

  const formInner = (
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-4">
            {errors._global && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive mb-3.5">{errors._global}</p>
            )}

            <div className="space-y-3.5">

              {/* Información */}
              <div>
                <p className="mb-2 text-[10px] font-semibold text-subtle uppercase tracking-widest">Información</p>
                <div className="grid grid-cols-2 gap-3.5">
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
                          set('category_id', exactCategory ? exactCategory.id : '')
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
                              set('category_id', '')
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
                                set('category_id', category.id)
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
                </div>
              </div>

              <div className="border-t border-edge my-1" />

              {/* Precios */}
              <div>
                <p className="mb-2 text-[10px] font-semibold text-subtle uppercase tracking-widest">Precios</p>
                <div className="grid grid-cols-2 gap-3.5">
                  <FieldGroup
                    label="Costo"
                    error={errors.cost}
                    hint={margin !== null ? `Margen: ${margin}% · Ganancia por unidad: ${currencySymbol}${(Number(form.price) - Number(form.cost)).toFixed(2)}` : undefined}
                  >
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">{currencySymbol}</span>
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
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">{currencySymbol}</span>
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

                  {isPriceEdited && priceLists.length > 0 && (
                    <div className="col-span-2 rounded-xl border border-edge bg-surface-alt px-3 py-2.5 flex flex-col gap-2">
                      <p className="text-xs text-subtle">Aplicar este precio personalizado en:</p>
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
                                <svg viewBox="0 0 10 8" className="w-2.5 h-2 fill-none stroke-primary-foreground stroke-[2]"><path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
                      onChange={e => set('sku', e.target.value)}
                      placeholder="Ej: PSTACC-500"
                      className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                    />
                  </FieldGroup>

                  <FieldGroup label="Código de barras">
                    <Input
                      value={form.barcode}
                      onChange={e => set('barcode', e.target.value)}
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
              onClick={() => set('is_active', !form.is_active)}
              className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${form.is_active ? 'bg-primary' : 'bg-muted-foreground'}`}
              aria-label="Cambiar estado activo"
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-xs text-subtle mr-auto">{form.is_active ? 'Producto activo' : 'Producto inactivo'}</span>
            {!embedded && (
              <Button
                type="button"
                variant="cancel"
                onClick={handleClose}
                disabled={loading}
                className="h-9 px-5 rounded-xl text-sm"
              >
                Cancelar
              </Button>
            )}
            <Button
              type="submit"
              disabled={loading}
              className="h-9 px-5 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {loading ? 'Guardando…' : 'Crear producto'}
            </Button>
          </div>
        </form>
  )

  if (embedded) {
    return (
      <div className="max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-edge bg-surface">
        {formInner}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-heading">Nuevo producto</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {formInner}
      </DialogContent>
    </Dialog>
  )
}
