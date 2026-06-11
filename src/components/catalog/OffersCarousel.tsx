'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { BadgePercent, ChevronLeft, ChevronRight, ImageIcon, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { promoCountdownLabel } from '@/lib/promotions'
import type { CatalogProduct } from '@/components/catalog/types'

const currencyFormatter = new Intl.NumberFormat('es-AR')
const AUTO_ADVANCE_MS = 6000

interface OffersCarouselProps {
  offers: CatalogProduct[]
  slug: string
  onAddToCart: (
    product: CatalogProduct,
    variantId: string | null,
    variantLabel: string | null,
    variantImageUrl?: string | null
  ) => void
}

function OfferSlide({
  product,
  slug,
  index,
  total,
  onAddToCart,
}: {
  product: CatalogProduct
  slug: string
  index: number
  total: number
  onAddToCart: OffersCarouselProps['onAddToCart']
}) {
  const [added, setAdded] = useState(false)
  const labelRef = useRef<HTMLSpanElement>(null)
  const countdown = product.promo ? promoCountdownLabel(product.promo.endsAt) : null
  const detailUrl = `/catalogo/${slug}/${product.id}`
  const canQuickAdd = !product.hasVariants && product.stock > 0

  // transitions-dev 04 (text states swap), tres fases: exit arriba con blur →
  // swap de textContent + salto abajo sin transición (reflow) → enter a reposo.
  // El span se renderiza con texto estático para que React no pise el textContent.
  function swapText(next: string) {
    const el = labelRef.current
    if (!el) return
    const dur =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur')
      ) || 150
    el.classList.add('is-exit')
    setTimeout(() => {
      el.textContent = next
      el.classList.remove('is-exit')
      el.classList.add('is-enter-start')
      void el.offsetHeight // reflow: garantiza que el enter transicione
      el.classList.remove('is-enter-start')
    }, dur)
  }

  function handleAdd() {
    if (added) return
    onAddToCart(product, null, null)
    setAdded(true)
    swapText('✓ Agregado')
    setTimeout(() => {
      swapText('Agregar al carrito')
      setAdded(false)
    }, 1500)
  }

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`Oferta ${index + 1} de ${total}`}
      className="w-full shrink-0 snap-center px-1"
    >
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,45%)_1fr] sm:gap-6 lg:gap-8">
        {/* Imagen cubre todo el contenedor sin deformar (recorta lo que sobra) */}
        <Link href={detailUrl} className="relative block h-44 w-full overflow-hidden rounded-xl bg-muted/40 sm:h-56 lg:h-72">
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              unoptimized
              className="object-cover"
              sizes="(max-width: 640px) 100vw, 40vw"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-12 w-12" />
            </span>
          )}
        </Link>

        {/* Detalle */}
        <div className="min-w-0 pb-2 sm:py-2">
          {product.promo && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-promo/95 px-2 py-0.5 text-xs font-bold text-promo-foreground shadow-sm">
                {product.promo.label}
              </span>
              {countdown && (
                <span className="text-xs font-medium text-muted-foreground">{countdown}</span>
              )}
            </p>
          )}
          <Link href={detailUrl} className="mt-2 block">
            <h3 className="line-clamp-2 text-lg font-bold text-foreground sm:text-xl lg:text-2xl">
              {product.name}
            </h3>
          </Link>
          {product.brandName && (
            <p className="mt-0.5 text-sm text-muted-foreground">{product.brandName}</p>
          )}
          <p className="mt-2 text-2xl font-bold lg:text-3xl">
            {product.originalPrice !== null && (
              <span className="mr-2 text-base font-medium text-muted-foreground line-through lg:text-lg">
                ${currencyFormatter.format(product.originalPrice)}
              </span>
            )}
            <span className={product.originalPrice !== null ? 'text-promo' : 'text-foreground'}>
              ${currencyFormatter.format(product.salePrice)}
            </span>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canQuickAdd && (
              <Button
                type="button"
                onClick={handleAdd}
                className={`gap-1.5 ${added ? 'bg-promo hover:bg-promo text-promo-foreground' : ''}`}
              >
                <ShoppingCart className="h-4 w-4" />
                <span ref={labelRef} className="t-text-swap">Agregar al carrito</span>
              </Button>
            )}
            <Button asChild type="button" variant={canQuickAdd ? 'outline' : 'default'}>
              <Link href={detailUrl}>Ver producto</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OffersCarousel({ offers, slug, onAddToCart }: OffersCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(media.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const scrollToIndex = useCallback((index: number) => {
    const track = trackRef.current
    if (!track) return
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' })
  }, [])

  // Auto-avance: pausado al interactuar, deshabilitado con reduced-motion o 1 sola oferta
  useEffect(() => {
    if (isPaused || reducedMotion || offers.length < 2) return
    const id = setInterval(() => {
      const track = trackRef.current
      if (!track) return
      const current = Math.round(track.scrollLeft / track.clientWidth)
      scrollToIndex((current + 1) % offers.length)
    }, AUTO_ADVANCE_MS)
    return () => clearInterval(id)
  }, [isPaused, reducedMotion, offers.length, scrollToIndex])

  function handleScroll() {
    const track = trackRef.current
    if (!track) return
    const index = Math.round(track.scrollLeft / track.clientWidth)
    setActiveIndex(Math.max(0, Math.min(index, offers.length - 1)))
  }

  if (offers.length === 0) return null

  return (
    <section
      role="region"
      aria-roledescription="carrusel"
      aria-label="Ofertas destacadas"
      className="offers-highlight relative rounded-xl border p-4"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
    >
      <Link
        href={`/catalogo/${slug}/promotions`}
        className="group mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-promo transition-colors hover:text-promo/80"
      >
        <BadgePercent className="h-4 w-4" />
        Ofertas
        <ChevronRight className="h-4 w-4 transition-transform duration-150 ease-[var(--ease-out)] group-hover:translate-x-0.5" />
      </Link>

      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex snap-x snap-mandatory overflow-x-auto motion-safe:scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {offers.map((product, index) => (
          <OfferSlide
            key={product.id}
            product={product}
            slug={slug}
            index={index}
            total={offers.length}
            onAddToCart={onAddToCart}
          />
        ))}
      </div>

      {offers.length > 1 && (
        <>
          {/* Flechas — solo desktop */}
          <button
            type="button"
            aria-label="Oferta anterior"
            onClick={() => scrollToIndex((activeIndex - 1 + offers.length) % offers.length)}
            className="absolute left-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-card/90 text-foreground shadow-sm transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hover:bg-card active:scale-95 sm:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Oferta siguiente"
            onClick={() => scrollToIndex((activeIndex + 1) % offers.length)}
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-card/90 text-foreground shadow-sm transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hover:bg-card active:scale-95 sm:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* Dots */}
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {offers.map((offer, index) => (
              <button
                key={offer.id}
                type="button"
                aria-label={`Ir a oferta ${index + 1}`}
                aria-current={index === activeIndex}
                onClick={() => scrollToIndex(index)}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ease-[var(--ease-out)] ${
                  index === activeIndex
                    ? 'w-5 bg-promo'
                    : 'w-1.5 bg-promo/30 hover:bg-promo/50'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
