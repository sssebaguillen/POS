'use client'

import { useCallback, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ImageIcon, Layers, Plus } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import VariantQuickSelector from '@/components/catalog/VariantQuickSelector'
import { promoCountdownLabel } from '@/lib/promotions'
import type { CatalogProduct, CatalogVariantOption, CatalogProductVariant } from '@/components/catalog/types'

const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

interface VariantData {
  options: CatalogVariantOption[]
  variants: CatalogProductVariant[]
}

const variantCache = new Map<string, VariantData | null>()

interface RpcResult {
  success: boolean
  options?: CatalogVariantOption[]
  variants?: CatalogProductVariant[]
}

const currencyFormatter = new Intl.NumberFormat('es-AR')

function CardImage({ imageUrl, name, sizes }: { imageUrl: string; name: string; sizes: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <>
      {!loaded && <div className="absolute inset-0 animate-pulse rounded-lg bg-muted/60" />}
      <Image
        src={imageUrl}
        alt={name}
        fill
        unoptimized
        className={`object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        sizes={sizes}
        onLoad={() => setLoaded(true)}
      />
    </>
  )
}

export interface ProductCardProps {
  product: CatalogProduct
  slug: string
  onAddToCart: (product: CatalogProduct, variantId: string | null, variantLabel: string | null, variantImageUrl?: string | null) => void
}

function PromoBadges({ product }: { product: CatalogProduct }) {
  if (!product.promo) return null
  const countdown = promoCountdownLabel(product.promo.endsAt)
  return (
    <div className="absolute left-2 bottom-2 flex flex-col items-start gap-1">
      <span className="rounded-md bg-promo/95 px-2 py-0.5 text-xs font-bold text-promo-foreground shadow-sm">
        {product.promo.label}
      </span>
      {countdown && (
        <span className="rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {countdown}
        </span>
      )}
    </div>
  )
}

function PriceBlock({ product }: { product: CatalogProduct }) {
  return (
    <p className="mt-1 text-base font-bold text-foreground">
      {product.originalPrice !== null && (
        <span className="mr-1.5 text-sm font-medium text-muted-foreground line-through">
          ${currencyFormatter.format(product.originalPrice)}
        </span>
      )}
      <span className={product.originalPrice !== null ? 'text-promo' : undefined}>
        ${currencyFormatter.format(product.salePrice)}
      </span>
    </p>
  )
}

export default function ProductCard({ product, slug, onAddToCart }: ProductCardProps) {
  const [variantData, setVariantData] = useState<VariantData | null>(null)
  const [isLoadingVariants, setIsLoadingVariants] = useState(false)
  const [hoveredVariantImage, setHoveredVariantImage] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  const isOutOfStock = product.hasVariants ? false : product.stock <= 0
  const detailUrl = `/catalogo/${slug}/${product.id}`

  // Default image comes from get_catalog_products (the default-variant image for variant
  // products, mirroring how price/stock are resolved). On hover, swap to the image of the
  // variant the user is previewing in the selector.
  const displayImageUrl = hoveredVariantImage ?? product.imageUrl

  const fetchVariants = useCallback(async () => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    if (variantCache.has(product.id)) {
      setVariantData(variantCache.get(product.id) ?? null)
      return
    }

    setIsLoadingVariants(true)
    try {
      const { data, error } = await anonClient.rpc('get_catalog_product_with_variants', {
        p_slug: slug,
        p_product_id: product.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)

      if (error) {
        console.error('Failed to fetch catalog variants', error.message)
        variantCache.set(product.id, null)
        return
      }

      if (data) {
        const rpc = data as RpcResult
        if (rpc.success) {
          const result: VariantData = { options: rpc.options ?? [], variants: rpc.variants ?? [] }
          variantCache.set(product.id, result)
          setVariantData(result)
          return
        }
      }

      variantCache.set(product.id, null)
    } catch (error) {
      console.error('Failed to fetch catalog variants', error)
      variantCache.set(product.id, null)
    } finally {
      setIsLoadingVariants(false)
    }
  }, [product.id, slug])

  function handleAddSimple(e: React.MouseEvent) {
    e.preventDefault()
    onAddToCart(product, null, null)
  }

  function handleAddVariant(variantId: string | null, variantLabel: string | null, price: number, stock: number, variantImageUrl: string | null) {
    onAddToCart({ ...product, salePrice: price, stock }, variantId, variantLabel, variantImageUrl)
  }

  const variantBadgeText =
    product.variantCount > 1 ? `${product.variantCount} variantes` : 'Variantes'

  if (!product.hasVariants) {
    // Simple product — no hover panel, just a link card
    return (
      <Link
        href={detailUrl}
        className={`block rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-sm ${isOutOfStock ? 'opacity-60' : ''}`}
      >
        <div className="relative h-44 w-full overflow-hidden rounded-lg bg-muted/40">
          {product.imageUrl ? (
            <CardImage
              imageUrl={product.imageUrl}
              name={product.name}
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
            </div>
          )}
          {isOutOfStock && (
            <span className="absolute left-2 top-2 rounded-md bg-destructive/90 px-2 py-0.5 text-xs font-medium text-destructive-foreground">
              Sin stock
            </span>
          )}
          <PromoBadges product={product} />
        </div>
        <div className="mt-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</h3>
            {product.brandName && (
              <p className="mt-0.5 text-xs text-muted-foreground">{product.brandName}</p>
            )}
            <PriceBlock product={product} />
          </div>
          <Button
            type="button"
            size="icon-sm"
            onClick={handleAddSimple}
            disabled={isOutOfStock}
            aria-label={`Agregar ${product.name} al carrito`}
            className="shrink-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </Link>
    )
  }

  // Variant product — plain CSS :hover (via .catalog-card) drives panel + lift;
  // React only manages async data loading
  return (
    <div
      className={`catalog-card relative hover:z-20 ${isOutOfStock ? 'opacity-60' : ''}`}
      onMouseEnter={fetchVariants}
    >
      {/* catalog-card-inner gets border/lift styles from globals.css on parent hover */}
      <Link
        href={detailUrl}
        className="catalog-card-inner block rounded-xl border border-border/70 bg-card p-4 transition-all duration-200"
      >
        <div className="relative h-44 w-full overflow-hidden rounded-lg bg-muted/40">
          {displayImageUrl ? (
            <CardImage
              imageUrl={displayImageUrl}
              name={product.name}
              sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-8 w-8" />
            </div>
          )}
          {isOutOfStock && (
            <span className="absolute left-2 top-2 rounded-md bg-destructive/90 px-2 py-0.5 text-xs font-medium text-destructive-foreground">
              Sin stock
            </span>
          )}
          {/* Variants badge — visible before hover */}
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <Layers className="h-3 w-3" />
            {variantBadgeText}
          </span>
          <PromoBadges product={product} />
        </div>
        <div className="mt-3 min-w-0">
          <h3 className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</h3>
          {product.brandName && (
            <p className="mt-0.5 text-xs text-muted-foreground">{product.brandName}</p>
          )}
          <PriceBlock product={product} />
        </div>
      </Link>

      {/* catalog-card-panel: hidden by default, shown via .catalog-card:hover rule in globals.css */}
      <div className="catalog-card-panel hidden absolute left-0 right-0 top-full rounded-b-xl border border-t-0 border-primary/40 bg-card p-3 shadow-lg" style={{ zIndex: 10 }}>
        {isLoadingVariants || !variantData ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <VariantQuickSelector
            product={product}
            options={variantData.options}
            variants={variantData.variants}
            onAddToCart={handleAddVariant}
            onVariantImageChange={setHoveredVariantImage}
          />
        )}
      </div>
    </div>
  )
}
