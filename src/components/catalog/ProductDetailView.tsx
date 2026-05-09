'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ImageIcon, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type {
  CatalogProductDetail,
  CatalogVariantOption,
  CatalogProductVariant,
  CatalogCartItem,
} from '@/components/catalog/types'

const CART_TTL_MS = 8 * 60 * 60 * 1000

interface StoredCart {
  items: CatalogCartItem[]
  savedAt: number
}

const currencyFormatter = new Intl.NumberFormat('es-AR')

interface Props {
  slug: string
  businessId: string
  businessName: string
  product: CatalogProductDetail
  options: CatalogVariantOption[]
  variants: CatalogProductVariant[]
}

export default function ProductDetailView({
  slug,
  businessId,
  product,
  options,
  variants,
}: Props) {
  const router = useRouter()
  const cartKey = `catalog-cart-${businessId}`

  // Selected option value per option id
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})
  const [added, setAdded] = useState(false)

  // Find the matching variant based on all selected option values
  const selectedVariant: CatalogProductVariant | null = (() => {
    if (!product.has_variants || options.length === 0) return null
    const allSelected = options.every(opt => Boolean(selectedValues[opt.id]))
    if (!allSelected) return null

    return variants.find(variant =>
      options.every(opt => {
        const chosen = selectedValues[opt.id]
        return variant.option_values.some(
          ov => ov.option_id === opt.id && ov.value === chosen
        )
      })
    ) ?? null
  })()

  const displayPrice = selectedVariant
    ? selectedVariant.price
    : product.computed_price

  const displayStock = selectedVariant
    ? selectedVariant.stock
    : product.stock

  const displayImage = selectedVariant?.image_url ?? product.image_url

  const isOutOfStock = displayStock <= 0

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
      hasVariants: product.has_variants,
    }

    const itemKey = `${product.id}:${variantId ?? ''}`

    // Read existing cart
    let stored: StoredCart = { items: [], savedAt: Date.now() }
    try {
      const raw = localStorage.getItem(cartKey)
      if (raw) {
        const parsed = JSON.parse(raw) as StoredCart | CatalogCartItem[]
        if (!Array.isArray(parsed) && Date.now() - parsed.savedAt < CART_TTL_MS) {
          stored = parsed
        } else if (Array.isArray(parsed)) {
          stored = { items: parsed, savedAt: 0 }
        }
      }
    } catch {
      // ignore
    }

    // Upsert the item
    const existing = stored.items.find(
      item => `${item.product.id}:${item.variantId ?? ''}` === itemKey
    )

    let nextItems: CatalogCartItem[]
    if (existing) {
      nextItems = stored.items.map(item =>
        `${item.product.id}:${item.variantId ?? ''}` === itemKey
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    } else {
      nextItems = [
        ...stored.items,
        {
          product: cartItemProduct,
          quantity: 1,
          variantId,
          variantLabel: label,
        },
      ]
    }

    localStorage.setItem(
      cartKey,
      JSON.stringify({ items: nextItems, savedAt: Date.now() })
    )

    setAdded(true)
    setTimeout(() => {
      router.push(`/catalogo/${slug}`)
    }, 600)
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back link */}
      <Link
        href={`/catalogo/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
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
            <p className="mt-2 text-3xl font-bold text-foreground">
              ${currencyFormatter.format(displayPrice)}
            </p>
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
            <span className="inline-flex items-center rounded-md bg-green-100 px-2.5 py-1 text-sm font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400 w-fit">
              Disponible
            </span>
          )}

          {/* Variant options */}
          {product.has_variants && options.map(option => (
            <div key={option.id}>
              <p className="mb-2 text-sm font-medium text-foreground">{option.name}</p>
              <div className="flex flex-wrap gap-2">
                {(option.values ?? []).map(optValue => {
                  // Find if this value has any active variant
                  const hasStock = variants.some(v =>
                    v.is_active &&
                    v.option_values.some(
                      ov => ov.option_id === option.id && ov.value === optValue.value
                    )
                  )
                  const isSelected = selectedValues[option.id] === optValue.value

                  return (
                    <button
                      key={optValue.id}
                      type="button"
                      disabled={!hasStock}
                      onClick={() =>
                        setSelectedValues(prev => ({
                          ...prev,
                          [option.id]: isSelected ? '' : optValue.value,
                        }))
                      }
                      className={[
                        'px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : hasStock
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
          ))}

          {/* Add to cart */}
          <div className="mt-auto pt-2">
            {product.has_variants && !allOptionsSelected && (
              <p className="mb-2 text-sm text-muted-foreground">
                Seleccioná todas las opciones para continuar.
              </p>
            )}
            <Button
              type="button"
              className="w-full h-11 gap-2"
              disabled={!canAdd || added}
              onClick={handleAddToCart}
            >
              <ShoppingCart className="h-4 w-4" />
              {added ? 'Agregado al carrito...' : 'Agregar al carrito'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
