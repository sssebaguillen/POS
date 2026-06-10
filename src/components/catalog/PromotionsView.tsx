'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BadgePercent } from 'lucide-react'
import CatalogHeader from '@/components/catalog/CatalogHeader'
import ProductCard from '@/components/catalog/ProductCard'
import {
  addItemToStoredCart,
  catalogCartKey,
  getStoredCartCount,
} from '@/lib/catalog-cart'
import type { CatalogBusiness, CatalogProduct } from '@/components/catalog/types'

interface PromotionsViewProps {
  business: CatalogBusiness
  slug: string
  products: CatalogProduct[]
}

export default function PromotionsView({ business, slug, products }: PromotionsViewProps) {
  const router = useRouter()
  const cartKey = catalogCartKey(business.id)
  const [cartCount, setCartCount] = useState(0)

  useEffect(() => {
    setCartCount(getStoredCartCount(cartKey))
  }, [cartKey])

  function addToCart(
    product: CatalogProduct,
    variantId: string | null = null,
    variantLabel: string | null = null,
    variantImageUrl: string | null = null
  ) {
    if (!product.hasVariants && product.stock <= 0) return
    const nextItems = addItemToStoredCart(cartKey, {
      product,
      quantity: 1,
      variantId,
      variantLabel,
      variantImageUrl,
    })
    setCartCount(nextItems.reduce((acc, item) => acc + item.quantity, 0))
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 md:space-y-6">
      <CatalogHeader
        business={business}
        cartCount={cartCount}
        onToggleMobileCart={() => router.push(`/catalogo/${slug}`)}
      />

      <div>
        <Link
          href={`/catalogo/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al catálogo
        </Link>

        <h2 className="mt-4 flex items-center gap-2 text-xl font-bold text-emerald-700 dark:text-emerald-300">
          <BadgePercent className="h-5 w-5" />
          Todas las ofertas
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Productos con promociones vigentes en {business.name}.
        </p>
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No hay ofertas vigentes en este momento.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
          {products.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              slug={slug}
              onAddToCart={addToCart}
            />
          ))}
        </div>
      )}
    </div>
  )
}
