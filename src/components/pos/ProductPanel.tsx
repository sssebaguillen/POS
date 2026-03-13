'use client'

import { useCartStore } from '@/lib/store/cart.store'
import type { Product } from '@/lib/types'

interface Category {
  id: string
  name: string
  icon: string
}

interface ProductWithCategory extends Product {
  categories?: { name: string; icon: string } | null
}

interface Props {
  products: ProductWithCategory[]
  categories: Category[]
  search: string
}

export default function ProductPanel({ products, search }: Props) {
  const addItem = useCartStore(s => s.addItem)

  const filtered = products.filter(p => {
    if (search === '') return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.barcode === search ||
      p.sku?.toLowerCase().includes(q)
    )
  })

  const topSellers = filtered.filter(p => p.sales_count > 0).slice(0, 8)
  const isSearching = search.trim().length > 0

  function handleAdd(product: Product) {
    addItem(product)
  }

  return (
    <div className="p-6 space-y-6">
      {/* Más vendidos */}
      {topSellers.length > 0 && !isSearching && (
        <section>
          <p className="text-xs font-semibold text-hint uppercase tracking-wider mb-3">
            Más vendidos — últimos 30 días
          </p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {topSellers.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={handleAdd}
              />
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
          <div className="rounded-2xl bg-surface border border-edge/60 p-12 text-center text-hint">
            <p className="text-sm">No se encontraron productos</p>
            {search && (
              <p className="text-xs mt-1">Intentá con otro término o código</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {filtered.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                onAdd={handleAdd}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ProductCard({
  product,
  onAdd,
}: {
  product: ProductWithCategory
  onAdd: (p: Product) => void
}) {
  const disabled = product.stock === 0

  return (
    <button
      onClick={() => onAdd(product)}
      disabled={disabled}
      className="group relative text-left p-4 rounded-2xl border border-edge/60 bg-surface hover:border-emerald-600 hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed min-w-[120px]"
    >
      {/* Category marker */}
      <div className="text-3xl mb-3 leading-none">
        {product.categories?.icon ?? 'CAT'}
      </div>

      {/* Name */}
      <p className="text-sm font-medium text-heading leading-tight line-clamp-2 mb-1">
        {product.name}
      </p>

      {/* Price */}
      <p className="text-sm font-bold text-heading">
        ${product.price.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
      </p>

      {/* Stock badge */}
      {product.stock === 0 && (
        <span className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
          Sin stock
        </span>
      )}
      {product.stock > 0 && product.stock <= product.min_stock && (
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400" />
      )}
    </button>
  )
}
