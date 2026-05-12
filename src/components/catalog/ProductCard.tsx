'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ImageIcon, Layers, Plus } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import VariantQuickSelector from '@/components/catalog/VariantQuickSelector'
import type { CatalogProduct, CatalogVariantOption, CatalogProductVariant } from '@/components/catalog/types'

let _anonClient: ReturnType<typeof createClient> | null = null
function getAnonClient() {
  if (!_anonClient) {
    _anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  }
  return _anonClient
}

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
  onAddToCart: (product: CatalogProduct, variantId: string | null, variantLabel: string | null) => void
}

export default function ProductCard({ product, slug, onAddToCart }: ProductCardProps) {
  const [variantData, setVariantData] = useState<VariantData | null>(null)
  const [loadedVariantCount, setLoadedVariantCount] = useState<number | null>(null)
  const [isLoadingVariants, setIsLoadingVariants] = useState(false)
  const fetchedRef = useRef(false)

  const isOutOfStock = product.hasVariants ? false : product.stock <= 0
  const detailUrl = `/catalogo/${slug}/${product.id}`

  async function fetchVariants() {
    if (fetchedRef.current) return
    fetchedRef.current = true

    if (variantCache.has(product.id)) {
      const cached = variantCache.get(product.id) ?? null
      setVariantData(cached)
      if (cached) setLoadedVariantCount(cached.variants.length)
      return
    }

    setIsLoadingVariants(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (getAnonClient() as any).rpc('get_catalog_product_with_variants', {
        p_slug: slug,
        p_product_id: product.id,
      })
      if (!error && data) {
        const rpc = data as unknown as RpcResult
        if (rpc.success) {
          const result: VariantData = { options: rpc.options ?? [], variants: rpc.variants ?? [] }
          variantCache.set(product.id, result)
          setVariantData(result)
          setLoadedVariantCount(result.variants.length)
        }
      }
    } catch {
      // silently fail — user can navigate to detail page
    } finally {
      setIsLoadingVariants(false)
    }
  }

  function handleAddSimple(e: React.MouseEvent) {
    e.preventDefault()
    onAddToCart(product, null, null)
  }

  function handleAddVariant(variantId: string | null, variantLabel: string | null, price: number, stock: number) {
    onAddToCart({ ...product, salePrice: price, stock }, variantId, variantLabel)
  }

  const variantBadgeText =
    loadedVariantCount != null && loadedVariantCount > 1
      ? `${loadedVariantCount} variantes`
      : 'Variantes'

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
        </div>
        <div className="mt-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</h3>
            {product.brandName && (
              <p className="mt-0.5 text-xs text-muted-foreground">{product.brandName}</p>
            )}
            <p className="mt-1 text-base font-bold text-foreground">
              ${currencyFormatter.format(product.salePrice)}
            </p>
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
          {/* Variants badge — visible before hover */}
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
            <Layers className="h-3 w-3" />
            {variantBadgeText}
          </span>
        </div>
        <div className="mt-3 min-w-0">
          <h3 className="line-clamp-2 text-sm font-medium text-foreground">{product.name}</h3>
          {product.brandName && (
            <p className="mt-0.5 text-xs text-muted-foreground">{product.brandName}</p>
          )}
          <p className="mt-1 text-base font-bold text-foreground">
            ${currencyFormatter.format(product.salePrice)}
          </p>
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
          />
        )}
      </div>
    </div>
  )
}
