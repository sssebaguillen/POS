'use client'

import Image from 'next/image'
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCartStore } from '@/lib/store/cart.store'
import { resolveDisplayPrice } from '@/lib/price-lists'
import { applyUnitPromo, findApplicablePromo, promoBadgeLabel, type Promotion } from '@/lib/promotions'
import type { Product, ProductWithVariants, ProductVariant } from '@/lib/types'
import type { ProductWithCategory, ActiveFilter } from '@/components/pos/types'
import type { PriceList, PriceListOverride } from '@/lib/types'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import PopNumber from '@/components/shared/PopNumber'
import { createClient } from '@/lib/supabase/client'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const PAGE_SIZE = 80

const CATEGORY_PALETTE_SIZE = 6

function hashCategoryIndex(categoryId: string | null): number {
  if (!categoryId) return 0
  let hash = 0
  for (let i = 0; i < categoryId.length; i++) {
    hash = (hash * 31 + categoryId.charCodeAt(i)) >>> 0
  }
  return hash % CATEGORY_PALETTE_SIZE
}

interface Props {
  products: ProductWithCategory[]
  search: string
  activeFilter: ActiveFilter
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  promotions: Promotion[]
}

export default function ProductPanel({ products, search, activeFilter, activePriceList, priceListOverrides, promotions }: Props) {
  const addItem = useCartStore(s => s.addItem)
  const addVariantItem = useCartStore(s => s.addVariantItem)
  const formatMoney = useFormatMoney()

  const filtered = useMemo(() => {
    let result = products
    if (activeFilter?.type === 'category') {
      result = result.filter(p => p.category_id === activeFilter.id)
    } else if (activeFilter?.type === 'brand') {
      result = result.filter(p => p.brand_id === activeFilter.id)
    }
    if (!search) return result
    const q = search.toLowerCase()
    return result.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.barcode === search ||
      p.sku?.toLowerCase().includes(q)
    )
  }, [products, search, activeFilter])

  const topSellers = useMemo(
    () => filtered.filter(p => p.sales_count > 0).slice(0, 6),
    [filtered]
  )

  const sortedProducts = useMemo(
    () => [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [filtered]
  )

  const isSearching = search.trim().length > 0
  const paginationKey = `${search}|${activeFilter?.type ?? 'all'}|${activeFilter?.id ?? 'all'}`

  const handleAdd = useCallback((product: Product) => {
    addItem(product)
  }, [addItem])

  const handleAddVariant = useCallback((product: ProductWithCategory, variant: ProductVariant, label: string) => {
    addVariantItem(product, variant, label)
  }, [addVariantItem])

  return (
    <div className="p-6 space-y-6">
      {/* Más vendidos */}
      {topSellers.length > 0 && !isSearching && !activeFilter && (
        <section>
          <p className="text-xs font-semibold text-hint uppercase tracking-wider mb-3">
            Más vendidos, últimos 30 días
          </p>
          <div className="flex gap-3 overflow-x-auto">
            {topSellers.map((product, index) => (
              <div key={product.id} className="w-40 shrink-0 flex">
                <ProductCard
                  product={product}
                  index={index}
                  activePriceList={activePriceList}
                  priceListOverrides={priceListOverrides}
                  promotions={promotions}
                  onAdd={handleAdd}
                  onAddVariant={handleAddVariant}
                  formatMoney={formatMoney}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Todos los productos */}
      <section>
        <p className="text-xs font-semibold text-hint uppercase tracking-wider mb-3">
          {isSearching ? `Resultados para "${search}"` : 'Todos los productos'}
        </p>
        {filtered.length === 0 ? (
          <div className="surface-card p-12 text-center text-hint">
            <p className="text-sm">No se encontraron productos</p>
            {search && (
              <p className="text-xs mt-1">Intenta con otro término o código</p>
            )}
          </div>
        ) : (
          <PaginatedProductGrid
            key={paginationKey}
            products={sortedProducts}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            promotions={promotions}
            onAdd={handleAdd}
            onAddVariant={handleAddVariant}
            formatMoney={formatMoney}
          />
        )}
      </section>
    </div>
  )
}

interface PaginatedProductGridProps {
  products: ProductWithCategory[]
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  promotions: Promotion[]
  onAdd: (product: Product) => void
  onAddVariant: (product: ProductWithCategory, variant: ProductVariant, label: string) => void
  formatMoney: (v: number) => string
}

function PaginatedProductGrid({
  products,
  activePriceList,
  priceListOverrides,
  promotions,
  onAdd,
  onAddVariant,
  formatMoney,
}: PaginatedProductGridProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount(prev => prev + PAGE_SIZE)
        }
      },
      { rootMargin: '300px' }
    )

    observer.observe(sentinel)

    return () => observer.disconnect()
  }, [])

  const visibleProducts = useMemo(
    () => products.slice(0, visibleCount),
    [products, visibleCount]
  )

  return (
    <>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {visibleProducts.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            index={index}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            promotions={promotions}
            onAdd={onAdd}
            onAddVariant={onAddVariant}
            formatMoney={formatMoney}
          />
        ))}
      </div>
      <div ref={sentinelRef} />
      {visibleCount < products.length && (
        <p className="py-4 text-center text-xs text-subtle">
          Mostrando {visibleCount} de {products.length}. Sigue desplazándote para ver más.
        </p>
      )}
    </>
  )
}

