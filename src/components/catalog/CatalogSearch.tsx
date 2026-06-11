'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ImageIcon, Layers, Search } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import { mapCatalogProductRow, type CatalogProductRow } from '@/components/catalog/mapProducts'
import type { CatalogCategory, CatalogProduct } from '@/components/catalog/types'

const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const currencyFormatter = new Intl.NumberFormat('es-AR')
const MAX_RESULTS = 8

interface CatalogSearchProps {
  slug: string
  /** Datos ya cargados (main page). Si faltan, se traen lazy al primer tipeo. */
  products?: CatalogProduct[]
  categories?: CatalogCategory[]
  className?: string
}

interface SearchData {
  products: CatalogProduct[]
  categoryNames: Map<string, string>
}

export default function CatalogSearch({
  slug,
  products,
  categories,
  className = '',
}: CatalogSearchProps) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [fetched, setFetched] = useState<SearchData | null>(null)
  const fetchingRef = useRef(false)

  const providedData = useMemo<SearchData | null>(() => {
    if (!products) return null
    return {
      products,
      categoryNames: new Map((categories ?? []).map(c => [c.id, c.name])),
    }
  }, [products, categories])

  const data = providedData ?? fetched

  // Lazy fetch para páginas sin listado (detalle, /promotions): una sola vez,
  // al primer tipeo. Mismas RPCs anon del catálogo (regla 29).
  useEffect(() => {
    if (providedData || fetched || fetchingRef.current) return
    if (query.trim() === '') return
    fetchingRef.current = true

    Promise.all([
      anonClient.rpc('get_catalog_products', { p_slug: slug }).returns<CatalogProductRow[]>(),
      anonClient.rpc('get_catalog_categories', { p_slug: slug }),
    ])
      .then(([productsResult, categoriesResult]) => {
        if (productsResult.error) throw new Error(productsResult.error.message)
        const rows = (productsResult.data ?? []) as CatalogProductRow[]
        const categoryRows = (categoriesResult.data ?? []) as { id: string; name: string }[]
        setFetched({
          products: rows.map(mapCatalogProductRow),
          categoryNames: new Map(categoryRows.map(c => [c.id, c.name])),
        })
      })
      .catch(error => {
        console.error('[catalog search] fetch failed', error)
        fetchingRef.current = false
      })
  }, [query, providedData, fetched, slug])

  // Cierre por click afuera
  useEffect(() => {
    if (!isOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen])

  const normalizedQuery = query.trim().toLowerCase()

  const results = useMemo(() => {
    if (!data || normalizedQuery === '') return []
    return data.products
      .filter(
        p =>
          p.name.toLowerCase().includes(normalizedQuery) ||
          (p.brandName?.toLowerCase().includes(normalizedQuery) ?? false)
      )
      .slice(0, MAX_RESULTS)
  }, [data, normalizedQuery])

  const showDropdown = isOpen && normalizedQuery !== ''
  const isLoading = showDropdown && !data

  function goToProduct(productId: string) {
    setIsOpen(false)
    setQuery('')
    router.push(`/catalogo/${slug}/${productId}`)
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="catalog-search-results"
        aria-label="Buscar producto"
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Escape') setIsOpen(false)
          if (e.key === 'Enter') {
            e.preventDefault()
            if (results.length > 0) goToProduct(results[0].id)
          }
        }}
        placeholder="Buscar producto..."
        className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
      />

      {showDropdown && (
        <div
          id="catalog-search-results"
          role="listbox"
          className="surface-elevated absolute left-0 right-0 top-full z-40 mt-1.5 max-h-[60vh] overflow-y-auto rounded-xl border border-border p-1.5 shadow-lg"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No se encontraron productos para “{query.trim()}”.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.map(product => {
                const categoryName = product.categoryId
                  ? data?.categoryNames.get(product.categoryId) ?? null
                  : null
                const meta = [categoryName, product.brandName].filter(Boolean).join(' · ')
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => goToProduct(product.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover-bg"
                    >
                      <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted/40">
                        {product.imageUrl ? (
                          <Image
                            src={product.imageUrl}
                            alt={product.name}
                            fill
                            unoptimized
                            className="object-cover"
                            sizes="40px"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <ImageIcon className="h-4 w-4" />
                          </span>
                        )}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {product.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          {meta && <span className="truncate">{meta}</span>}
                          {product.hasVariants && (
                            <span className="inline-flex shrink-0 items-center gap-0.5">
                              <Layers className="h-3 w-3" />
                              {product.variantCount > 1
                                ? `${product.variantCount} variantes`
                                : 'Variantes'}
                            </span>
                          )}
                        </span>
                      </span>

                      <span className="shrink-0 text-right text-sm font-semibold">
                        {product.originalPrice !== null && (
                          <span className="mr-1.5 text-xs font-medium text-muted-foreground line-through">
                            ${currencyFormatter.format(product.originalPrice)}
                          </span>
                        )}
                        <span className={product.originalPrice !== null ? 'text-promo' : 'text-foreground'}>
                          ${currencyFormatter.format(product.salePrice)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
