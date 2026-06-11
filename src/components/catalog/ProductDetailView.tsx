'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ImageIcon, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { promoBadgeLabel, promoCountdownLabel } from '@/lib/promotions'
import type {
  CatalogProductDetail,
  CatalogVariantOption,
  CatalogProductVariant,
} from '@/components/catalog/types'
import PopNumber from '@/components/shared/PopNumber'
import { useCatalogShell } from '@/components/catalog/CatalogShell'

const currencyFormatter = new Intl.NumberFormat('es-AR')

interface Props {
  slug: string
  product: CatalogProductDetail
  options: CatalogVariantOption[]
  variants: CatalogProductVariant[]
}

interface CatalogProductDetailWithDefaultVariant extends CatalogProductDetail {
  default_variant_id?: string | null
}

function getAvailableValues(
  optionId: string,
  selectedValues: Record<string, string>,
  variants: CatalogProductVariant[]
): Set<string> {
  const otherSelections = Object.entries(selectedValues).filter(
    ([selectedOptionId, selectedValue]) =>
      selectedOptionId !== optionId && Boolean(selectedValue)
  )

  return new Set(
    variants
      .filter(variant => variant.is_in_stock && variant.is_active)
      .filter(variant =>
        otherSelections.every(([selectedOptionId, selectedValue]) =>
          variant.option_values.some(
            optionValue =>
              optionValue.option_id === selectedOptionId &&
              optionValue.value === selectedValue
          )
        )
      )
      .flatMap(variant => variant.option_values)
      .filter(optionValue => optionValue.option_id === optionId)
      .map(optionValue => optionValue.value)
  )
}

