'use client'

import { useCartStore } from '@/lib/store/cart.store'
import { calculateProductPrice } from '@/lib/price-lists'
import type { Product } from '@/lib/types'
import type { ProductWithCategory } from '@/components/pos/types'
import type { PriceList, PriceListOverride } from '@/components/price-lists/types'

interface Props {
  products: ProductWithCategory[]
  search: string
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
}

export default function ProductPanel({ products, search, activePriceList, priceListOverrides }: Props) {
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
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {topSellers.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                activePriceList={activePriceList}
                priceListOverrides={priceListOverrides}
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
          <div className="surface-card p-12 text-center text-hint">
            <p className="text-sm">No se encontraron productos</p>
            {search && (
              <p className="text-xs mt-1">Intentá con otro término o código</p>
            )}
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {filtered.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                activePriceList={activePriceList}
                priceListOverrides={priceListOverrides}
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
  activePriceList,
  priceListOverrides,
  onAdd,
}: {
  product: ProductWithCategory
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  onAdd: (p: Product) => void
}) {
  const disabled = product.stock === 0

  const displayPrice = activePriceList
    ? calculateProductPrice(product.cost, product.price, product.id, product.brand_id, activePriceList, priceListOverrides)
    : product.price

  return (
    <button
      onClick={() => onAdd(product)}
      disabled={disabled}
      className="group relative text-left p-4 rounded-2xl border border-edge/60 bg-surface hover:border-primary/50 hover:shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed flex flex-col"
    >
      {/* Category marker */}
      <div className="h-10 mb-3 flex items-center text-3xl leading-none">
        {product.categories?.icon ?? 'CAT'}
      </div>

      {/* Name */}
      <p className="text-sm font-medium text-heading leading-tight line-clamp-2 mb-1 flex-1">
        {product.name}
      </p>

      {/* Price */}
      <p className="text-sm font-bold text-heading">
        ${displayPrice.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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
