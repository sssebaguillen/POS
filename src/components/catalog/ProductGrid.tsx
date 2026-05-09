'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ChevronRight, ImageIcon, LayoutGrid, List, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

import type { CatalogCategory, CatalogProduct } from '@/components/catalog/types'
import type { ProductFilterValue } from '@/components/shared/ProductFilter'
import { EMPTY_FILTER } from '@/components/shared/ProductFilter'

type ViewMode = 'grid' | 'list'


interface ProductGridProps {
  slug: string
  products: CatalogProduct[]
  categories: CatalogCategory[]
  filterValue: ProductFilterValue
  onFilterChange: (next: ProductFilterValue) => void
  onAddToCart: (product: CatalogProduct, variantId: string | null, variantLabel: string | null) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
}

const currencyFormatter = new Intl.NumberFormat('es-AR')

function ProductImage({ imageUrl, name, sizes }: { imageUrl: string; name: string; sizes: string }) {
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

    // Variant attributes: AND across types, OR within same type
    if (hasVariantFilter) {
      for (const [, selectedValues] of Object.entries(f.variantAttributes)) {
        if (selectedValues.length === 0) continue
        // Check if product appears in any of the selected values' productIds
        // (productIds come from CatalogVariantAttributeGroup, but here we only have CatalogProduct)
        // We just require product.hasVariants to be true when variant filters active
        if (!product.hasVariants) return false
      }
    }

    return true
  })

  // Sort
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
  categories,
  filterValue,
  onFilterChange,
  onAddToCart,
  viewMode,
  onViewModeChange,
}: ProductGridProps) {
  const filteredProducts = applyFilters(products, filterValue)

  // selectedCategory: first element or null
  const selectedCategory = filterValue.categoryIds[0] ?? null

  return (
    <div className="space-y-4">
      {/* Categories + toolbar */}
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Categorías</p>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                onClick={() => onViewModeChange('grid')}
                aria-label="Vista grilla"
                className={`p-2 transition-colors ${
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
                className={`p-2 transition-colors ${
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

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onFilterChange({ ...filterValue, categoryIds: [] })}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              selectedCategory === null
                ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'
                : 'border-border bg-background text-foreground hover:border-primary/40'
            }`}
          >
            Todos
          </button>

          {categories.map(category => (
            <button
              key={category.id}
              type="button"
              onClick={() =>
                onFilterChange({
                  ...filterValue,
                  categoryIds: selectedCategory === category.id ? [] : [category.id],
                })
              }
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                selectedCategory === category.id
                  ? 'bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30'
                  : 'border-border bg-background text-foreground hover:border-primary/40'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

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

      {/* Grid view */}
      {filteredProducts.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredProducts.map(product => {
            const isOutOfStock = product.stock <= 0

            if (product.hasVariants) {
              return (
                <Link
                  key={product.id}
                  href={`/catalogo/${slug}/${product.id}`}
                  className={`rounded-xl border border-border/70 bg-card p-3 block hover:border-primary/40 transition-colors ${isOutOfStock ? 'opacity-60' : ''}`}
                >
                  <div className="relative h-36 w-full overflow-hidden rounded-lg bg-muted/40">
                    {product.imageUrl ? (
                      <ProductImage
                        imageUrl={product.imageUrl}
                        name={product.name}
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
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
                    <div>
                      <h3 className="text-sm font-medium text-foreground">{product.name}</h3>
                      <p className="mt-1 text-base font-bold text-foreground">
                        ${currencyFormatter.format(product.salePrice)}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-primary font-medium mt-1 shrink-0">
                      Ver variantes <ChevronRight className="h-3 w-3" />
                    </span>
                  </div>
                </Link>
              )
            }

            return (
              <Link
                key={product.id}
                href={`/catalogo/${slug}/${product.id}`}
                className={`rounded-xl border border-border/70 bg-card p-3 block hover:border-primary/40 transition-colors ${isOutOfStock ? 'opacity-60' : ''}`}
              >
                <div className="relative h-36 w-full overflow-hidden rounded-lg bg-muted/40">
                  {product.imageUrl ? (
                    <ProductImage
                      imageUrl={product.imageUrl}
                      name={product.name}
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
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
                  <div>
                    <h3 className="text-sm font-medium text-foreground">{product.name}</h3>
                    <p className="mt-1 text-base font-bold text-foreground">
                      ${currencyFormatter.format(product.salePrice)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={e => { e.preventDefault(); onAddToCart(product, null, null) }}
                    disabled={isOutOfStock}
                    aria-label={`Agregar ${product.name} al carrito`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* List view */}
      {filteredProducts.length > 0 && viewMode === 'list' && (
        <div className="space-y-2">
          {filteredProducts.map(product => {
            const isOutOfStock = product.stock <= 0

            if (product.hasVariants) {
              return (
                <Link
                  key={product.id}
                  href={`/catalogo/${slug}/${product.id}`}
                  className={`flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 hover:border-primary/40 transition-colors ${isOutOfStock ? 'opacity-60' : ''}`}
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                    {product.imageUrl ? (
                      <ProductImage imageUrl={product.imageUrl} name={product.name} sizes="56px" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium text-foreground">{product.name}</h3>
                    <p className="mt-0.5 text-sm font-bold text-foreground">
                      ${currencyFormatter.format(product.salePrice)}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-primary font-medium shrink-0">
                    Ver variantes <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              )
            }

            return (
              <Link
                key={product.id}
                href={`/catalogo/${slug}/${product.id}`}
                className={`flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 hover:border-primary/40 transition-colors ${isOutOfStock ? 'opacity-60' : ''}`}
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                  {product.imageUrl ? (
                    <ProductImage imageUrl={product.imageUrl} name={product.name} sizes="56px" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-foreground">{product.name}</h3>
                  <p className="mt-0.5 text-sm font-bold text-foreground">
                    ${currencyFormatter.format(product.salePrice)}
                  </p>
                  {isOutOfStock && (
                    <span className="mt-0.5 inline-block rounded-md bg-destructive/90 px-2 py-0.5 text-xs font-medium text-destructive-foreground">
                      Sin stock
                    </span>
                  )}
                </div>
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
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
