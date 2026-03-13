'use client'

import Image from 'next/image'
import { ImageIcon, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface CatalogProduct {
  id: string
  categoryId: string | null
  name: string
  price: number
  stock: number
  imageUrl: string | null
}

interface CatalogCategory {
  id: string
  name: string
}

interface ProductGridProps {
  products: CatalogProduct[]
  categories: CatalogCategory[]
  selectedCategory: string | null
  onSelectCategory: (categoryId: string | null) => void
  onAddToCart: (product: CatalogProduct) => void
}

const currencyFormatter = new Intl.NumberFormat('es-AR')

export default function ProductGrid({
  products,
  categories,
  selectedCategory,
  onSelectCategory,
  onAddToCart,
}: ProductGridProps) {
  const filteredProducts = selectedCategory
    ? products.filter(product => product.categoryId === selectedCategory)
    : products

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Categorias</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSelectCategory(null)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              selectedCategory === null
                ? 'border-primary bg-primary text-primary-foreground'
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
                  ? 'border-primary bg-primary text-primary-foreground'
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
          <p className="text-sm text-muted-foreground">No hay productos para la categoria seleccionada.</p>
        </div>
      )}

      {filteredProducts.length > 0 && (
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
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      fill
                      unoptimized
                      className="object-cover"
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
    </div>
  )
}