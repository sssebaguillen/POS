'use client'

import Image from 'next/image'
import { Box } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCartStore } from '@/lib/store/cart.store'
import { calculateProductPrice } from '@/lib/price-lists'
import type { Product } from '@/lib/types'
import type { ProductWithCategory, ActiveFilter } from '@/components/pos/types'
import type { PriceList, PriceListOverride } from '@/lib/types'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

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
  const formatMoney = useFormatMoney()

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
            Más vendidos, últimos 30 días
          </p>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {topSellers.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                activePriceList={activePriceList}
                priceListOverrides={priceListOverrides}
                onAdd={handleAdd}
                formatMoney={formatMoney}
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
  onAdd: (product: Product) => void
  formatMoney: (v: number) => string
}

function PaginatedProductGrid({
  products,
  activePriceList,
  priceListOverrides,
  onAdd,
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
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {visibleProducts.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            onAdd={onAdd}
            formatMoney={formatMoney}
          />
        ))}
      </div>
      <div ref={sentinelRef} />
      {visibleCount < products.length && (
        <p className="py-4 text-center text-xs text-subtle">
          Mostrando {visibleCount} de {products.length}. Seguí scrolleando para ver más.
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
  formatMoney,
}: {
  product: ProductWithCategory
  activePriceList: PriceList | null
  priceListOverrides: PriceListOverride[]
  onAdd: (p: Product) => void
  formatMoney: (v: number) => string
}) {
  const displayPrice = activePriceList
    ? calculateProductPrice(product.cost, product.price, product.id, product.brand_id, activePriceList, priceListOverrides)
    : product.price

  const stockLabel = product.stock === 0
    ? 'Sin stock'
    : product.stock > 0 && product.stock <= product.min_stock
      ? 'Stock bajo'
      : null

  return (
    <button
      onClick={() => onAdd(product)}
      aria-label={`${product.name}, ${formatMoney(displayPrice)}${stockLabel ? `, ${stockLabel}` : ''}`}
      className="group relative text-left p-4 rounded-2xl border border-edge/60 bg-surface hover:border-primary/50 hover:shadow-md transition-all flex flex-col"
    >
      {/* Image or category marker */}
      {product.image_url ? (
        <div className="relative w-full h-20 mb-3 rounded-md overflow-hidden shrink-0">
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 140px"
            className="object-cover"
            unoptimized={product.image_source === 'url'}
          />
        </div>
      ) : (
        <div className="h-10 mb-3 flex items-center text-3xl leading-none">
          {product.categories?.icon
            ? <span>{product.categories.icon}</span>
            : <Box size={28} className="text-hint" />
          }
        </div>
      )}

      {/* Name */}
      <p className="text-sm font-medium text-heading leading-tight line-clamp-2 mb-1 flex-1">
        {product.name}
      </p>

      {/* Price */}
      <p className="text-sm font-bold text-heading">
        {formatMoney(displayPrice)}
      </p>

      {stockLabel && (
        <span
          aria-hidden="true"
          className={`absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
            product.stock === 0
              ? 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
          }`}
        >
          {stockLabel}
        </span>
      )}
    </button>
  )
})
