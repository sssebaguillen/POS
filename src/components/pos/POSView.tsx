'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Search, Menu, ChevronDown, Check, ScanBarcode } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/shared/AppShell'
import { useCartStore } from '@/lib/store/cart.store'
import ProductPanel from '@/components/pos/ProductPanel'
import CartPanel from '@/components/pos/CartPanel'
import type { ProductWithCategory, ActiveFilter } from '@/components/pos/types'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { ActiveOperator } from '@/lib/operator'
import { OWNER_PERMISSIONS } from '@/lib/operator'
import { trackFeatureUsed } from '@/lib/analytics'

interface Props {
  products: ProductWithCategory[]
  businessId: string | null
  businessName: string
  priceLists: PriceList[]
  priceListOverrides: PriceListOverride[]
  activeOperator: ActiveOperator | null
}

// Estado visual del feedback de escaneo
type ScanFeedback = 'found' | 'not-found' | null

function formatDate(date: Date) {
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export default function POSView({ products, businessId, businessName, priceLists, priceListOverrides, activeOperator }: Props) {
  const { toggle } = useSidebar()
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(null)
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scanFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGlobalPrintableKeyAtRef = useRef(0)
  const itemCount = useCartStore(s => s.items.length)
  const clearCart = useCartStore(s => s.clearCart)
  const addItem = useCartStore(s => s.addItem)
  const [confirmingNewSale, setConfirmingNewSale] = useState(false)
  const confirmNewSaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filterScrollRef = useRef<HTMLDivElement>(null)

  const handleFilterWheel = useCallback((e: WheelEvent) => {
    const el = filterScrollRef.current
    if (!el) return
    e.preventDefault()
    el.scrollLeft += e.deltaY + e.deltaX
  }, [])

  useEffect(() => {
    const el = filterScrollRef.current
    if (!el) return
    el.addEventListener('wheel', handleFilterWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleFilterWheel)
  }, [handleFilterWheel])

  useEffect(() => {
    return () => {
      if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current)
      if (confirmNewSaleTimerRef.current) clearTimeout(confirmNewSaleTimerRef.current)
    }
  }, [])

  const TOP_FILTER_LIMIT = 8

  const topCategories = useMemo(() => {
    const salesByCategory = new Map<string, { id: string; name: string; total: number }>()
    for (const p of products) {
      if (!p.category_id || !p.categories) continue
      const existing = salesByCategory.get(p.category_id)
      if (existing) {
        existing.total += p.sales_count
      } else {
        salesByCategory.set(p.category_id, {
          id: p.category_id,
          name: p.categories.name,
          total: p.sales_count,
        })
      }
    }
    return [...salesByCategory.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_FILTER_LIMIT)
  }, [products])

  const topBrands = useMemo(() => {
    const salesByBrand = new Map<string, { id: string; name: string; total: number }>()
    for (const p of products) {
      if (!p.brand_id || !p.brand) continue
      const existing = salesByBrand.get(p.brand_id)
      if (existing) {
        existing.total += p.sales_count
      } else {
        salesByBrand.set(p.brand_id, {
          id: p.brand_id,
          name: p.brand.name,
          total: p.sales_count,
        })
      }
    }
    return [...salesByBrand.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_FILTER_LIMIT)
  }, [products])

  const defaultList = priceLists.find(pl => pl.is_default) ?? null
  const [activePriceListId, setActivePriceListId] = useState<string | null>(defaultList?.id ?? null)
  const [listDropdownOpen, setListDropdownOpen] = useState(false)
  const listDropdownRef = useRef<HTMLDivElement>(null)

  const activePriceList = priceLists.find(pl => pl.id === activePriceListId) ?? null
  const canSelectList = activeOperator?.permissions.stock === true

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!listDropdownOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (listDropdownRef.current && !listDropdownRef.current.contains(event.target as Node)) {
        setListDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [listDropdownOpen])

  const handleNewSale = useCallback(() => {
    if (itemCount > 0 && !confirmingNewSale) {
      setConfirmingNewSale(true)
      confirmNewSaleTimerRef.current = setTimeout(() => setConfirmingNewSale(false), 3000)
      return
    }
    if (confirmNewSaleTimerRef.current) clearTimeout(confirmNewSaleTimerRef.current)
    setConfirmingNewSale(false)
    clearCart()
    setSearch('')
    setActiveFilter(null)
    setScanFeedback(null)
    searchRef.current?.focus()
  }, [itemCount, confirmingNewSale, clearCart])

  const showScanFeedback = useCallback((type: ScanFeedback) => {
    if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current)
    setScanFeedback(type)
    scanFeedbackTimerRef.current = setTimeout(() => setScanFeedback(null), 900)
  }, [])

  // resolves barcode > unique name/SKU match; returns true if added (caller clears input)
  const tryAddBySearch = useCallback((value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) return false

    // 1. Match exacto por barcode
    const barcodeMatch = products.find(p => p.barcode === trimmed)
    if (barcodeMatch) {
      addItem(barcodeMatch)
      trackFeatureUsed('barcode_scan')
      showScanFeedback('found')
      return true
    }

    // 2. Resultado único por nombre o SKU
    const q = trimmed.toLowerCase()
    const nameMatches = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    )
    if (nameMatches.length === 1) {
      addItem(nameMatches[0])
      showScanFeedback('found')
      return true
    }

    // No encontrado — solo mostrar feedback si parece un barcode numérico.
    // Evita marcar como error búsquedas de texto como "coca" o "leche".
    const looksLikeBarcode = /^\d{4,}$/.test(trimmed)
    if (looksLikeBarcode) {
      showScanFeedback('not-found')
    }

    return false
  }, [products, addItem, showScanFeedback])

  // redirect global keystrokes to the search input; enables USB barcode readers
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (!searchRef.current) return

      const active = document.activeElement
      const isTextInputActive =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement

      if (isTextInputActive) return

      if (e.key.length === 1) {
        // Caracter imprimible — redirigir al input de búsqueda
        e.preventDefault()
        lastGlobalPrintableKeyAtRef.current = Date.now()
        searchRef.current.focus()
        setSearch(prev => prev + e.key)
      } else if (e.key === 'Enter') {
        const activeIsInteractive =
          active instanceof HTMLButtonElement ||
          active instanceof HTMLAnchorElement ||
          (active instanceof HTMLElement && active.isContentEditable)
        const recentlyBufferedInput = Date.now() - lastGlobalPrintableKeyAtRef.current < 500

        // Respetar Enter sobre controles interactivos, salvo que venga de un escaneo/tecleo global reciente.
        if (activeIsInteractive && !recentlyBufferedInput) return

        // Enter con foco fuera del input: intentar agregar con el valor actual del input
        e.preventDefault()
        const currentValue = searchRef.current.value
        if (currentValue.trim()) {
          const added = tryAddBySearch(currentValue)
          if (added) {
            setSearch('')
          }
        }
        searchRef.current.focus()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [tryAddBySearch])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const added = tryAddBySearch(search)
      if (added) {
        setSearch('')
        searchRef.current?.focus()
      }
    }
  }, [search, tryAddBySearch])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <header className="h-14 bg-surface border-b border-edge/60 flex items-center px-5 gap-4 shrink-0">
        <button
          onClick={toggle}
          className="p-1.5 -ml-1 rounded-lg hover:bg-hover-bg transition-colors lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu size={20} className="text-body" />
        </button>
        <span className="text-lg font-bold text-heading shrink-0 font-display">Ventas</span>

        <div className="flex-1 max-w-lg mx-auto">
          <div className="relative">
            {/* Ícono: muestra ScanBarcode animado cuando detecta escaneo, Search en reposo */}
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {scanFeedback ? (
                <ScanBarcode
                  size={16}
                  className={
                    scanFeedback === 'found'
                      ? 'text-emerald-500'
                      : 'text-red-400'
                  }
                />
              ) : (
                <Search size={16} className="text-hint" />
              )}
            </div>
            <Input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar producto o escanear código..."
              className={[
                'pl-9 h-9 text-sm rounded-lg transition-colors',
                scanFeedback === 'found'
                  ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-700'
                  : scanFeedback === 'not-found'
                    ? 'bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-700'
                    : 'bg-surface-alt border-edge',
              ].join(' ')}
            />
            {scanFeedback && (
              <p
                role="alert"
                aria-live="assertive"
                className={[
                  'absolute left-0 -bottom-5 z-10 text-[11px] font-medium animate-fade-in',
                  scanFeedback === 'found' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
                ].join(' ')}
              >
                {scanFeedback === 'found' ? 'Producto agregado' : 'Código no encontrado'}
              </p>
            )}
          </div>
        </div>

        {priceLists.length > 0 && (
          <div ref={listDropdownRef} className="relative shrink-0" data-tour="pos-price-list-selector">
            <button
              disabled={!canSelectList}
              onClick={() => canSelectList && setListDropdownOpen(prev => !prev)}
              title={!canSelectList ? 'Solo operadores con permiso de stock pueden cambiar la lista de precios' : undefined}
              className={
                'flex items-center gap-1.5 h-8 px-3 rounded-lg border border-edge text-sm font-medium transition-colors select-none ' +
                (canSelectList
                  ? 'hover:bg-hover-bg text-body'
                  : 'opacity-60 cursor-not-allowed text-subtle')
              }
            >
              <span className="text-hint text-xs">Lista:</span>
              <span>{activePriceList?.name ?? 'Sin lista'}</span>
              {canSelectList && <ChevronDown size={14} className="text-hint" />}
            </button>
            {listDropdownOpen && (
              <div className="absolute top-full right-0 mt-1 surface-elevated z-30 py-1 min-w-[180px] rounded-lg overflow-hidden">
                {priceLists.map(pl => (
                  <button
                    key={pl.id}
                    onClick={() => { setActivePriceListId(pl.id); setListDropdownOpen(false) }}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-body hover:bg-hover-bg transition-colors"
                  >
                    <span>{pl.name}</span>
                    {pl.id === activePriceListId && <Check size={14} className="text-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <span className="text-sm text-subtle capitalize shrink-0 hidden lg:block">
          {formatDate(new Date())}
        </span>
        <Button
          className={`h-9 px-4 rounded-lg text-sm font-semibold shrink-0 transition-colors ${
            confirmingNewSale
              ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
          onClick={handleNewSale}
        >
          {confirmingNewSale ? '¿Vaciar carrito?' : '+ Nueva venta'}
        </Button>
      </header>

      {/* Content: products + cart */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Filter chips strip — scoped to product column only */}
          {(topCategories.length > 0 || topBrands.length > 0) && (
            <div className="border-b border-edge/60 shrink-0 overflow-hidden py-2 px-6">
              <div
                ref={filterScrollRef}
                className="flex flex-nowrap gap-1.5 overflow-x-auto"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {(() => {
                  const chip = (active: boolean) =>
                    `shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`
                  return (
                    <>
                      <button onClick={() => setActiveFilter(null)} className={chip(activeFilter === null)}>
                        Todos
                      </button>
                      {topCategories.length > 0 && <span className="shrink-0 w-px bg-edge/60 mx-0.5" />}
                      {topCategories.map(cat => (
                        <button
                          key={cat.id}
                          onClick={() =>
                            setActiveFilter(
                              activeFilter?.type === 'category' && activeFilter.id === cat.id
                                ? null
                                : { type: 'category', id: cat.id }
                            )
                          }
                          className={chip(activeFilter?.type === 'category' && activeFilter.id === cat.id)}
                        >
                          {cat.name}
                        </button>
                      ))}
                      {topBrands.length > 0 && <span className="shrink-0 w-px bg-edge/60 mx-0.5" />}
                      {topBrands.map(brand => (
                        <button
                          key={brand.id}
                          onClick={() =>
                            setActiveFilter(
                              activeFilter?.type === 'brand' && activeFilter.id === brand.id
                                ? null
                                : { type: 'brand', id: brand.id }
                            )
                          }
                          className={chip(activeFilter?.type === 'brand' && activeFilter.id === brand.id)}
                        >
                          {brand.name}
                        </button>
                      ))}
                    </>
                  )
                })()}
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <ProductPanel
              products={products}
              search={search}
              activeFilter={activeFilter}
              activePriceList={activePriceList}
              priceListOverrides={priceListOverrides}
            />
          </div>
        </div>
        <div className="w-[300px] md:w-[340px] lg:w-[380px] shrink-0 bg-surface border-l border-edge/60 flex flex-col" data-tour="pos-cart">
          <CartPanel
            businessId={businessId}
            businessName={businessName}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            operatorId={activeOperator?.role === 'owner' || !activeOperator ? null : activeOperator.profile_id}
            permissions={activeOperator?.role === 'owner' || !activeOperator ? OWNER_PERMISSIONS : activeOperator.permissions}
          />
        </div>
      </div>
    </div>
  )
}
