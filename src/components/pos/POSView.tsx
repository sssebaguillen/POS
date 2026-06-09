'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Search, Menu, ChevronDown, Check, ScanBarcode, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/shared/AppShell'
import { useCartStore } from '@/lib/store/cart.store'
import { createClient } from '@/lib/supabase/client'
import ProductPanel from '@/components/pos/ProductPanel'
import CartPanel, { type CartPanelHandle } from '@/components/pos/CartPanel'
import CartFAB from '@/components/pos/CartFAB'
import MobileCartDrawer from '@/components/pos/MobileCartDrawer'
import CashSessionWidget from '@/components/pos/CashSessionWidget'
import OpenSessionModal from '@/components/pos/OpenSessionModal'
import CloseSessionModal from '@/components/pos/CloseSessionModal'
import ProductFilter, { EMPTY_FILTER, type ProductFilterValue } from '@/components/shared/ProductFilter'
import type { ProductWithCategory, ActiveFilter } from '@/components/pos/types'
import type { PriceList, PriceListOverride, ProductVariant, ProductWithVariants } from '@/lib/types'
import { getCartItemId, type CartItem } from '@/lib/types/cart'
import type { ActiveOperator } from '@/lib/operator'
import { OWNER_PERMISSIONS } from '@/lib/operator'
import { trackFeatureUsed } from '@/lib/analytics'
import { Skeleton } from '@/components/ui/skeleton'

interface ActiveSession {
  id: string
  opening_amount: number
  opened_at: string
  opened_by_name: string
  sales_count: number
  sales_total: number
}

interface Props {
  products: ProductWithCategory[]
  businessId: string | null
  businessName: string
  freeLineEnabled: boolean
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

export default function POSView({ products, businessId, businessName, freeLineEnabled, priceLists, priceListOverrides, activeOperator }: Props) {
  const { toggle } = useSidebar()
  const [filterValue, setFilterValue] = useState<ProductFilterValue>(EMPTY_FILTER)
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const cartPanelRef = useRef<CartPanelHandle>(null)
  const scanFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGlobalPrintableKeyAtRef = useRef(0)
  const itemCountRef = useRef(0)
  const confirmingNewSaleRef = useRef(false)
  const itemsRef = useRef<CartItem[]>([])
  const itemCount = useCartStore(s => s.items.length)
  const cartItems = useCartStore(s => s.items)
  const clearCart = useCartStore(s => s.clearCart)
  const removeItem = useCartStore(s => s.removeItem)
  const updateQuantity = useCartStore(s => s.updateQuantity)
  const addItem = useCartStore(s => s.addItem)
  const addVariantItem = useCartStore(s => s.addVariantItem)
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const [confirmingNewSale, setConfirmingNewSale] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const confirmNewSaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cash session state
  const [activeSession, setActiveSession] = useState<ActiveSession | null | undefined>(undefined)
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)

  const operatorId = activeOperator?.role === 'owner' || !activeOperator ? null : activeOperator.profile_id

  // Mantener refs en sync con el último estado para handlers/timers estables
  // (se leen fuera del render: keydown global del scanner, timer de "nueva venta").
  useEffect(() => {
    itemCountRef.current = itemCount
    itemsRef.current = cartItems
    confirmingNewSaleRef.current = confirmingNewSale
  }, [itemCount, cartItems, confirmingNewSale])

