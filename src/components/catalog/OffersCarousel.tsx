'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { SealPercent, CaretLeft, CaretRight, Clock, Image as ImageIcon, ShoppingCart } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { promoCountdownLabel } from '@/lib/promotions'
import type { CatalogProduct } from '@/components/catalog/types'

const currencyFormatter = new Intl.NumberFormat('es-AR')
const AUTO_ADVANCE_MS = 6000

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

// SSR no conoce la preferencia del usuario: asumir movimiento permitido (no reducido).
function getReducedMotionServerSnapshot() {
  return false
}

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
    swapText('Agregado')
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
      {/* Full-bleed dentro de la card: la imagen alinea con el eyebrow OFERTAS a
          la izquierda (sin centrar/acotar — el margen izquierdo molestaba). */}
      <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[minmax(0,46%)_1fr] sm:gap-6 lg:gap-8">
        {/* Imagen con la promo como flag (sticker de oferta), recorta sin deformar */}
        <Link
          href={detailUrl}
          className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-muted/40 sm:aspect-auto sm:h-60 lg:h-72"
        >
          {product.imageUrl ? (
            <Image
              src={product.imageUrl}
              alt={product.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, 46vw"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-12 w-12" />
            </span>
          )}
          {product.promo && (
            <span className="absolute left-3 top-3 rounded-lg bg-promo px-2.5 py-1 text-sm font-bold text-promo-foreground shadow-md">
              {product.promo.label}
            </span>
          )}
        </Link>

        {/* Detalle */}
        <div className="min-w-0 pb-2 sm:py-2">
          {countdown && (
            // Urgencia real (la promo cierra en ≤7 días): chip ámbar para que el
            // tiempo pese, sin tapar el precio. El ámbar armoniza con el marco de
            // la sección de ofertas; el verde queda para el ahorro.
            <p className="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
              <Clock className="h-3.5 w-3.5" />
              {countdown}
            </p>
          )}
          <Link href={detailUrl} className={`block ${countdown ? 'mt-2' : ''}`}>
            <h3 className="line-clamp-2 text-xl font-bold leading-tight text-foreground sm:text-2xl lg:text-3xl">
              {product.name}
            </h3>
          </Link>
          {product.brandName && (
            <p className="mt-1 text-sm text-muted-foreground">{product.brandName}</p>
          )}
          {/* Precio: el "ahora" manda (grande, en promo); el "antes" tachado al lado */}
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
            {product.hasVariants && product.variantCount > 1 && (
              <span className="text-base font-medium text-muted-foreground">Desde</span>
            )}
            <span className={`text-3xl font-bold lg:text-4xl ${product.originalPrice !== null ? 'text-promo' : 'text-foreground'}`}>
              ${currencyFormatter.format(product.salePrice)}
            </span>
            {product.originalPrice !== null && (
              <span className="text-base font-medium text-muted-foreground line-through lg:text-lg">
                {/* sr-only: el tachado no se "oye"; sin esto el lector dice dos
                    precios sin decir cuál es el viejo */}
                <span className="sr-only">antes </span>
                ${currencyFormatter.format(product.originalPrice)}
              </span>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canQuickAdd && (
              <Button
                type="button"
                onClick={handleAdd}
                className="gap-1.5"
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
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot
  )

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
      className="offers-highlight relative rounded-xl border p-5"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
    >
      {/* Cabecera del hero: eyebrow "Ofertas" + link a todas (en vez de un único
          link combinado que hacía de título y de "ver más" a la vez) */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-promo">
          <SealPercent className="h-4 w-4" />
          Ofertas
        </p>
        <Link
          href={`/catalogo/${slug}/promotions`}
          className="group inline-flex items-center gap-1 text-sm font-medium text-promo transition-colors hover:text-promo/80"
        >
          Ver todas
          <CaretRight className="h-4 w-4 transition-transform duration-150 ease-[var(--ease-out)] group-hover:translate-x-0.5" />
        </Link>
      </div>

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
            <CaretLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Oferta siguiente"
            onClick={() => scrollToIndex((activeIndex + 1) % offers.length)}
            className="absolute right-2 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-card/90 text-foreground shadow-sm transition-[transform,background-color] duration-150 ease-[var(--ease-out)] hover:bg-card active:scale-95 sm:flex"
          >
            <CaretRight className="h-5 w-5" />
          </button>

          {/* Dots */}
          {/* Dot visual chico, hit-area de 32px vía padding del botón */}
          <div className="mt-1 flex items-center justify-center">
            {offers.map((offer, index) => (
              <button
                key={offer.id}
                type="button"
                aria-label={`Ir a oferta ${index + 1}`}
                aria-current={index === activeIndex}
                onClick={() => scrollToIndex(index)}
                className="group flex h-8 items-center px-1.5 outline-none"
              >
                <span
                  className={`h-1.5 rounded-full transition-[width,background-color] duration-200 ease-[var(--ease-out)] group-focus-visible:ring-2 group-focus-visible:ring-ring/50 ${
                    index === activeIndex
                      ? 'w-5 bg-promo'
                      : 'w-1.5 bg-promo/30 group-hover:bg-promo/50'
                  }`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
