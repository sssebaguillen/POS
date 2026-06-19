'use client'

import Link from 'next/link'
import { ArrowLeft, SealPercent } from '@phosphor-icons/react/dist/ssr'
import ProductCard from '@/components/catalog/ProductCard'
import { useCatalogShell } from '@/components/catalog/CatalogShell'
import type { CatalogProduct } from '@/components/catalog/types'

interface PromotionsViewProps {
  slug: string
  products: CatalogProduct[]
}

export default function PromotionsView({ slug, products }: PromotionsViewProps) {
  const { business, addToCart } = useCatalogShell()

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <Link
          href={`/catalogo/${slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al catálogo
        </Link>

        <h2 className="mt-4 flex items-center gap-2 text-xl font-bold text-promo">
          <SealPercent className="h-5 w-5" />
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