  useEffect(() => {
    return () => {
      if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current)
      if (confirmNewSaleTimerRef.current) clearTimeout(confirmNewSaleTimerRef.current)
    }
  }, [])

  const fetchActiveSession = useCallback(async () => {
    const { data } = await supabase.rpc('get_active_session')
    setActiveSession((data as ActiveSession | null) ?? null)
    void queryClient.invalidateQueries({ queryKey: ['active_cash_session'] })
  }, [supabase, queryClient])

  useEffect(() => {
    void fetchActiveSession()
  }, [fetchActiveSession])

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

  const [activePriceListId, setActivePriceListId] = useState<string | null>(null)
  const [listDropdownOpen, setListDropdownOpen] = useState(false)
  const listDropdownRef = useRef<HTMLDivElement>(null)

  const activePriceList = priceLists.find(pl => pl.id === activePriceListId) ?? null
  const canSelectList = activeOperator?.permissions.inventory_read === true

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
    setFilterValue(EMPTY_FILTER)
    setScanFeedback(null)
    searchRef.current?.focus()
  }, [itemCount, confirmingNewSale, clearCart])

  const showScanFeedback = useCallback((type: ScanFeedback) => {
    if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current)
    setScanFeedback(type)
    scanFeedbackTimerRef.current = setTimeout(() => setScanFeedback(null), 900)
  }, [])

  const tryAddVariantByBarcode = useCallback(async (barcode: string): Promise<boolean> => {
    if (!businessId) return false
    const { data } = await supabase
      .from('product_variants')
      .select('id, product_id, price, cost, stock, min_stock, sku, barcode, image_url, image_source, is_active')
      .eq('business_id', businessId)
      .eq('barcode', barcode)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (!data) return false

    const parentProduct = products.find(p => p.id === (data as { product_id: string }).product_id)
    if (!parentProduct) return false

    // Fetch option values to build the label
    const { data: variantFull } = await supabase.rpc('get_product_with_variants', {
      p_product_id: parentProduct.id,
    })
    const result = variantFull as ProductWithVariants | null
    const variantDetail = result?.variants.find(v => v.id === (data as { id: string }).id)

    const variant: ProductVariant = {
      id: (data as { id: string }).id,
      product_id: parentProduct.id,
      sku: (data as { sku: string | null }).sku,
      barcode: barcode,
      price: Number((data as { price: number }).price),
      cost: Number((data as { cost: number }).cost),
      stock: Number((data as { stock: number }).stock),
      min_stock: Number((data as { min_stock: number }).min_stock),
      image_url: (data as { image_url: string | null }).image_url,
      image_source: (data as { image_source: 'upload' | 'url' | null }).image_source,
      is_active: true,
      is_in_stock: Number((data as { stock: number }).stock) > 0,
      option_values: variantDetail?.option_values ?? [],
    }

    const label = variantDetail?.option_values.map(ov => ov.value).join(' / ') ?? barcode
    addVariantItem(parentProduct, variant, label)
    return true
  }, [businessId, supabase, products, addVariantItem])

  // resolves barcode > unique name/SKU match; returns true if added (caller clears input)
  const tryAddBySearch = useCallback((value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) return false

    // 1. Match exacto por barcode de producto
    const barcodeMatch = products.find(p => p.barcode === trimmed)
    if (barcodeMatch) {
      if (barcodeMatch.has_variants) {
        // Product with variants — handled asynchronously via variant barcode
      } else {
        addItem(barcodeMatch)
        trackFeatureUsed('barcode_scan')
        showScanFeedback('found')
        return true
      }
    }

    // 2. Resultado único por nombre o SKU
    const q = trimmed.toLowerCase()
    const nameMatches = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    )
    if (nameMatches.length === 1 && !nameMatches[0].has_variants) {
      addItem(nameMatches[0])
      showScanFeedback('found')
      return true
    }

    // 3. Si parece un barcode, buscar en variantes de forma asíncrona
    const looksLikeBarcode = /^\d{4,}$/.test(trimmed)
    if (looksLikeBarcode) {
      void tryAddVariantByBarcode(trimmed).then(found => {
        if (found) {
          trackFeatureUsed('barcode_scan')
          showScanFeedback('found')
        } else {
          showScanFeedback('not-found')
        }
      })
      return true // Indicate handled (async)
    }

    return false
  }, [products, addItem, showScanFeedback, tryAddVariantByBarcode])

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
      if (cartPanelRef.current?.isPaymentOpen()) return

      if (e.key.length === 1) {
        // Caracter imprimible — redirigir al input de búsqueda
        e.preventDefault()
        lastGlobalPrintableKeyAtRef.current = Date.now()
        searchRef.current.focus()
        setFilterValue(prev => ({ ...prev, search: prev.search + e.key }))
      } else if (e.key === 'Enter') {
        const activeIsInteractive =
          active instanceof HTMLButtonElement ||
          active instanceof HTMLAnchorElement ||
          (active instanceof HTMLElement && active.isContentEditable)
        const recentlyBufferedInput = Date.now() - lastGlobalPrintableKeyAtRef.current < 500

        // Respetar Enter sobre controles interactivos, salvo que venga de un escaneo/tecleo global reciente.
        if (activeIsInteractive && !recentlyBufferedInput) return

        e.preventDefault()
        const currentValue = searchRef.current.value
        if (currentValue.trim()) {
          // Enter con foco fuera del input: intentar agregar con el valor actual del input
          tryAddBySearch(currentValue)
          setFilterValue(prev => ({ ...prev, search: '' }))
        } else if (itemCountRef.current > 0 && !cartPanelRef.current?.isPaymentOpen()) {
          // Carrito con productos y búsqueda vacía → abrir modal de pago
          cartPanelRef.current?.openPaymentModal()
          return
        }
        searchRef.current.focus()
      } else if (e.key === 'Escape') {
        // ESC global: espeja la lógica del botón "Nueva venta / ¿Vaciar carrito?"
        if (cartPanelRef.current?.isPaymentOpen()) return  // el modal de pago maneja su propio ESC
        if (itemCountRef.current === 0) return
        e.preventDefault()
        if (!confirmingNewSaleRef.current) {
          setConfirmingNewSale(true)
          if (confirmNewSaleTimerRef.current) clearTimeout(confirmNewSaleTimerRef.current)
          confirmNewSaleTimerRef.current = setTimeout(() => setConfirmingNewSale(false), 3000)
        } else {
          if (confirmNewSaleTimerRef.current) clearTimeout(confirmNewSaleTimerRef.current)
          setConfirmingNewSale(false)
          clearCart()
          setFilterValue(EMPTY_FILTER)
          setScanFeedback(null)
          searchRef.current?.focus()
        }
      } else if (e.key === 'Backspace') {
        // Backspace: quita 1 unidad del último item del carrito
        if (cartPanelRef.current?.isPaymentOpen()) return
        const items = itemsRef.current
        if (items.length === 0) return
        e.preventDefault()
        const last = items[items.length - 1]
        const itemId = getCartItemId(last)
        if (last.quantity > 1) {
          updateQuantity(itemId, last.quantity - 1)
        } else {
          removeItem(itemId)
        }
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [tryAddBySearch, clearCart, removeItem, updateQuantity])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      tryAddBySearch(filterValue.search)
      setFilterValue(prev => ({ ...prev, search: '' }))
      searchRef.current?.focus()
    }
  }, [filterValue.search, tryAddBySearch])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <header className="relative h-14 bg-surface border-b border-edge/60 flex items-center px-5 gap-4 shrink-0">
        <button
          onClick={toggle}
          className="p-1.5 -ml-1 rounded-lg hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95 lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu size={20} className="text-body" />
        </button>
        <span className="text-lg font-bold text-heading shrink-0 font-display">Ventas</span>

        <div className="hidden lg:flex flex-1 max-w-lg mx-auto">
          <div className="relative w-full">
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
              value={filterValue.search}
              onChange={e => setFilterValue(prev => ({ ...prev, search: e.target.value }))}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar producto o escanear código..."
              className={[
                'pl-9 h-9 text-sm bg-card rounded-lg transition-colors',
                scanFeedback === 'found'
                  ? 'bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-700'
                  : scanFeedback === 'not-found'
                    ? 'bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-700'
                    : 'bg-card border-edge',
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

        <button
          onClick={() => setMobileSearchOpen(true)}
          className="lg:hidden ml-auto p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95"
          aria-label="Buscar"
        >
          <Search size={20} className="text-body" />
        </button>

        <div ref={listDropdownRef} className="relative shrink-0" data-tour="pos-price-list-selector">
          <button
            disabled={!canSelectList || priceLists.length === 0}
            onClick={() => canSelectList && priceLists.length > 0 && setListDropdownOpen(prev => !prev)}
            title={!canSelectList ? 'Solo operadores con permiso de stock pueden cambiar la lista de precios' : undefined}
            className={
              'flex items-center gap-1.5 h-8 px-3 rounded-lg border border-edge text-sm font-medium transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] select-none ' +
              (canSelectList && priceLists.length > 0
                ? 'hover:bg-hover-bg text-body'
                : 'opacity-60 cursor-not-allowed text-subtle')
            }
          >
            <span className="text-hint text-xs hidden lg:inline">Lista:</span>
            <span>{priceLists.length === 0 ? '—' : (activePriceList?.name ?? 'Precio base')}</span>
            {canSelectList && priceLists.length > 0 && <ChevronDown size={14} className="text-hint" />}
          </button>
          {listDropdownOpen && priceLists.length > 0 && (
            <div className="absolute top-full right-0 mt-1 surface-elevated z-30 py-1 min-w-[180px] rounded-lg overflow-hidden animate-in fade-in-0 zoom-in-95 origin-top-right duration-150">
              <button
                onClick={() => { setActivePriceListId(null); setListDropdownOpen(false) }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-body hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
              >
                <span>Precio base</span>
                {activePriceListId === null && <Check size={14} className="text-primary" />}
              </button>
              {priceLists.map(pl => (
                <button
                  key={pl.id}
                  onClick={() => { setActivePriceListId(pl.id); setListDropdownOpen(false) }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-body hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
                >
                  <span>{pl.name}</span>
                  {pl.id === activePriceListId && <Check size={14} className="text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="text-sm text-subtle capitalize shrink-0 hidden lg:block">
          {formatDate(new Date())}
        </span>
        <Button
          className={`hidden lg:inline-flex h-9 px-4 rounded-lg text-sm font-semibold shrink-0 ${
            confirmingNewSale
              ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
              : 'bg-primary hover:bg-primary/90 text-primary-foreground'
          }`}
          onClick={handleNewSale}
        >
          {confirmingNewSale ? '¿Vaciar carrito?' : '+ Nueva venta'}
        </Button>

        {/* Mobile search overlay */}
        <div
          className={[
            'absolute inset-x-0 top-0 h-14 bg-surface border-b border-edge/60',
            'flex items-center gap-2 px-3 z-20',
            'transition-all duration-200 ease-out',
            mobileSearchOpen
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-2 pointer-events-none',
            'lg:hidden',
          ].join(' ')}
        >
          <div className="relative flex-1">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {scanFeedback ? (
                <ScanBarcode
                  size={16}
                  className={scanFeedback === 'found' ? 'text-emerald-500' : 'text-red-400'}
                />
              ) : (
                <Search size={16} className="text-hint" />
              )}
            </div>
            <Input
              ref={searchRef}
              value={filterValue.search}
              onChange={e => setFilterValue(prev => ({ ...prev, search: e.target.value }))}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar o escanear..."
              className="w-full pl-9 pr-4 h-9 text-sm rounded-lg border border-edge bg-surface focus:outline-none focus:border-primary"
              autoFocus={mobileSearchOpen}
            />
          </div>
          <button
            onClick={() => {
              setMobileSearchOpen(false)
              setFilterValue(prev => ({ ...prev, search: '' }))
            }}
            className="shrink-0 p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95"
            aria-label="Cerrar búsqueda"
          >
            <X size={20} className="text-body" />
          </button>
        </div>
      </header>

      {/* Content: products + cart */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Filter chips strip — scoped to product column only */}
          {(topCategories.length > 0 || topBrands.length > 0) && (
            <div className="border-b border-edge/60 shrink-0 overflow-x-auto">
              <div className="flex items-center px-4 py-2 min-w-0">
                <ProductFilter
                  modules={['category', 'brand']}
                  layout="topbar"
                  value={filterValue}
                  onChange={setFilterValue}
                  categories={topCategories.map(c => ({ id: c.id, name: c.name }))}
                  brands={topBrands.map(b => ({ id: b.id, name: b.name }))}
                />
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <ProductPanel
              products={products}
              search={filterValue.search}
              activeFilter={
                filterValue.categoryIds.length > 0
                  ? { type: 'category', id: filterValue.categoryIds[0] }
                  : filterValue.brandIds.length > 0
                    ? { type: 'brand', id: filterValue.brandIds[0] }
                    : null
              }
              activePriceList={activePriceList}
              priceListOverrides={priceListOverrides}
            />
          </div>
        </div>
        <div className="hidden lg:flex w-[300px] md:w-[340px] lg:w-[380px] shrink-0 bg-surface border-l border-edge/60 flex-col" data-tour="pos-cart">
          <div className="px-3 pt-3">
            <Skeleton isLoading={activeSession === undefined}>
              <div>
                <CashSessionWidget
                  session={activeSession ?? null}
                  onOpenClick={() => setShowOpenModal(true)}
                  onCloseClick={() => setShowCloseModal(true)}
                />
              </div>
            </Skeleton>
          </div>
          <CartPanel
            ref={cartPanelRef}
            businessId={businessId}
            businessName={businessName}
            freeLineEnabled={freeLineEnabled}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            operatorId={operatorId}
            permissions={activeOperator?.role === 'owner' || !activeOperator ? OWNER_PERMISSIONS : activeOperator.permissions}
            sessionId={activeSession?.id ?? null}
            confirmingClear={confirmingNewSale}
            onVaciar={handleNewSale}
            onSaleCompleted={fetchActiveSession}
          />
        </div>
      </div>

      {/* Mobile cart — FAB + drawer, hidden on lg+ */}
      <div className="lg:hidden">
        <CartFAB onOpen={() => setDrawerOpen(true)} />
        <MobileCartDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          businessId={businessId}
          businessName={businessName}
          freeLineEnabled={freeLineEnabled}
          activePriceList={activePriceList}
          priceListOverrides={priceListOverrides}
          operatorId={operatorId}
          permissions={activeOperator?.role === 'owner' || !activeOperator ? OWNER_PERMISSIONS : activeOperator.permissions}
          sessionId={activeSession?.id ?? null}
          confirmingClear={confirmingNewSale}
          onVaciar={handleNewSale}
          onSaleCompleted={fetchActiveSession}
        />
      </div>

      <OpenSessionModal
        open={showOpenModal}
        operatorId={operatorId}
        onOpened={() => {
          setShowOpenModal(false)
          void fetchActiveSession()
        }}
        onClose={() => setShowOpenModal(false)}
      />

      {activeSession && (
        <CloseSessionModal
          open={showCloseModal}
          sessionId={activeSession.id}
          operatorId={operatorId}
          onClosed={() => {
            setShowCloseModal(false)
            void fetchActiveSession()
          }}
          onClose={() => setShowCloseModal(false)}
        />
      )}
    </div>
  )
}
