'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCartStore } from '@/lib/store/cart.store'
import { calculateProductPrice } from '@/lib/price-lists'
import type { Product } from '@/lib/types'
import type { ProductWithCategory, ActiveFilter } from '@/components/pos/types'
import type { PriceList, PriceListOverride } from '@/components/price-lists/types'

const PAGE_SIZE = 80

interface Props {
  products: ProductWithCategory[]
  search: string
  activeFilter: ActiveFilter
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
}

export default function ProductPanel({ products, search, activeFilter, activePriceList, priceListOverrides }: Props) {
  const addItem = useCartStore(s => s.addItem)

  // IntersectionObserver — load more when sentinel comes into view
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
    () => filtered.filter(p => p.sales_count > 0).slice(0, 8),
    [filtered]
  )

  const isSearching = search.trim().length > 0
  const paginationKey = `${search}|${activeFilter?.type ?? 'all'}|${activeFilter?.id ?? 'all'}`

  const handleAdd = useCallback((product: Product) => {
    addItem(product)
  }, [addItem])

  return (
    <div className="p-6 space-y-6">
      {/* Más vendidos */}
      {topSellers.length > 0 && !isSearching && !activeFilter && (
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
          <PaginatedProductGrid
            key={paginationKey}
            products={filtered}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            onAdd={handleAdd}
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
  onAdd: (product: Product) => void
}

function PaginatedProductGrid({
  products,
  activePriceList,
  priceListOverrides,
  onAdd,
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
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {visibleProducts.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            onAdd={onAdd}
          />
        ))}
      </div>
      <div ref={sentinelRef} />
      {visibleCount < products.length && (
        <p className="py-4 text-center text-xs text-subtle">
          Mostrando {visibleCount} de {products.length} — seguí scrolleando para ver más
        </p>
      )}
    </>
  )
}

const ProductCard = memo(function ProductCard({
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
  const displayPrice = activePriceList
    ? calculateProductPrice(product.cost, product.price, product.id, product.brand_id, activePriceList, priceListOverrides)
    : product.price

  return (
    <button
      onClick={() => onAdd(product)}
      className="group relative text-left p-4 rounded-2xl border border-edge/60 bg-surface hover:border-primary/50 hover:shadow-md transition-all flex flex-col"
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
})
