'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BadgePercent, Home, Menu, ShoppingCart } from 'lucide-react'
import { CatalogThemeToggle } from '@/components/catalog/CatalogThemeProvider'
import CatalogSearch from '@/components/catalog/CatalogSearch'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { CatalogBusiness, CatalogCategory, CatalogProduct } from '@/components/catalog/types'

interface CatalogNavbarProps {
  business: CatalogBusiness
  slug: string
  cartCount: number
  onOpenCart: () => void
  /** Datos para el dropdown de búsqueda (si faltan, CatalogSearch los trae lazy) */
  products?: CatalogProduct[]
  categories?: CatalogCategory[]
}

function BusinessAvatar({ business }: { business: CatalogBusiness }) {
  if (business.logoUrl) {
    return (
      <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-border/70">
        <Image
          src={business.logoUrl}
          alt={business.name}
          fill
          className="object-cover"
          sizes="36px"
        />
      </span>
    )
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
      {business.name.charAt(0).toUpperCase()}
    </span>
  )
}

export default function CatalogNavbar({
  business,
  slug,
  cartCount,
  onOpenCart,
  products,
  categories,
}: CatalogNavbarProps) {
  const pathname = usePathname()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const homeUrl = `/catalogo/${slug}`
  const offersUrl = `/catalogo/${slug}/promotions`
  const isOffers = pathname === offersUrl

  const navLinkClass = (active: boolean) =>
    `rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ease-[var(--ease-out)] ${
      active
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-hover-bg hover:text-foreground'
    }`

  const menuLinkClass = (active: boolean) =>
    `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ease-[var(--ease-out)] ${
      active
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-hover-bg hover:text-foreground'
    }`

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-6">
        {/* Hamburger — solo mobile, abre el menú lateral */}
        <button
          type="button"
          onClick={() => setIsMenuOpen(true)}
          aria-label="Abrir menú"
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hover:bg-secondary hover:text-foreground active:scale-95 md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Identidad — link a la home del catálogo */}
        <Link href={homeUrl} className="flex min-w-0 items-center gap-2.5">
          <BusinessAvatar business={business} />
          <span className="truncate text-base font-bold text-foreground">{business.name}</span>
        </Link>

        {/* Search — fila propia en mobile, inline (centro) en md+. Dropdown de
            resultados anclado al input; navega al detalle, no filtra la grilla */}
        <CatalogSearch
          slug={slug}
          products={products}
          categories={categories}
          className="order-last w-full md:order-none md:mx-auto md:w-auto md:max-w-sm md:flex-1"
        />

        {/* Navegación — solo desktop; en mobile vive en el menú lateral */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Secciones del catálogo">
          <Link href={homeUrl} className={navLinkClass(!isOffers)}>
            Inicio
          </Link>
          <Link href={offersUrl} className={navLinkClass(isOffers)}>
            <span className="flex items-center gap-1">
              <BadgePercent className="h-4 w-4" />
              Ofertas
            </span>
          </Link>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
          <CatalogThemeToggle />
          {/* Carrito con badge */}
          <button
            type="button"
            onClick={onOpenCart}
            aria-label={`Abrir carrito (${cartCount} ${cartCount === 1 ? 'producto' : 'productos'})`}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hover:bg-secondary hover:text-foreground active:scale-95"
          >
            <ShoppingCart className="h-4 w-4" />
            {cartCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Menú mobile — sidebar izquierdo */}
      <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader className="border-b border-border">
            <SheetTitle className="flex items-center gap-2.5">
              <BusinessAvatar business={business} />
              <span className="truncate">{business.name}</span>
            </SheetTitle>
          </SheetHeader>
          <nav className="space-y-1 px-3" aria-label="Secciones del catálogo">
            <Link
              href={homeUrl}
              onClick={() => setIsMenuOpen(false)}
              className={menuLinkClass(!isOffers)}
            >
              <Home className="h-4 w-4" />
              Inicio
            </Link>
            <Link
              href={offersUrl}
              onClick={() => setIsMenuOpen(false)}
              className={menuLinkClass(isOffers)}
            >
              <BadgePercent className="h-4 w-4" />
              Ofertas
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  )
}
