'use client'

import { useCallback, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Check, ImageIcon, Layers, Plus } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
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
  // sale_price de productos con variantes ya es el mínimo entre variantes activas
  // (get_catalog_products) — el "Desde" lo hace explícito cuando hay más de una
  const showDesde = product.hasVariants && product.variantCount > 1
  return (
    <p className="mt-1 text-base font-bold text-foreground">
      {showDesde && (
        <span className="mr-1 text-xs font-medium text-muted-foreground">Desde</span>
      )}
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
  const [optionsSheetOpen, setOptionsSheetOpen] = useState(false)
  const [justAdded, setJustAdded] = useState(false)
  const fetchedRef = useRef(false)
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    setJustAdded(true)
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current)
    addedTimerRef.current = setTimeout(() => setJustAdded(false), 1500)
  }

  function handleAddVariant(variantId: string | null, variantLabel: string | null, price: number, stock: number, variantImageUrl: string | null) {
    onAddToCart({ ...product, salePrice: price, stock }, variantId, variantLabel, variantImageUrl)
  }

  function handleAddVariantFromSheet(variantId: string | null, variantLabel: string | null, price: number, stock: number, variantImageUrl: string | null) {
    handleAddVariant(variantId, variantLabel, price, stock, variantImageUrl)
    setOptionsSheetOpen(false)
  }

  function handleOpenOptionsSheet(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    fetchVariants()
    setOptionsSheetOpen(true)
  }

  const variantBadgeText =
    product.variantCount > 1 ? `${product.variantCount} opciones` : 'Opciones'

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
            className="h-10 w-10 shrink-0 md:h-7 md:w-7"
          >
            {justAdded ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
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
          {/* Variants badge — informativo en desktop (hover abre el panel), tap target
              en touch: abre el quick-selector en un bottom sheet */}
          {/* min-h-11 en touch (target 44px), compacto en desktop donde el hover
              ya abre el panel y el badge es informativo */}
          <button
            type="button"
            onClick={handleOpenOptionsSheet}
            aria-label={`Elegir opciones de ${product.name}`}
            className="absolute right-2 top-2 inline-flex min-h-11 items-center gap-1 rounded-lg bg-black/55 px-3 text-xs font-medium text-white transition-colors duration-150 hover:bg-black/70 active:bg-black/70 md:min-h-7 md:rounded-md md:px-2 md:py-1 md:text-[11px]"
          >
            <Layers className="h-3 w-3" />
            {variantBadgeText}
          </button>
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

      {/* Bottom sheet de opciones — camino primario en touch, donde no hay hover */}
      <Sheet open={optionsSheetOpen} onOpenChange={setOptionsSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[max(env(safe-area-inset-bottom),1rem)]">
          <SheetHeader className="pb-0">
            <SheetTitle className="pr-10">{product.name}</SheetTitle>
            {product.brandName && (
              <p className="text-xs text-muted-foreground">{product.brandName}</p>
            )}
          </SheetHeader>
          <div className="px-4 pb-2">
            {isLoadingVariants || !variantData ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <VariantQuickSelector
                product={product}
                options={variantData.options}
                variants={variantData.variants}
                onAddToCart={handleAddVariantFromSheet}
                touchOptimized
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