function CategorySwatch({ categoryId, brandName }: { categoryId: string | null; brandName: string | null }) {
  const idx = hashCategoryIndex(categoryId)
  return (
    <div
      className="w-full h-20 mb-3 rounded-md shrink-0 flex items-center justify-center"
      style={{ backgroundColor: `var(--cat-${idx})` }}
    >
      {brandName && (
        <span className="text-xs text-hint font-medium truncate px-2 text-center leading-tight">
          {brandName}
        </span>
      )}
    </div>
  )
}

// ─── Variant selector popover content ────────────────────────────────────────

function VariantSelectorContent({
  product,
  activePriceList,
  priceListOverrides,
  promo,
  onAdd,
  onClose,
  onVariantImageChange,
  formatMoney,
}: {
  product: ProductWithCategory
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  promo: Promotion | null
  onAdd: (variant: ProductVariant, label: string) => void
  onClose: () => void
  onVariantImageChange: (imageUrl: string | null) => void
  formatMoney: (v: number) => string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [data, setData] = useState<ProductWithVariants | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({})

  useEffect(() => {
    startTransition(() => {
      setLoading(true)
    })
    supabase.rpc('get_product_with_variants', { p_product_id: product.id }).then(({ data: rpc }) => {
      setLoading(false)
      if (rpc) setData(rpc as ProductWithVariants)
    })
  }, [product.id, supabase])

  const allSelected = data
    ? data.options.every(o => selectedValues[o.id])
    : false

  const matchedVariant = useMemo<ProductVariant | null>(() => {
    if (!data || !allSelected) return null
    return data.variants.find(v =>
      v.is_active &&
      v.option_values.every(ov => selectedValues[ov.option_id] === ov.option_value_id)
    ) ?? null
  }, [data, allSelected, selectedValues])

  const matchedPrice = useMemo(() => {
    if (!matchedVariant) return null
    const base = resolveDisplayPrice({
      cost: Number(matchedVariant.cost),
      price: Number(matchedVariant.price),
      productId: product.id,
      brandId: product.brand_id,
      priceList: activePriceList,
      overrides: priceListOverrides,
      variantPrice: Number(matchedVariant.price),
    })
    return promo ? applyUnitPromo(promo, base) : base
  }, [matchedVariant, product.id, product.brand_id, activePriceList, priceListOverrides, promo])

  const minVariantPrice = useMemo(() => {
    if (!data) return null
    const prices = data.variants
      .filter(v => v.is_active)
      .map(v => {
        const variantPrice = Number(v.price)
        const variantCost = Number(v.cost)
        const base = resolveDisplayPrice({
          cost: variantCost,
          price: variantPrice,
          productId: product.id,
          brandId: product.brand_id,
          priceList: activePriceList,
          overrides: priceListOverrides,
          variantPrice,
        })
        return promo ? applyUnitPromo(promo, base) : base
      })
      .filter(p => Number.isFinite(p) && p > 0)
    return prices.length > 0 ? Math.min(...prices) : null
  }, [data, activePriceList, priceListOverrides, product.id, product.brand_id, promo])

  const displayImage = useMemo(() => {
    if (!data) return null
    return (
      matchedVariant?.image_url ??
      data.variants.find(v => v.stock > 0 && v.image_url)?.image_url ??
      data.variants.find(v => v.image_url)?.image_url ??
      null
    )
  }, [data, matchedVariant])

  useEffect(() => {
    onVariantImageChange(displayImage)
  }, [displayImage, onVariantImageChange])

  function selectValue(optionId: string, valueId: string) {
    setSelectedValues(prev => ({ ...prev, [optionId]: valueId }))
  }

  function handleAdd() {
    if (!matchedVariant || !data) return
    const label = data.options.map(o => {
      const ov = matchedVariant.option_values.find(v => v.option_id === o.id)
      return ov?.value ?? ''
    }).filter(Boolean).join(' / ')
    onAdd(matchedVariant, label)
    onClose()
  }

  if (loading) {
    return (
      <div className="p-4 text-xs text-hint text-center">Cargando variantes…</div>
    )
  }

  if (!data || data.options.length === 0) {
    return (
      <div className="p-4 text-xs text-hint text-center">Sin variantes disponibles</div>
    )
  }

  return (
    <div className="p-3 space-y-3 w-56">
      <p className="text-sm font-semibold text-heading leading-tight line-clamp-2">
        {product.name}
      </p>

      {data.options.map(option => (
        <div key={option.id}>
          <p className="text-[10px] font-semibold text-subtle uppercase tracking-wider mb-1.5">
            {option.name}
          </p>
          <div className="flex flex-wrap gap-1">
            {option.values.map(val => {
              const isSelected = selectedValues[option.id] === val.id

              return (
                <button
                  key={val.id}
                  type="button"
                  onClick={() => selectValue(option.id, val.id)}
                  className={[
                    'px-2 py-1 rounded-lg border text-xs font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]',
                    isSelected
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-edge text-body bg-surface hover:border-primary/50 hover:bg-primary/5',
                  ].join(' ')}
                >
                  {val.value}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <p className="text-sm font-semibold text-heading tabular-nums min-h-5">
        {matchedPrice != null ? (
          <PopNumber value={formatMoney(matchedPrice)} />
        ) : minVariantPrice != null ? (
          `Desde ${formatMoney(minVariantPrice)}`
        ) : ''}
      </p>

      <button
        type="button"
        disabled={!allSelected}
        onClick={handleAdd}
        className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 hover:bg-primary/90 transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
      >
        Agregar al carrito
      </button>
    </div>
  )
}

// ─── Product card ─────────────────────────────────────────────────────────────

const ProductCard = memo(function ProductCard({
  product,
  index,
  activePriceList,
  priceListOverrides,
  promotions,
  onAdd,
  onAddVariant,
  formatMoney,
}: {
  product: ProductWithCategory
  index: number
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  promotions: Promotion[]
  onAdd: (p: Product) => void
  onAddVariant: (p: ProductWithCategory, v: ProductVariant, label: string) => void
  formatMoney: (v: number) => string
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [hoveredVariantImage, setHoveredVariantImage] = useState<string | null>(null)

  const rawPrice = resolveDisplayPrice({
    cost: product.cost,
    price: product.price,
    productId: product.id,
    brandId: product.brand_id,
    priceList: activePriceList,
    overrides: priceListOverrides,
  })
  const basePrice = Number.isFinite(rawPrice) ? rawPrice : (product.price ?? 0)
  const promo = findApplicablePromo({
    promotions,
    productId: product.id,
    categoryId: product.category_id,
    brandId: product.brand_id,
  })
  const promoUnitPrice = promo ? applyUnitPromo(promo, basePrice) : basePrice
  const hasUnitPromo = promo !== null && promoUnitPrice < basePrice
  const displayPrice = hasUnitPromo ? promoUnitPrice : basePrice
  const promoLabel = promo ? promoBadgeLabel(promo) : null

  const displayName = product.name || 'Sin nombre'

  const stockLabel = !product.has_variants && product.stock === 0
    ? 'Sin stock'
    : !product.has_variants && product.stock > 0 && product.stock <= product.min_stock
      ? 'Stock bajo'
      : null

  const variantStockTone: 'zero' | 'low' | 'ok' = product.has_variants
    ? product.stock === 0
      ? 'zero'
      : product.stock <= product.min_stock
        ? 'low'
        : 'ok'
    : 'ok'

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (product.has_variants) {
      setPopoverOpen(true)
    } else {
      onAdd(product)
      e.currentTarget.blur()
    }
  }

  const cardContent = (
    <button
      onClick={handleClick}
      aria-label={`${displayName}, ${formatMoney(displayPrice)}${stockLabel ? `, ${stockLabel}` : ''}`}
      className={[
        'group relative text-left p-4 rounded-2xl border border-edge/60 bg-surface hover:border-primary/50 transition-[transform,border-color,box-shadow] duration-150 ease-[var(--ease-out)] active:scale-[0.97] flex flex-col w-full',
        product.has_variants ? 'ring-0 hover:ring-1 hover:ring-primary/20' : '',
      ].join(' ')}
    >
      {/* Top zone */}
      {(hoveredVariantImage ?? product.image_url) ? (
        <div className="relative w-full h-20 mb-3 rounded-md overflow-hidden shrink-0">
          <Image
            src={(hoveredVariantImage ?? product.image_url)!}
            alt={displayName}
            fill
            sizes="(max-width: 768px) 50vw, 140px"
            className="object-cover"
            unoptimized={product.image_source === 'url'}
            priority={index === 0}
          />
        </div>
      ) : (
        <CategorySwatch
          categoryId={product.category_id}
          brandName={product.brand?.name ?? null}
        />
      )}

      {/* Name */}
      <p
        title={displayName}
        className={`text-sm font-semibold text-heading leading-snug line-clamp-2 mb-1 flex-1${stockLabel || product.has_variants ? ' pr-12' : ''}`}
      >
        {displayName}
      </p>

      {/* Price */}
      <p className="text-sm font-medium text-body tabular-nums">
        {hasUnitPromo && (
          <span className="text-xs text-muted-foreground line-through mr-1.5">
            {formatMoney(basePrice)}
          </span>
        )}
        <span className={hasUnitPromo ? 'text-promo font-semibold' : undefined}>
          {product.has_variants ? 'Desde ' : ''}{formatMoney(displayPrice)}
        </span>
      </p>

      {promoLabel && (
        <span
          aria-hidden="true"
          className="absolute top-2 left-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-promo/10 text-promo"
        >
          {promoLabel}
        </span>
      )}

      {stockLabel && (
        <span
          aria-hidden="true"
          className={`absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            product.stock === 0
              ? 'bg-destructive/10 text-destructive'
              : 'bg-warning/10 text-warning'
          }`}
        >
          {stockLabel}
        </span>
      )}

      {product.has_variants && (
        <span
          aria-hidden="true"
          className={`absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            variantStockTone === 'zero'
              ? 'bg-destructive/10 text-destructive'
              : variantStockTone === 'low'
                ? 'bg-warning/10 text-warning'
                : 'bg-primary/80 text-primary-foreground border border-primary/20'
          }`}
        >
          Variantes
        </span>
      )}
    </button>
  )

  if (!product.has_variants) {
    return cardContent
  }

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={open => {
        setPopoverOpen(open)
        if (!open) setHoveredVariantImage(null)
      }}
    >
      <PopoverTrigger asChild>
        {cardContent}
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-auto"
        side="bottom"
        align="start"
        sideOffset={4}
        style={{ animation: 'none' }}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <VariantSelectorContent
          product={product}
          activePriceList={activePriceList}
          priceListOverrides={priceListOverrides}
          promo={promo}
          onAdd={(variant, label) => onAddVariant(product, variant, label)}
          onClose={() => setPopoverOpen(false)}
          onVariantImageChange={setHoveredVariantImage}
          formatMoney={formatMoney}
        />
      </PopoverContent>
    </Popover>
  )
})
