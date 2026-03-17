'use client'

import Image from 'next/image'
import { ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CatalogThemeToggle } from '@/components/catalogo/CatalogThemeProvider'
import type { CatalogBusiness } from '@/components/catalogo/types'

interface CatalogHeaderProps {
  business: CatalogBusiness
  cartCount: number
  onToggleMobileCart: () => void
}

export default function CatalogHeader({ business, cartCount, onToggleMobileCart }: CatalogHeaderProps) {
  return (
    <section className="rounded-xl border border-border/70 bg-card p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          {business.logoUrl ? (
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-border/70">
              <Image
                src={business.logoUrl}
                alt={business.name}
                fill
                unoptimized
                className="object-cover"
                sizes="48px"
              />
            </div>
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
              {business.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-foreground md:text-2xl">{business.name}</h1>
            {business.description && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{business.description}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <CatalogThemeToggle />
          <Button
            type="button"
            variant="outline"
            className="lg:hidden"
            onClick={onToggleMobileCart}
          >
            <ShoppingCart className="mr-1 h-4 w-4" />
            Carrito ({cartCount})
          </Button>
        </div>
      </div>
    </section>
  )
}
