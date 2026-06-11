'use client'

import ProductCard from '@/components/catalog/ProductCard'

import type { CatalogProduct } from '@/components/catalog/types'

interface ProductGridProps {
  slug: string
  products: CatalogProduct[]
  totalCount: number
  onClearFilters: () => void
  onAddToCart: (product: CatalogProduct, variantId: string | null, variantLabel: string | null) => void
}

export default function ProductGrid({
  slug,
  products,
  totalCount,
  onClearFilters,
  onAddToCart,
}: ProductGridProps) {
  if (totalCount === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Este catálogo aún no tiene productos publicados.</p>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">No se encontraron productos con estos filtros.</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-primary transition-colors duration-150 hover:border-primary/40 hover:bg-muted"
        >
          Limpiar filtros
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {products.map(product => (
        <ProductCard
          key={product.id}
          product={product}
          slug={slug}
          onAddToCart={onAddToCart}
        />
      ))}
    </div>
  )
}
