'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ChevronRight, ImageIcon, LayoutGrid, List, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import ProductCard from '@/components/catalog/ProductCard'

import type { CatalogProduct } from '@/components/catalog/types'
import type { ProductFilterValue } from '@/components/shared/ProductFilter'
import { EMPTY_FILTER } from '@/components/shared/ProductFilter'

type ViewMode = 'grid' | 'list'

interface ProductGridProps {
  slug: string
  products: CatalogProduct[]
  filterValue: ProductFilterValue
  onFilterChange: (next: ProductFilterValue) => void
  onAddToCart: (product: CatalogProduct, variantId: string | null, variantLabel: string | null) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  onToggleFilter: () => void
  isFilterOpen: boolean
  activeFilterCount: number
}

const currencyFormatter = new Intl.NumberFormat('es-AR')

function ListItemImage({ imageUrl, name }: { imageUrl: string; name: string }) {
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
        sizes="56px"
        onLoad={() => setLoaded(true)}
      />
    </>
  )
}

function applyFilters(products: CatalogProduct[], f: ProductFilterValue): CatalogProduct[] {
  const query = f.search.trim().toLowerCase()
  const priceMin = f.priceMin !== '' ? Number(f.priceMin) : null
  const priceMax = f.priceMax !== '' ? Number(f.priceMax) : null
  const hasVariantFilter = Object.values(f.variantAttributes).some(arr => arr.length > 0)

  let result = products.filter(product => {
    if (query && !product.name.toLowerCase().includes(query)) return false
    if (f.categoryIds.length > 0) {
      if (!product.categoryId || !f.categoryIds.includes(product.categoryId)) return false
    }
    if (f.brandIds.length > 0) {
      if (!product.brandId || !f.brandIds.includes(product.brandId)) return false
    }
    if (priceMin !== null && product.salePrice < priceMin) return false
    if (priceMax !== null && product.salePrice > priceMax) return false
    if (hasVariantFilter && !product.hasVariants) return false
    return true
  })

  result = [...result].sort((a, b) => {
    switch (f.sortField) {
      case 'name-asc':   return a.name.localeCompare(b.name, 'es')
      case 'name-desc':  return b.name.localeCompare(a.name, 'es')
      case 'price-asc':  return a.salePrice - b.salePrice
      case 'price-desc': return b.salePrice - a.salePrice
      default:           return a.name.localeCompare(b.name, 'es')
    }
  })

  return result
}

export default function ProductGrid({
  slug,
  products,
  filterValue,
  onFilterChange,
  onAddToCart,
  viewMode,
  onViewModeChange,
  onToggleFilter,
  isFilterOpen,
  activeFilterCount,
}: ProductGridProps) {
  const filteredProducts = applyFilters(products, filterValue)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center gap-2">
          {/* Search input */}
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={filterValue.search}
              onChange={e => onFilterChange({ ...filterValue, search: e.target.value })}
              placeholder="Buscar producto..."
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>

          {/* Filters button */}
          <button
            type="button"
            onClick={onToggleFilter}
            className={[
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]',
              isFilterOpen
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border bg-background text-foreground hover:border-primary/40',
            ].join(' ')}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros
            {activeFilterCount > 0 && (
              <span className={[
                'ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                isFilterOpen
                  ? 'bg-primary-foreground/20 text-primary-foreground'
                  : 'bg-primary text-primary-foreground',
              ].join(' ')}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* View mode toggle */}
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              onClick={() => onViewModeChange('grid')}
              aria-label="Vista grilla"
              className={`p-2 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 ${
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('list')}
              aria-label="Vista lista"
              className={`p-2 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 ${
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty states */}
      {products.length === 0 && (
        <div className="rounded-xl border border-border/70 bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">Este catálogo aún no tiene productos publicados.</p>
        </div>
      )}

      {products.length > 0 && filteredProducts.length === 0 && (
        <div className="rounded-xl border border-border/70 bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No se encontraron productos.</p>
          <button
            type="button"
            onClick={() => onFilterChange(EMPTY_FILTER)}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {/* Grid view — uses ProductCard with hover quick selector */}
      {filteredProducts.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredProducts.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              slug={slug}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      )}

      {/* List view — inline, no hover panel */}
      {filteredProducts.length > 0 && viewMode === 'list' && (
        <div className="space-y-2">
          {filteredProducts.map(product => {
            const isOutOfStock = product.hasVariants ? false : product.stock <= 0

            return (
              <Link
                key={product.id}
                href={`/catalogo/${slug}/${product.id}`}
                className={`flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 hover:border-primary/40 transition-[transform,border-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] ${isOutOfStock ? 'opacity-60' : ''}`}
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                  {product.imageUrl ? (
                    <ListItemImage imageUrl={product.imageUrl} name={product.name} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-foreground">{product.name}</h3>
                  <p className="mt-0.5 text-sm font-bold text-foreground">
                    {product.originalPrice !== null && (
                      <span className="mr-1.5 text-xs font-medium text-muted-foreground line-through">
                        ${currencyFormatter.format(product.originalPrice)}
                      </span>
                    )}
                    <span className={product.originalPrice !== null ? 'text-emerald-600 dark:text-emerald-400' : undefined}>
                      ${currencyFormatter.format(product.salePrice)}
                    </span>
                    {product.promo && (
                      <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        {product.promo.label}
                      </span>
                    )}
                  </p>
                  {isOutOfStock && (
                    <span className="mt-0.5 inline-block rounded-md bg-destructive/90 px-2 py-0.5 text-xs font-medium text-destructive-foreground">
                      Sin stock
                    </span>
                  )}
                </div>
                {product.hasVariants ? (
                  <span className="flex items-center gap-1 text-xs text-primary font-medium shrink-0">
                    Ver variantes <ChevronRight className="h-3 w-3" />
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={e => { e.preventDefault(); onAddToCart(product, null, null) }}
                    disabled={isOutOfStock}
                    aria-label={`Agregar ${product.name} al carrito`}
                    className="shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
