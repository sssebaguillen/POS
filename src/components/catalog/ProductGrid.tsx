'use client'

import Image from 'next/image'
import { ImageIcon, LayoutGrid, List, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { CatalogCategory, CatalogProduct } from '@/components/catalog/types'

type ViewMode = 'grid' | 'list'
type SortBy = 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc'

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Nombre A-Z' },
  { value: 'name-desc', label: 'Nombre Z-A' },
  { value: 'price-asc', label: 'Precio menor' },
  { value: 'price-desc', label: 'Precio mayor' },
]

interface ProductGridProps {
  products: CatalogProduct[]
  categories: CatalogCategory[]
  selectedCategory: string | null
  onSelectCategory: (categoryId: string | null) => void
  onAddToCart: (product: CatalogProduct) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  sortBy: SortBy
  onSortChange: (sort: SortBy) => void
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

function sortProducts(products: CatalogProduct[], sortBy: SortBy): CatalogProduct[] {
  return [...products].sort((a, b) => {
    switch (sortBy) {
      case 'name-asc':  return a.name.localeCompare(b.name, 'es')
      case 'name-desc': return b.name.localeCompare(a.name, 'es')
      case 'price-asc':  return a.price - b.price
      case 'price-desc': return b.price - a.price
    }
  })
}

export default function ProductGrid({
  products,
  categories,
  selectedCategory,
  onSelectCategory,
  onAddToCart,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
}: ProductGridProps) {
  const query = searchQuery.trim().toLowerCase()

  const filteredProducts = sortProducts(
    products.filter(product => {
      const matchesCategory = selectedCategory === null || product.categoryId === selectedCategory
      const matchesSearch = query === '' || product.name.toLowerCase().includes(query)
      return matchesCategory && matchesSearch
    }),
    sortBy
  )

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Buscar productos..."
          className="pl-9"
        />
      </div>

      {/* Categories + toolbar */}
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Categorias</p>
          <div className="flex items-center gap-2">
            <div className="w-36">
              <SelectDropdown
                value={sortBy}
                onChange={value => onSortChange(value as SortBy)}
                options={SORT_OPTIONS}
                usePortal
              />
            </div>
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
            onClick={() => onSelectCategory(null)}
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
              onClick={() => onSelectCategory(category.id)}
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
          <p className="text-sm text-muted-foreground">Este catalogo aun no tiene productos publicados.</p>
        </div>
      )}

      {products.length > 0 && filteredProducts.length === 0 && (
        <div className="rounded-xl border border-border/70 bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No se encontraron productos.</p>
        </div>
      )}

      {/* Grid view */}
      {filteredProducts.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredProducts.map(product => {
            const isOutOfStock = product.stock <= 0

            return (
              <article
                key={product.id}
                className={`rounded-xl border border-border/70 bg-card p-3 ${isOutOfStock ? 'opacity-60' : ''}`}
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
                      ${currencyFormatter.format(product.price)}
                    </p>
                  </div>

                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={() => onAddToCart(product)}
                    disabled={isOutOfStock}
                    aria-label={`Agregar ${product.name} al carrito`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* List view */}
      {filteredProducts.length > 0 && viewMode === 'list' && (
        <div className="space-y-2">
          {filteredProducts.map(product => {
            const isOutOfStock = product.stock <= 0

            return (
              <article
                key={product.id}
                className={`flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 ${isOutOfStock ? 'opacity-60' : ''}`}
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/40">
                  {product.imageUrl ? (
                    <ProductImage
                      imageUrl={product.imageUrl}
                      name={product.name}
                      sizes="56px"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-foreground">{product.name}</h3>
                  <p className="mt-0.5 text-sm font-bold text-foreground">
                    ${currencyFormatter.format(product.price)}
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
                  onClick={() => onAddToCart(product)}
                  disabled={isOutOfStock}
                  aria-label={`Agregar ${product.name} al carrito`}
                  className="shrink-0"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}