export default function ProductDetailView({
  slug,
  product,
  options,
  variants,
}: Props) {
  const { addToCart } = useCatalogShell()
  const productWithDefaultVariant = product as CatalogProductDetailWithDefaultVariant

  // Selected option value per option id
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})
  const [added, setAdded] = useState(false)

  const defaultDisplayVariant: CatalogProductVariant | null = product.has_variants
    ? variants.find(
        variant =>
          variant.id === productWithDefaultVariant.default_variant_id &&
          variant.is_in_stock
      ) ??
      variants.find(variant => variant.is_in_stock) ??
      variants[0] ??
      null
    : null

  // Find the matching variant based on all selected option values
  const selectedVariant: CatalogProductVariant | null = (() => {
    if (!product.has_variants || options.length === 0) return null
    const allSelected = options.every(opt => Boolean(selectedValues[opt.id]))
    if (!allSelected) return null

    return variants.find(variant =>
      variant.is_active &&
      options.every(opt => {
        const chosen = selectedValues[opt.id]
        return variant.option_values.some(
          ov => ov.option_id === opt.id && ov.value === chosen
        )
      })
    ) ?? null
  })()

  const displayVariant = selectedVariant ?? defaultDisplayVariant

  const displayPrice = displayVariant?.price ?? product.computed_price

  const displayStock = displayVariant?.stock ?? product.stock

  const displayImage =
    selectedVariant?.image_url ??
    defaultDisplayVariant?.image_url ??
    product.image_url

  const isOutOfStock = displayVariant
    ? !displayVariant.is_in_stock
    : displayStock <= 0

  const allOptionsSelected = product.has_variants
    ? options.every(opt => Boolean(selectedValues[opt.id]))
    : true

  const canAdd = !isOutOfStock && allOptionsSelected

  function buildVariantLabel(): string | null {
    if (!selectedVariant) return null
    return options
      .map(opt => selectedValues[opt.id])
      .filter(Boolean)
      .join(' / ')
  }

  function handleSelect(optionId: string, value: string) {
    setSelectedValues(previousValues => {
      const cleanedSelection = { ...previousValues }

      if (cleanedSelection[optionId] === value) {
        delete cleanedSelection[optionId]
      } else {
        cleanedSelection[optionId] = value
      }

      for (const option of options) {
        if (option.id === optionId) continue

        const selectedValue = cleanedSelection[option.id]
        if (!selectedValue) continue

        const availableValues = getAvailableValues(
          option.id,
          cleanedSelection,
          variants
        )

        if (!availableValues.has(selectedValue)) {
          delete cleanedSelection[option.id]
        }
      }

      return cleanedSelection
    })
  }

  function handleAddToCart() {
    if (!canAdd) return

    const label = buildVariantLabel()
    const variantId = selectedVariant?.id ?? null

    const cartItemProduct = {
      id: product.id,
      categoryId: null,
      name: product.name,
      salePrice: displayPrice,
      stock: displayStock,
      imageUrl: displayImage,
      brandId: null,
      brandName: null,
      hasVariants: product.has_variants,
      variantCount: variants.filter(v => v.is_active).length,
      originalPrice: selectedVariant
        ? (selectedVariant.original_price ?? null)
        : (product.original_price ?? null),
      promo: product.promo
        ? {
            kind: product.promo.kind,
            percent: product.promo.percent,
            group_size: product.promo.group_size,
            affected_units: product.promo.affected_units,
            pay_percent: product.promo.pay_percent,
            endsAt: product.promo.ends_at,
            featured: product.promo.featured,
            label: promoBadgeLabel(product.promo),
          }
        : null,
    }

    addToCart(cartItemProduct, variantId, label, selectedVariant?.image_url ?? null)

    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back link */}
      <Link
        href={`/catalogo/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al catálogo
      </Link>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Image */}
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-muted/40 border border-border/70">
          {displayImage ? (
            <Image
              src={displayImage}
              alt={product.name}
              fill
              unoptimized
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-16 w-16" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{product.name}</h1>
            {(() => {
              const originalPrice = selectedVariant
                ? (selectedVariant.original_price ?? null)
                : (product.original_price ?? null)
              const countdown = product.promo ? promoCountdownLabel(product.promo.ends_at) : null
              return (
                <>
                  <p className="mt-2 text-3xl font-bold text-foreground">
                    {originalPrice !== null && (
                      <span className="mr-2 text-xl font-medium text-muted-foreground line-through">
                        ${currencyFormatter.format(originalPrice)}
                      </span>
                    )}
                    <span className={originalPrice !== null ? 'text-promo' : undefined}>
                      <PopNumber value={`$${currencyFormatter.format(displayPrice)}`} />
                    </span>
                  </p>
                  {product.promo && (
                    <p className="mt-1.5 flex items-center gap-1.5">
                      <span className="rounded-md bg-promo/95 px-2 py-0.5 text-xs font-bold text-promo-foreground">
                        {promoBadgeLabel(product.promo)}
                      </span>
                      {countdown && (
                        <span className="text-xs font-medium text-muted-foreground">{countdown}</span>
                      )}
                    </p>
                  )}
                </>
              )
            })()}
          </div>

          {/* Stock badge */}
          {isOutOfStock ? (
            <span className="inline-flex items-center rounded-md bg-destructive/10 px-2.5 py-1 text-sm font-medium text-destructive w-fit">
              Sin stock disponible
            </span>
          ) : displayStock > 0 && displayStock <= 5 ? (
            <span className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 w-fit">
              Últimas {displayStock} unidades
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-promo/10 px-2.5 py-1 text-sm font-medium text-promo w-fit">
              Disponible
            </span>
          )}

          {/* Variant options */}
          {product.has_variants &&
            options.map(option => {
              const availableValues = getAvailableValues(
                option.id,
                selectedValues,
                variants
              )

              return (
                <div key={option.id}>
                  <p className="mb-2 text-sm font-medium text-foreground">
                    {option.name}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(option.values ?? []).map(optValue => {
                      const isAvailable = availableValues.has(optValue.value)
                      const isSelected = selectedValues[option.id] === optValue.value

                      return (
                        <button
                          key={optValue.id}
                          type="button"
                          disabled={!isAvailable}
                          onClick={() => handleSelect(option.id, optValue.value)}
                          className={[
                            'px-3 py-1.5 rounded-lg border text-sm font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]',
                            isSelected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : isAvailable
                                ? 'border-border bg-background text-foreground hover:border-primary/60'
                                : 'border-border bg-background text-muted-foreground opacity-50 cursor-not-allowed line-through',
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

          {/* Add to cart */}
          <div className="mt-auto pt-2">
            {product.has_variants && !allOptionsSelected && (
              <p className="mb-2 text-sm text-muted-foreground">
                Selecciona todas las opciones para continuar.
              </p>
            )}
            <Button
              type="button"
              className={`w-full h-11 gap-2 ${added ? 'bg-promo hover:bg-promo text-promo-foreground' : ''}`}
              disabled={!canAdd}
              onClick={handleAddToCart}
            >
              <ShoppingCart className="h-4 w-4" />
              {added ? '✓ Agregado al carrito' : 'Agregar al carrito'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
