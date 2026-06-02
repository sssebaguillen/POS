'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { PriceList, PriceListOverride, ProductOption, ProductVariant, ProductWithVariants } from '@/lib/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct } from '@/components/inventory/types'
import { translateDbError } from '@/lib/errors'
import FieldGroup from '@/components/inventory/FieldGroup'
import VariantEditor from '@/components/inventory/VariantEditor'
import type { VariantPayloadEdit, VariantPayloadNew } from '@/components/inventory/VariantEditor'
import ImageUploadField from '@/components/inventory/shared/ImageUploadField'
import { useImageUpload } from '@/hooks/useImageUpload'
import { useComboboxNav } from '@/hooks/useComboboxNav'
import { useProductForm, type ProductFormBase } from '@/hooks/useProductForm'
import { useCurrency } from '@/lib/context/CurrencyContext'
import { getCurrencySymbol, toTitleCase } from '@/lib/format'
import CategoryIconPreview from '@/components/inventory/CategoryIconPreview'
import PriceOverrideIndicator from '@/components/inventory/PriceOverrideIndicator'
import FloatingDropdown from '@/components/ui/FloatingDropdown'

interface EditProductModalProps {
  open: boolean
  onClose: () => void
  product: InventoryProduct
  businessId: string | null
  operatorId: string | null
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  priceLists: PriceList[]
  existingOverrides: PriceListOverride[]
  onSaved: (updated: Partial<InventoryProduct>, nextOverrides: PriceListOverride[]) => void
}

interface FormState extends ProductFormBase {
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
    is_active: product.is_active ?? true,
  }
}

