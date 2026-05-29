'use client'

import { useEffect, useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CatalogProduct, CatalogVariantOption, CatalogProductVariant } from '@/components/catalog/types'

const currencyFormatter = new Intl.NumberFormat('es-AR')

const COLOR_MAP: Record<string, string> = {
  rojo: '#ef4444', red: '#ef4444',
  azul: '#3b82f6', blue: '#3b82f6',
  verde: '#22c55e', green: '#22c55e',
  amarillo: '#eab308', yellow: '#eab308',
  negro: '#111827', black: '#111827',
  blanco: '#f9fafb', white: '#f9fafb',
  gris: '#6b7280', gray: '#6b7280', grey: '#6b7280',
  rosa: '#ec4899', pink: '#ec4899',
  naranja: '#f97316', orange: '#f97316',
  violeta: '#8b5cf6', morado: '#8b5cf6', purple: '#8b5cf6',
  celeste: '#38bdf8', cyan: '#06b6d4',
  'marrón': '#92400e', marron: '#92400e', brown: '#92400e',
  beige: '#d4b896',
  crema: '#f5f0e8',
  bordo: '#7f1d1d', 'bordó': '#7f1d1d', vino: '#7f1d1d',
  turquesa: '#14b8a6',
  dorado: '#d97706', gold: '#d97706',
  plateado: '#9ca3af', silver: '#9ca3af',
}

function getColor(val: string): string | null {
  return COLOR_MAP[val.toLowerCase().trim()] ?? null
}

function isColorOption(option: CatalogVariantOption): boolean {
  return (
    option.name.toLowerCase().includes('color') ||
    option.name.toLowerCase().includes('colour') ||
    option.values.filter(v => getColor(v.value) !== null).length >= option.values.length / 2
  )
}

export interface VariantQuickSelectorProps {
  product: CatalogProduct
  options: CatalogVariantOption[]
  variants: CatalogProductVariant[]
  onAddToCart: (variantId: string | null, variantLabel: string | null, price: number, stock: number, variantImageUrl: string | null) => void
  onVariantImageChange?: (imageUrl: string | null) => void
  /** When true, stock is ignored: all variant buttons are always clickable and
   *  "Agregar" only requires that all options are selected. Use in POS context. */
  allowOutOfStock?: boolean
}

export default function VariantQuickSelector({
  product,
  options,
  variants,
  onAddToCart,
  onVariantImageChange,
  allowOutOfStock = false,
}: VariantQuickSelectorProps) {
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})

  const selectedVariant: CatalogProductVariant | null = (() => {
    const allSelected = options.length > 0 && options.every(opt => Boolean(selectedValues[opt.id]))
    if (!allSelected) return null
    return (
      variants.find(variant =>
        options.every(opt => {
          const chosen = selectedValues[opt.id]
          return variant.option_values.some(ov => ov.option_id === opt.id && ov.value === chosen)
        })
      ) ?? null
    )
  })()

  const allSelected = options.length > 0 && options.every(opt => Boolean(selectedValues[opt.id]))

  const displayImage =
    selectedVariant?.image_url ??
    variants.find(v => v.is_in_stock && v.image_url)?.image_url ??
    variants.find(v => v.image_url)?.image_url ??
    null

  useEffect(() => {
    onVariantImageChange?.(displayImage)
  }, [displayImage, onVariantImageChange])

  const displayPrice = selectedVariant?.price ?? product.salePrice
  const displayStock = selectedVariant?.stock ?? product.stock
  const canAdd = allSelected && (allowOutOfStock || displayStock > 0)

  const selectPrompt = options.length > 1 ? 'Selecciona las opciones' : 'Selecciona una opción'
  const addLabel = !allSelected
    ? selectPrompt
    : !allowOutOfStock && displayStock <= 0
      ? 'Sin stock'
      : 'Agregar al carrito'

  function hasStockForValue(optionId: string, value: string): boolean {
    if (allowOutOfStock) return true
    return variants.some(
      v => v.is_active && v.stock > 0 &&
        v.option_values.some(ov => ov.option_id === optionId && ov.value === value)
    )
  }

  function handleSelect(optionId: string, value: string) {
    setSelectedValues(prev => ({
      ...prev,
      [optionId]: prev[optionId] === value ? '' : value,
    }))
  }

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!canAdd || !selectedVariant) return

    const label = options.map(opt => selectedValues[opt.id]).filter(Boolean).join(' / ')
    const cartImage = selectedVariant.image_url ?? product.imageUrl ?? null
    onAddToCart(selectedVariant.id, label, selectedVariant.price, selectedVariant.stock, cartImage)
  }

  return (
    <div className="space-y-2.5">
      {/* Dynamic price */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-foreground">
          ${currencyFormatter.format(displayPrice)}
        </span>
        {!allowOutOfStock && displayStock > 0 && displayStock <= 5 && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Últimas {displayStock}
          </span>
        )}
        {!allowOutOfStock && displayStock <= 0 && (
          <span className="text-xs text-destructive">Sin stock</span>
        )}
      </div>

      {/* Option rows */}
      {options.map(option => {
        const colorMode = isColorOption(option)
        return (
          <div key={option.id}>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {option.name}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {option.values.map(optValue => {
                const inStock = hasStockForValue(option.id, optValue.value)
                const isSelected = selectedValues[option.id] === optValue.value
                const colorHex = colorMode ? getColor(optValue.value) : null

                if (colorHex) {
                  return (
                    <button
                      key={optValue.id}
                      type="button"
                      disabled={!allowOutOfStock && !inStock}
                      title={optValue.value}
                      onClick={e => { e.preventDefault(); e.stopPropagation(); handleSelect(option.id, optValue.value) }}
                      className={[
                        'h-6 w-6 rounded-full border-2 transition-all duration-150',
                        isSelected
                          ? 'border-primary scale-110 shadow-sm ring-2 ring-primary/20'
                          : inStock
                            ? 'border-border/60 hover:border-primary/60 hover:scale-105'
                            : 'opacity-30 cursor-not-allowed border-border/30',
                      ].join(' ')}
                      style={{ backgroundColor: colorHex }}
                    />
                  )
                }

                return (
                  <button
                    key={optValue.id}
                    type="button"
                    disabled={!allowOutOfStock && !inStock}
                    onClick={e => { e.preventDefault(); e.stopPropagation(); handleSelect(option.id, optValue.value) }}
                    className={[
                      'px-2.5 py-0.5 rounded-md border text-xs font-medium transition-colors duration-150',
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : inStock
                          ? 'border-border bg-card text-foreground hover:border-primary/60'
                          : 'border-border bg-card text-muted-foreground opacity-40 cursor-not-allowed line-through',
                    ].join(' ')}
                  >
                    {optValue.value}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Add button */}
      <Button
        type="button"
        size="sm"
        className="w-full h-8 text-xs gap-1.5 mt-1"
        disabled={!canAdd}
        onClick={handleAdd}
        title={!allSelected ? selectPrompt : undefined}
      >
        <ShoppingCart className="h-3 w-3" />
        {addLabel}
      </Button>
    </div>
  )
}
