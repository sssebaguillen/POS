'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronRight, Upload, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PriceList } from '@/lib/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct } from '@/components/inventory/types'
import { validateImageUrl } from '@/lib/validation'
import { translateDbError } from '@/lib/errors'
import FieldGroup from '@/components/inventory/FieldGroup'
import VariantEditor from '@/components/inventory/VariantEditor'
import type { VariantPayloadNew, VariantPayloadEdit } from '@/components/inventory/VariantEditor'
import { useCurrency } from '@/lib/context/CurrencyContext'
import { getCurrencySymbol, toTitleCase } from '@/lib/format'
import CategoryIconPreview from '@/components/inventory/CategoryIconPreview'
import PriceOverrideIndicator from '@/components/inventory/PriceOverrideIndicator'
import FloatingDropdown from '@/components/ui/FloatingDropdown'
import { trackProductCreated } from '@/lib/analytics'

interface Props {
  /** When true, renders only the form (no Dialog). Used by onboarding wizard. */
  embedded?: boolean
  open?: boolean
  onClose: () => void
  businessId: string | null
  operatorId: string | null
  priceLists: PriceList[]
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  onCreated: (product: InventoryProduct) => void
  /** Called after a successful create (in addition to onCreated). */
  onSuccess?: (product: InventoryProduct) => void
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
  operatorId,
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
      startTransition(() => {
        setForm(prev => ({ ...prev, name: initialName }))
      })
    }
  }, [open, initialName])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPriceEdited, setIsPriceEdited] = useState(false)
  const [hasVariants, setHasVariants] = useState(false)
  const [variantPayload, setVariantPayload] = useState<VariantPayloadNew | null>(null)
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
  const categoryAnchorRef = useRef<HTMLDivElement>(null)
  const brandAnchorRef = useRef<HTMLDivElement>(null)
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

  // Combobox keyboard nav: highlightedIndex covers [Sin categoría, ...filteredCategories] for the
  // category dropdown and [...filteredBrands] for the brand dropdown. -1 means nothing highlighted.
  const [categoryHighlight, setCategoryHighlight] = useState(-1)
  const [brandHighlight, setBrandHighlight] = useState(-1)

  function selectCategoryByIndex(index: number) {
    // index 0 = "Sin categoría", 1+ = filteredCategories[index - 1]
    if (index === 0) {
      set('category_id', '')
      setCategoryInput('')
    } else {
      const category = filteredCategories[index - 1]
      if (!category) return
      set('category_id', category.id)
      setCategoryInput(category.name)
    }
    setShowCategoryOptions(false)
    setCategoryHighlight(-1)
  }

  function closeCategoryOptions() {
    setShowCategoryOptions(false)
    setCategoryHighlight(-1)
    if (!form.category_id) setCategoryInput('')
  }

  function selectBrandByIndex(index: number) {
    const brand = filteredBrands[index]
    if (!brand) return
    set('brand_id', brand.id)
    setBrandInput(brand.name)
    setShowBrandOptions(false)
    setBrandHighlight(-1)
  }

  function closeBrandOptions() {
    setShowBrandOptions(false)
    setBrandHighlight(-1)
    if (!form.brand_id) setBrandInput('')
  }

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
    setHasVariants(false)
    setVariantPayload(null)
  }

  const handleVariantPayloadChange = useCallback((payload: VariantPayloadNew | VariantPayloadEdit | null) => {
    setVariantPayload(payload as VariantPayloadNew | null)
  }, [])

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
      setErrors(prev => ({ ...prev, image: translateDbError(uploadError.message, 'No se pudo subir la imagen. Intenta con otra foto.') }))
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

    if (!hasVariants) {
      if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 0) e.price = 'Precio inválido'
      if (form.cost && (isNaN(Number(form.cost)) || Number(form.cost) < 0)) e.cost = 'Costo inválido'
      if (form.stock && (isNaN(Number(form.stock)) || Number(form.stock) < 0)) e.stock = 'Stock inválido'
      if (form.min_stock && (isNaN(Number(form.min_stock)) || Number(form.min_stock) < 0)) e.min_stock = 'Mínimo inválido'
    } else {
      if (!variantPayload || variantPayload.options.length === 0) {
        e._global = 'Define al menos un atributo con valores para las variantes'
      } else {
        const activeVariants = variantPayload.variants.filter(v => v.is_active)
        if (activeVariants.length === 0) {
          e._global = 'La tabla de variantes debe tener al menos una variante activa'
        } else if (!activeVariants.every(v => v.price > 0)) {
          e._global = 'Cada variante activa debe tener un precio de venta mayor a 0'
        }
      }
    }

    return e
  }

  async function handleSubmit() {
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    if (!businessId) {
      setErrors({ _global: 'No se encontró el negocio activo.' })
      return
    }

    if (!form.name.trim()) {
      setErrors({ name: 'El nombre es obligatorio' })
      return
    }

    setLoading(true)

    if (hasVariants && variantPayload) {
      const productPayload = {
        name: toTitleCase(form.name.trim()),
        sku: null,
        brand_id: form.brand_id || null,
        barcode: null,
        category_id: form.category_id || null,
        price: 0,
        cost: 0,
        min_stock: 0,
        is_active: form.is_active,
        image_url: imageUrl ?? null,
        image_source: imageSource ?? null,
      }

      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_product_with_variants', {
        p_product: productPayload,
        p_options: variantPayload.options,
        p_variants: variantPayload.variants,
      })

      const result = rpcResult as { success: boolean; product_id?: string; error?: string } | null

      if (rpcError || !result?.success) {
        setLoading(false)
        setErrors({ _global: result?.error ?? translateDbError(rpcError?.message ?? '', 'No se pudo crear el producto con variantes. Revisa los datos e inténtalo de nuevo.') })
        return
      }

      setLoading(false)

      // Fetch the created product for the onCreated callback
      const { data: newProduct } = await supabase
        .from('products')
        .select('id, name, price, cost, stock, min_stock, is_active, category_id, sku, brand_id, brands(id, name), barcode, image_url, image_source, has_variants, default_variant_id, categories(name, icon)')
        .eq('id', result.product_id!)
        .single()

      if (newProduct) {
        let displayPrice = Number(newProduct.price)
        let displayCost = Number(newProduct.cost)
        let displayStock = Number(newProduct.stock)
        let displayImageUrl = newProduct.image_url ?? null
        let displayImageSource = (newProduct.image_source as 'upload' | 'url' | null) ?? null

        if (newProduct.default_variant_id) {
          const { data: variantData } = await supabase
            .from('product_variants')
            .select('price, cost, stock, image_url, image_source')
            .eq('id', newProduct.default_variant_id)
            .single()

          if (variantData) {
            displayPrice = Number(variantData.price)
            displayCost = Number(variantData.cost)
            displayStock = Number(variantData.stock)
            displayImageUrl = variantData.image_url ?? displayImageUrl
            displayImageSource = (variantData.image_source as 'upload' | 'url' | null) ?? displayImageSource
          }
        }

        const created: InventoryProduct = {
          ...newProduct,
          price: displayPrice,
          cost: displayCost,
          stock: displayStock,
          default_variant_id: newProduct.default_variant_id ?? null,
          brand: Array.isArray(newProduct.brands)
            ? (newProduct.brands[0] ?? null)
            : (newProduct.brands ?? null),
          image_url: displayImageUrl,
          image_source: displayImageSource,
          categories: Array.isArray(newProduct.categories)
            ? (newProduct.categories[0] ?? null)
            : (newProduct.categories ?? null),
          has_variants: true,
        }
        trackProductCreated({ has_variants: true })
        onCreated(created)
        onSuccess?.(created)
      }

      resetFormState()
      if (!embedded) onClose()
      return
    }

    const priceNum = Number(form.price)
    const costNum = Number(form.cost) || 0

    const productData: Record<string, unknown> = {
      name: toTitleCase(form.name.trim()),
      sku: form.sku.trim() || null,
      brand_id: form.brand_id || null,
      barcode: form.barcode.trim() || null,
      category_id: form.category_id || null,
      price: priceNum,
      cost: costNum,
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      is_active: form.is_active,
      image_url: imageUrl,
      image_source: imageSource,
    }

    if (isPriceEdited && costNum > 0 && selectedListIds.size > 0) {
      const multiplier = priceNum / costNum
      productData.price_list_overrides = [...selectedListIds].map(listId => ({
        price_list_id: listId,
        multiplier,
      }))
    }

    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_product', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_data: productData,
    })

    const result = rpcResult as { success: boolean; id?: string; error?: string } | null

    if (rpcError || !result?.success || !result.id) {
      setLoading(false)
      setErrors({ _global: result?.error ?? translateDbError(rpcError?.message ?? '', 'No se pudo crear el producto. Revisa los datos e inténtalo de nuevo.') })
      return
    }

    const { data, error: fetchError } = await supabase
      .from('products')
      .select('id, name, price, cost, stock, min_stock, is_active, category_id, sku, brand_id, brands(id, name), barcode, image_url, image_source, has_variants, categories(name, icon)')
      .eq('id', result.id)
      .single()

    setLoading(false)

    if (fetchError || !data) {
      setErrors({ _global: translateDbError(fetchError?.message ?? '', 'El producto se creó, pero no se pudo mostrar todavía. Recarga la página.') })
      return
    }

    const created: InventoryProduct = {
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

    trackProductCreated({ has_variants: false })
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

  const formInnerClassName = embedded
    ? 'flex max-h-[min(70dvh,560px)] flex-col'
    : 'flex min-h-0 flex-1 flex-col'

  const formInner = (
        <div className={formInnerClassName}>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {errors._global && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive mb-3.5">{errors._global}</p>
            )}

            <div className="space-y-3.5">

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <FieldGroup label="Nombre" required error={errors.name}>
                  <Input
                    value={form.name}
                    onChange={e => set('name', e.target.value)}
                    placeholder="Ej: Pan sin TACC x500g"
                    aria-invalid={!!errors.name}
                    autoFocus
                  />
                </FieldGroup>

                <FieldGroup label="Variantes">
                  <div className="flex items-center justify-between gap-3 h-8 rounded-lg border border-input bg-card px-2.5">
                    <span className="text-sm text-body truncate">
                      {hasVariants ? 'Este producto tiene variantes' : 'Producto único, sin variantes'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hasVariants}
                      onClick={() => setHasVariants(!hasVariants)}
                      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${hasVariants ? 'bg-primary' : 'bg-input'}`}
                      aria-label="Activar variantes"
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${hasVariants ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </FieldGroup>

                {/* Categoría */}
                  <FieldGroup label="Categoría">
                    <div ref={categoryAnchorRef} className="relative">
                      <Input
                        value={categoryInput}
                        role="combobox"
                        aria-expanded={showCategoryOptions}
                        aria-controls="category-listbox"
                        aria-autocomplete="list"
                        aria-activedescendant={showCategoryOptions && categoryHighlight >= 0 ? `category-option-${categoryHighlight}` : undefined}
                        onFocus={() => {
                          setShowCategoryOptions(true)
                          setCategoryHighlight(0)
                        }}
                        onChange={event => {
                          const nextValue = event.target.value
                          setCategoryInput(nextValue)
                          setShowCategoryOptions(true)
                          setCategoryHighlight(0)
                          const exactCategory = categories.find(category => category.name.toLowerCase() === nextValue.trim().toLowerCase())
                          set('category_id', exactCategory ? exactCategory.id : '')
                        }}
                        onKeyDown={event => {
                          const max = filteredCategories.length // index of last (Sin categoría at 0, items at 1..max)
                          if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            setShowCategoryOptions(true)
                            setCategoryHighlight(prev => Math.min(prev + 1, max))
                          } else if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            setCategoryHighlight(prev => Math.max(prev - 1, 0))
                          } else if (event.key === 'Enter' && showCategoryOptions) {
                            event.preventDefault()
                            selectCategoryByIndex(categoryHighlight)
                          } else if (event.key === 'Escape' && showCategoryOptions) {
                            event.preventDefault()
                            closeCategoryOptions()
                          }
                        }}
                        placeholder="Seleccionar categoría"
                        className="pr-8"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={showCategoryOptions ? 'Cerrar categorías' : 'Abrir categorías'}
                        onMouseDown={event => {
                          event.preventDefault()
                          setShowCategoryOptions(prev => {
                            const nextOpen = !prev
                            setCategoryHighlight(nextOpen ? 0 : -1)
                            if (!nextOpen && !form.category_id) setCategoryInput('')
                            return nextOpen
                          })
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-hint hover:text-body transition-colors"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showCategoryOptions ? 'rotate-180' : ''}`} />
                      </button>
                      <FloatingDropdown
                        anchorRef={categoryAnchorRef}
                        open={showCategoryOptions}
                        className="max-h-52"
                        onClose={closeCategoryOptions}
                      >
                        <div
                          id="category-listbox"
                          role="listbox"
                          onMouseDown={e => e.preventDefault()}
                        >
                          <button
                            type="button"
                            role="option"
                            id="category-option-0"
                            aria-selected={categoryHighlight === 0}
                            className={`w-full px-3 py-2 text-left text-sm transition-colors ${categoryHighlight === 0 ? 'bg-surface-alt text-body' : 'text-body hover:bg-hover-bg'}`}
                            onMouseEnter={() => setCategoryHighlight(0)}
                            onMouseDown={event => {
                              event.preventDefault()
                              selectCategoryByIndex(0)
                            }}
                          >
                            Sin categoría
                          </button>
                          {filteredCategories.map((category, idx) => {
                            const index = idx + 1
                            const isHighlighted = categoryHighlight === index
                            return (
                              <button
                                key={category.id}
                                type="button"
                                role="option"
                                id={`category-option-${index}`}
                                aria-selected={isHighlighted}
                                className={`w-full px-3 py-2 text-left text-sm transition-colors ${isHighlighted ? 'bg-surface-alt text-body' : 'text-body hover:bg-hover-bg'}`}
                                onMouseEnter={() => setCategoryHighlight(index)}
                                onMouseDown={event => {
                                  event.preventDefault()
                                  selectCategoryByIndex(index)
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <CategoryIconPreview icon={category.icon} color={category.icon_color ?? '#7a3e10'} size={16} />
                                  {category.name}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </FloatingDropdown>
                    </div>
                  </FieldGroup>

                  {/* Marca */}
                  <FieldGroup label="Marca">
                    <div ref={brandAnchorRef} className="relative">
                      <Input
                        value={brandInput}
                        role="combobox"
                        aria-expanded={showBrandOptions}
                        aria-controls="brand-listbox"
                        aria-autocomplete="list"
                        aria-activedescendant={showBrandOptions && brandHighlight >= 0 ? `brand-option-${brandHighlight}` : undefined}
                        onFocus={() => {
                          setShowBrandOptions(true)
                          setBrandHighlight(0)
                        }}
                        onChange={event => {
                          const nextValue = event.target.value
                          setBrandInput(nextValue)
                          setShowBrandOptions(true)
                          setBrandHighlight(0)
                          const exactBrand = brands.find(brand => brand.name.toLowerCase() === nextValue.trim().toLowerCase())
                          set('brand_id', exactBrand ? exactBrand.id : '')
                        }}
                        onKeyDown={event => {
                          const lastIndex = filteredBrands.length - 1
                          if (event.key === 'ArrowDown' && lastIndex >= 0) {
                            event.preventDefault()
                            setShowBrandOptions(true)
                            setBrandHighlight(prev => Math.min(prev + 1, lastIndex))
                          } else if (event.key === 'ArrowUp' && lastIndex >= 0) {
                            event.preventDefault()
                            setBrandHighlight(prev => Math.max(prev - 1, 0))
                          } else if (event.key === 'Enter' && showBrandOptions && lastIndex >= 0) {
                            event.preventDefault()
                            selectBrandByIndex(brandHighlight)
                          } else if (event.key === 'Escape' && showBrandOptions) {
                            event.preventDefault()
                            closeBrandOptions()
                          }
                        }}
                        placeholder="Seleccionar marca"
                        className="pr-8"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={showBrandOptions ? 'Cerrar marcas' : 'Abrir marcas'}
                        onMouseDown={event => {
                          event.preventDefault()
                          setShowBrandOptions(prev => {
                            const nextOpen = !prev
                            setBrandHighlight(nextOpen ? 0 : -1)
                            if (!nextOpen && !form.brand_id) setBrandInput('')
                            return nextOpen
                          })
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-hint hover:text-body transition-colors"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showBrandOptions ? 'rotate-180' : ''}`} />
                      </button>
                      <FloatingDropdown
                        anchorRef={brandAnchorRef}
                        open={showBrandOptions}
                        className="max-h-52"
                        onClose={closeBrandOptions}
                      >
                        <div
                          id="brand-listbox"
                          role="listbox"
                          onMouseDown={e => e.preventDefault()}
                        >
                          {filteredBrands.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-hint">
                              No se encontró la marca. Créala desde el botón Marcas.
                            </div>
                          ) : (
                            filteredBrands.map((brand, idx) => {
                              const isHighlighted = brandHighlight === idx
                              return (
                                <button
                                  key={brand.id}
                                  type="button"
                                  role="option"
                                  id={`brand-option-${idx}`}
                                  aria-selected={isHighlighted}
                                  className={`w-full px-3 py-2 text-left text-sm transition-colors ${isHighlighted ? 'bg-surface-alt text-body' : 'text-body hover:bg-hover-bg'}`}
                                  onMouseEnter={() => setBrandHighlight(idx)}
                                  onMouseDown={event => {
                                    event.preventDefault()
                                    selectBrandByIndex(idx)
                                  }}
                                >
                                  {brand.name}
                                </button>
                              )
                            })
                          )}
                        </div>
                      </FloatingDropdown>
                    </div>
                  </FieldGroup>
              </div>

              {/* Precios */}
              {!hasVariants && (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
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
                        aria-invalid={!!errors.cost}
                        className="pl-7"
                      />
                    </div>
                  </FieldGroup>

                  <FieldGroup
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        Precio venta
                        {isPriceEdited && priceLists.length > 0 && (
                          <PriceOverrideIndicator
                            selectedListIds={selectedListIds}
                            priceLists={priceLists}
                            onChange={setSelectedListIds}
                          />
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
                        aria-invalid={!!errors.price}
                        className="pl-7"
                      />
                    </div>
                  </FieldGroup>

                </div>
              )}

              {/* Stock + Código de barras */}
              {!hasVariants && (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <FieldGroup label="Stock inicial" error={errors.stock}>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={form.stock}
                      onChange={e => set('stock', e.target.value)}
                      placeholder="0"
                      aria-invalid={!!errors.stock}
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
                      aria-invalid={!!errors.min_stock}
                    />
                  </FieldGroup>
                  <div className="sm:col-span-2">
                    <FieldGroup label="Código de barras">
                      <Input
                        value={form.barcode}
                        onChange={e => set('barcode', e.target.value)}
                        placeholder="Ej: 7790001234567"
                      />
                    </FieldGroup>
                  </div>
                </div>
              )}

              {/* Variant body — toggle lifted to row 1, so hide it here */}
              <VariantEditor
                businessId={businessId}
                mode="new"
                hasVariants={hasVariants}
                onHasVariantsChange={setHasVariants}
                onPayloadChange={handleVariantPayloadChange}
                hideToggle
              />

              {/* Collapsable — Imagen y detalles adicionales (toggle + content in one container) */}
              <div className="rounded-lg border border-edge bg-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-hover-bg transition-colors text-left"
                  aria-expanded={showAdvanced}
                >
                  <ChevronRight className={`w-3.5 h-3.5 text-hint transition-transform shrink-0 ${showAdvanced ? 'rotate-90' : ''}`} />
                  <span className="text-xs font-medium text-subtle">Imagen y detalles adicionales</span>
                  <span className="text-xs text-hint ml-1">
                    {hasVariants ? '· Foto del producto base' : '· SKU, foto'}
                  </span>
                </button>

                {showAdvanced && (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 border-t border-edge px-3 py-3">
                  {!hasVariants && (
                    <div className="sm:col-span-2">
                      <FieldGroup label="SKU">
                        <Input
                          value={form.sku}
                          onChange={e => set('sku', e.target.value)}
                          placeholder="Ej: PSTACC-500"
                        />
                      </FieldGroup>
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <p className="text-label text-subtle mb-2">Imagen del producto</p>
                    {imageUrl && imageSource === 'upload' ? (
                      <div className="flex items-start gap-3 rounded-lg border border-edge bg-surface px-3 py-3">
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
                            className="text-xs text-destructive hover:text-destructive/80 text-left"
                          >
                            Quitar imagen
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-edge overflow-hidden">
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
                            <label className="flex flex-col items-center gap-2 cursor-pointer rounded-lg border border-dashed border-edge bg-surface px-4 py-5 hover:border-primary/40 transition-colors">
                              <Upload className="h-5 w-5 text-hint" />
                              <span className="text-xs text-hint">
                                {imageUploading ? 'Subiendo...' : 'Arrastra o haz clic para seleccionar'}
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
                            <p className="text-caption text-destructive mt-1">{errors.image}</p>
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
                                  aria-invalid={!!urlError}
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
                                  className="shrink-0"
                                >
                                  Confirmar
                                </Button>
                              </div>
                              {urlError && <p className="text-caption text-destructive">{urlError}</p>}
                              {imageUrl && imageSource === 'url' && (
                                <div className="flex items-start gap-3">
                                  {imgError ? (
                                    <div className="h-20 w-20 rounded-lg border border-destructive/40 bg-destructive/10 shrink-0 flex items-center justify-center p-1">
                                      <p className="text-caption text-destructive text-center leading-tight">No se pudo cargar. Verifica que la URL sea pública y directa.</p>
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
                                    className="text-xs text-destructive hover:text-destructive/80 mt-1"
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
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-edge px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.is_active}
                  onClick={() => set('is_active', !form.is_active)}
                  className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${form.is_active ? 'bg-primary' : 'bg-input'}`}
                  aria-label="Cambiar estado activo"
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span className="min-w-0 text-xs text-subtle">{form.is_active ? 'Producto activo' : 'Producto inactivo'}</span>
              </div>
              <div className="flex w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row">
                {!embedded && (
                  <Button
                    type="button"
                    variant="cancel"
                    size="lg"
                    onClick={handleClose}
                    disabled={loading}
                    className="w-full px-5 sm:w-auto"
                  >
                    Cancelar
                  </Button>
                )}
                <Button
                  type="button"
                  size="lg"
                  onClick={() => void handleSubmit()}
                  disabled={loading}
                  className="w-full px-5 sm:w-auto"
                >
                  {loading ? 'Guardando…' : 'Crear producto'}
                </Button>
              </div>
            </div>
          </div>
        </div>
  )

  if (embedded) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-edge bg-surface">
        {formInner}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[640px]" showCloseButton={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <DialogTitle className="text-base font-semibold text-heading">Nuevo producto</DialogTitle>
          <button
            type="button"
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