export default function EditProductModal({
  open,
  onClose,
  product,
  businessId,
  operatorId,
  categories,
  brands,
  priceLists,
  existingOverrides,
  onSaved,
}: EditProductModalProps) {
  // Precio base manual: un cambio de costo nunca recalcula el precio. Las listas son tiers opt-in.
  const defaultPriceList = null
  const defaultSelectedIds = (): Set<string> =>
    new Set(existingOverrides.map(o => o.price_list_id))

  const {
    form,
    setField,
    errors,
    setErrors,
    isPriceEdited,
    selectedListIds,
    setSelectedListIds,
    margin,
    handleCostChange,
    handlePriceChange,
    validateBaseFields,
    reset: resetProductForm,
  } = useProductForm<FormState>({
    initial: toFormState(product),
    defaultPriceList,
    defaultSelectedListIds: defaultSelectedIds,
    initialIsPriceEdited: existingOverrides.length > 0,
    preserveManualPriceOnCostChange: true,
    requireStock: true,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [brandInput, setBrandInput] = useState(product.brand?.name ?? '')
  const [showBrandOptions, setShowBrandOptions] = useState(false)
  const [categoryInput, setCategoryInput] = useState(() => {
    const matchedCategory = categories.find(category => category.id === (product.category_id ?? ''))
    return matchedCategory?.name ?? product.categories?.name ?? ''
  })
  const [showCategoryOptions, setShowCategoryOptions] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const image = useImageUpload({
    businessId,
    initialUrl: product.image_url ?? null,
    initialSource: (product.image_source as 'upload' | 'url' | null) ?? null,
  })
  const categoryAnchorRef = useRef<HTMLDivElement>(null)
  const brandAnchorRef = useRef<HTMLDivElement>(null)

  const supabase = useMemo(() => createClient(), [])
  const currency = useCurrency()
  const currencySymbol = getCurrencySymbol(currency)

  // Variant state
  const [hasVariants, setHasVariants] = useState(product.has_variants ?? false)
  const [variantPayload, setVariantPayload] = useState<VariantPayloadEdit | null>(null)
  const [variantOptions, setVariantOptions] = useState<ProductOption[]>([])
  const [variantVariants, setVariantVariants] = useState<ProductVariant[]>([])
  const [variantLoading, setVariantLoading] = useState(false)
  const variantLoadedRef = useRef(false)

  const handleVariantPayloadChange = useCallback((payload: VariantPayloadNew | VariantPayloadEdit | null) => {
    setVariantPayload(payload as VariantPayloadEdit | null)
  }, [])

  // Load variant data when collapsable opens and product has_variants
  useEffect(() => {
    if (!product.has_variants || variantLoadedRef.current) return
    variantLoadedRef.current = true
    startTransition(() => {
      setVariantLoading(true)
    })
    supabase.rpc('get_product_with_variants', { p_product_id: product.id }).then(({ data }) => {
      setVariantLoading(false)
      const result = data as ProductWithVariants | null
      if (result?.options) setVariantOptions(result.options)
      if (result?.variants) setVariantVariants(result.variants)
    })
  }, [product.has_variants, product.id, supabase])

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

  function selectCategoryByIndex(index: number) {
    if (index === 0) {
      setField('category_id', '')
      setCategoryInput('')
    } else {
      const category = filteredCategories[index - 1]
      if (!category) return
      setField('category_id', category.id)
      setCategoryInput(category.name)
    }
    setShowCategoryOptions(false)
  }

  function closeCategoryOptions() {
    setShowCategoryOptions(false)
    if (!form.category_id) setCategoryInput('')
  }

  function selectBrandByIndex(index: number) {
    const brand = filteredBrands[index]
    if (!brand) return
    setField('brand_id', brand.id)
    setBrandInput(brand.name)
    setShowBrandOptions(false)
  }

  function closeBrandOptions() {
    setShowBrandOptions(false)
    if (!form.brand_id) setBrandInput('')
  }

  const categoryNav = useComboboxNav({
    optionCount: filteredCategories.length + 1,
    isOpen: showCategoryOptions,
    setIsOpen: setShowCategoryOptions,
    onSelect: selectCategoryByIndex,
    onClose: closeCategoryOptions,
  })
  const brandNav = useComboboxNav({
    optionCount: filteredBrands.length,
    isOpen: showBrandOptions,
    setIsOpen: setShowBrandOptions,
    onSelect: selectBrandByIndex,
    onClose: closeBrandOptions,
  })

  function validate() {
    return validateBaseFields(hasVariants)
  }

  async function handleSubmit() {
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
        name: toTitleCase(form.name.trim()),
        price: parsedPrice,
        cost: parsedCost || 0,
        stock: Math.trunc(Number(form.stock) || 0),
        min_stock: Math.trunc(Number(form.min_stock) || 0),
        sku: form.sku.trim() || null,
        brand_id: form.brand_id || null,
        barcode: form.barcode.trim() || null,
        category_id: form.category_id || null,
        show_in_catalog: form.show_in_catalog,
        is_active: form.is_active,
        image_url: image.url,
        image_source: image.source,
      },
      nextOverrides
    )
  }

  async function handleSubmitWithVariants() {
    if (!form.name.trim()) {
      setErrors({ name: 'El nombre es obligatorio' })
      return
    }

    if (!variantPayload || variantPayload.options.length === 0) {
      setErrors({ _global: 'Define al menos un atributo con valores para las variantes' })
      return
    }

    const activeVariants = variantPayload.variants.filter(v => v.is_active)
    if (activeVariants.length === 0) {
      setErrors({ _global: 'La tabla de variantes debe tener al menos una variante activa' })
      return
    }

    if (!activeVariants.every(v => v.price > 0)) {
      setErrors({ _global: 'Cada variante activa debe tener un precio de venta mayor a 0' })
      return
    }

    setIsSaving(true)
    const { data: rpcResult, error: rpcError } = await supabase.rpc('update_product_variants', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_product_id: product.id,
      p_options: variantPayload.options,
      p_variants: variantPayload.variants,
    })

    const result = rpcResult as { success: boolean; error?: string } | null
    if (rpcError || !result?.success) {
      setIsSaving(false)
      setErrors({ _global: result?.error ?? translateDbError(rpcError?.message ?? '', 'No se pudo guardar el producto con variantes. Revisa los datos e inténtalo de nuevo.') })
      return
    }

    const nextOverrides = existingOverrides

    setIsSaving(false)

    // Solo persistir campos del padre que efectivamente cambiaron.
    // Stock/price/cost/min_stock/sku/barcode son irrelevantes para productos con
    // variantes (la data real vive en product_variants) y no deben generar audit
    // events ruido cuando el usuario edita solo una variante.
    const parentChanges: Partial<InventoryProduct> = {}
    const newName = toTitleCase(form.name.trim())
    if (newName !== product.name) parentChanges.name = newName
    const newBrandId = form.brand_id || null
    if (newBrandId !== (product.brand_id ?? null)) parentChanges.brand_id = newBrandId
    const newCategoryId = form.category_id || null
    if (newCategoryId !== (product.category_id ?? null)) parentChanges.category_id = newCategoryId
    if (form.show_in_catalog !== product.show_in_catalog) parentChanges.show_in_catalog = form.show_in_catalog
    if (form.is_active !== product.is_active) parentChanges.is_active = form.is_active
    if (image.url !== (product.image_url ?? null)) parentChanges.image_url = image.url
    const oldImageSource = (product.image_source as 'upload' | 'url' | null) ?? null
    if (image.source !== oldImageSource) parentChanges.image_source = image.source
    // has_variants solo se incluye en el caso de transición simple → variants
    if (!product.has_variants) parentChanges.has_variants = true

    onSaved(parentChanges, nextOverrides)
  }

  function handleClose() {
    const matchedCategory = categories.find(category => category.id === (product.category_id ?? ''))
    resetProductForm({
      initial: toFormState(product),
      selectedListIds: new Set(existingOverrides.map(o => o.price_list_id)),
      isPriceEdited: existingOverrides.length > 0,
    })
    setBrandInput(product.brand?.name ?? '')
    setShowBrandOptions(false)
    setCategoryInput(matchedCategory?.name ?? product.categories?.name ?? '')
    setShowCategoryOptions(false)
    image.reset({
      url: product.image_url ?? null,
      source: (product.image_source as 'upload' | 'url' | null) ?? null,
    })
    setShowAdvanced(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-[640px]" showCloseButton={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <DialogTitle className="text-base font-semibold text-heading">Editar producto</DialogTitle>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="space-y-3.5">

              {errors._global && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{errors._global}</p>
              )}

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <FieldGroup label="Nombre" required error={errors.name}>
                  <Input
                    value={form.name}
                    onChange={event => setField('name', event.target.value)}
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
                      aria-controls="edit-category-listbox"
                      aria-autocomplete="list"
                      aria-activedescendant={showCategoryOptions && categoryNav.highlight >= 0 ? `edit-category-option-${categoryNav.highlight}` : undefined}
                      onFocus={categoryNav.openFromFocus}
                      onChange={event => {
                        const nextValue = event.target.value
                        setCategoryInput(nextValue)
                        setShowCategoryOptions(true)
                        categoryNav.setHighlight(0)
                        const exactCategory = categories.find(category => category.name.toLowerCase() === nextValue.trim().toLowerCase())
                        setField('category_id', exactCategory ? exactCategory.id : '')
                      }}
                      onKeyDown={categoryNav.handleKeyDown}
                      placeholder="Seleccionar categoría"
                      className="pr-8"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showCategoryOptions ? 'Cerrar categorías' : 'Abrir categorías'}
                      onMouseDown={event => {
                        event.preventDefault()
                        categoryNav.toggle(showCategoryOptions, () => {
                          if (!form.category_id) setCategoryInput('')
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
                        id="edit-category-listbox"
                        role="listbox"
                        onMouseDown={e => e.preventDefault()}
                      >
                        <button
                          type="button"
                          role="option"
                          id="edit-category-option-0"
                          aria-selected={categoryNav.highlight === 0}
                          className={`w-full px-3 py-2 text-left text-sm transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] ${categoryNav.highlight === 0 ? 'bg-surface-alt text-body' : 'text-body hover:bg-hover-bg'}`}
                          onMouseEnter={() => categoryNav.setHighlight(0)}
                          onMouseDown={event => {
                            event.preventDefault()
                            selectCategoryByIndex(0)
                          }}
                        >
                          Sin categoría
                        </button>
                        {filteredCategories.map((category, idx) => {
                          const index = idx + 1
                          const isHighlighted = categoryNav.highlight === index
                          return (
                            <button
                              key={category.id}
                              type="button"
                              role="option"
                              id={`edit-category-option-${index}`}
                              aria-selected={isHighlighted}
                              className={`w-full px-3 py-2 text-left text-sm transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] ${isHighlighted ? 'bg-surface-alt text-body' : 'text-body hover:bg-hover-bg'}`}
                              onMouseEnter={() => categoryNav.setHighlight(index)}
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
                      aria-controls="edit-brand-listbox"
                      aria-autocomplete="list"
                      aria-activedescendant={showBrandOptions && brandNav.highlight >= 0 ? `edit-brand-option-${brandNav.highlight}` : undefined}
                      onFocus={brandNav.openFromFocus}
                      onChange={event => {
                        const nextValue = event.target.value
                        setBrandInput(nextValue)
                        setShowBrandOptions(true)
                        brandNav.setHighlight(0)
                        const exactBrand = brands.find(brand => brand.name.toLowerCase() === nextValue.trim().toLowerCase())
                        setField('brand_id', exactBrand ? exactBrand.id : '')
                      }}
                      onKeyDown={brandNav.handleKeyDown}
                      placeholder="Seleccionar marca"
                      className="pr-8"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showBrandOptions ? 'Cerrar marcas' : 'Abrir marcas'}
                      onMouseDown={event => {
                        event.preventDefault()
                        brandNav.toggle(showBrandOptions, () => {
                          if (!form.brand_id) setBrandInput('')
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
                        id="edit-brand-listbox"
                        role="listbox"
                        onMouseDown={e => e.preventDefault()}
                      >
                        {filteredBrands.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-hint">
                            No se encontró la marca. Créala desde el botón Marcas.
                          </div>
                        ) : (
                          filteredBrands.map((brand, idx) => {
                            const isHighlighted = brandNav.highlight === idx
                            return (
                              <button
                                key={brand.id}
                                type="button"
                                role="option"
                                id={`edit-brand-option-${idx}`}
                                aria-selected={isHighlighted}
                                className={`w-full px-3 py-2 text-left text-sm transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] ${isHighlighted ? 'bg-surface-alt text-body' : 'text-body hover:bg-hover-bg'}`}
                                onMouseEnter={() => brandNav.setHighlight(idx)}
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
                  <FieldGroup label="Costo" error={errors.cost}>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">{currencySymbol}</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.cost}
                        onChange={event => handleCostChange(event.target.value)}
                        placeholder="0"
                        aria-invalid={!!errors.cost}
                        className="pl-7"
                      />
                    </div>
                    {margin !== null && (
                      <p className="text-caption text-emerald-600 dark:text-emerald-400 font-medium">
                        Margen: {margin}% · Ganancia por unidad: {currencySymbol}{(Number(form.price) - Number(form.cost)).toFixed(2)}
                      </p>
                    )}
                  </FieldGroup>

                  <FieldGroup
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        Precio
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
                        onChange={event => handlePriceChange(event.target.value)}
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
                  <FieldGroup label="Stock actual" required error={errors.stock}>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={form.stock}
                      onChange={event => setField('stock', event.target.value)}
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
                      onChange={event => setField('min_stock', event.target.value)}
                      placeholder="0"
                      aria-invalid={!!errors.min_stock}
                    />
                  </FieldGroup>

                  <div className="sm:col-span-2">
                    <FieldGroup label="Código de barras">
                      <Input
                        value={form.barcode}
                        onChange={event => setField('barcode', event.target.value)}
                        placeholder="Ej: 7790001234567"
                      />
                    </FieldGroup>
                  </div>
                </div>
              )}

              {/* Variant body — toggle lifted to row 1, so hide it here */}
              {variantLoading ? (
                <div className="py-2 text-xs text-hint">Cargando variantes…</div>
              ) : (
                <VariantEditor
                  businessId={businessId}
                  mode="edit"
                  initialOptions={variantOptions}
                  initialVariants={variantVariants}
                  initialDefaultVariantId={product.default_variant_id ?? undefined}
                  hasSalesHistory={(product.sales_count ?? 0) > 0}
                  hasVariants={hasVariants}
                  onHasVariantsChange={setHasVariants}
                  onPayloadChange={handleVariantPayloadChange}
                  hideToggle
                />
              )}

              {/* Collapsable — Imagen y detalles adicionales (toggle + content in one container) */}
              <div className="rounded-lg border border-edge bg-surface overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] text-left"
                  aria-expanded={showAdvanced}
                >
                  <ChevronRight className={`w-3.5 h-3.5 text-hint transition-transform shrink-0 ${showAdvanced ? 'rotate-90' : ''}`} />
                  <span className="text-xs font-medium text-subtle">Imagen y detalles adicionales</span>
                  <span className="text-xs text-hint ml-1">
                    {hasVariants ? '· Foto del producto base, visibilidad' : '· SKU, foto, visibilidad'}
                  </span>
                </button>

                {showAdvanced && (
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 border-t border-edge px-3 py-3">
                  {!hasVariants && (
                    <div className="sm:col-span-2">
                      <FieldGroup label="SKU">
                        <Input
                          value={form.sku}
                          onChange={event => setField('sku', event.target.value)}
                          placeholder="Ej: PSTACC-500"
                        />
                      </FieldGroup>
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <p className="text-label text-subtle mb-2">Imagen del producto</p>
                    <ImageUploadField controller={image} />
                  </div>

                  {/* Visible en catálogo — moved out of footer so is_active can take its place */}
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface-alt px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-body">Visible en catálogo</p>
                        <p className="text-caption text-hint">Mostrar este producto en el catálogo público de tu negocio.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={form.show_in_catalog}
                        onClick={() => setField('show_in_catalog', !form.show_in_catalog)}
                        className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${form.show_in_catalog ? 'bg-primary' : 'bg-input'}`}
                        aria-label="Cambiar visibilidad en catálogo"
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${form.show_in_catalog ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
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
                  onClick={() => setField('is_active', !form.is_active)}
                  className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${form.is_active ? 'bg-primary' : 'bg-input'}`}
                  aria-label="Cambiar estado activo"
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${form.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <span className="min-w-0 text-xs text-subtle">{form.is_active ? 'Producto activo' : 'Producto inactivo'}</span>
              </div>
              <div className="flex w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row">
                <Button type="button" variant="cancel" size="lg" onClick={handleClose} disabled={isSaving} className="w-full px-5 sm:w-auto">
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => void (hasVariants ? handleSubmitWithVariants() : handleSubmit())}
                  disabled={isSaving}
                  className="w-full px-5 sm:w-auto"
                >
                  {isSaving ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
