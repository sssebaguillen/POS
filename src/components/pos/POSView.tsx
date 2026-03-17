'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Menu, ChevronDown, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/shared/AppShell'
import { useCartStore } from '@/lib/store/cart.store'
import ProductPanel from '@/components/pos/ProductPanel'
import CartPanel from '@/components/pos/CartPanel'
import type { PosCategory, ProductWithCategory } from '@/components/pos/types'
import type { PriceList, PriceListOverride } from '@/components/price-lists/types'
import type { ActiveOperator } from '@/lib/operator'

interface Props {
  products: ProductWithCategory[]
  categories: PosCategory[]
  businessId: string | null
  priceLists: PriceList[]
  priceListOverrides: PriceListOverride[]
  activeOperator: ActiveOperator | null
}

function formatDate(date: Date) {
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export default function POSView({ products, categories, businessId, priceLists, priceListOverrides, activeOperator }: Props) {
  const { toggle } = useSidebar()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const clearCart = useCartStore(s => s.clearCart)
  const addItem = useCartStore(s => s.addItem)

  const defaultList = priceLists.find(pl => pl.is_default) ?? priceLists[0] ?? null
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

  function handleNewSale() {
    clearCart()
    setSearch('')
    searchRef.current?.focus()
  }

  // Global barcode scanner listener — redirects keystrokes to the search input
  // when no text input is currently focused, so scanning works regardless of
  // where the user last clicked.
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
        // Printable character — prevent double-insert and route to search
        e.preventDefault()
        searchRef.current.focus()
        setSearch(prev => prev + e.key)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        searchRef.current.focus()
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const barcodeMatch = products.find(p => p.barcode === search)
      if (barcodeMatch) {
        addItem(barcodeMatch)
        setSearch('')
        searchRef.current?.focus()
        return
      }
      const filtered = products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase())
      )
      if (filtered.length === 1) {
        addItem(filtered[0])
        setSearch('')
        searchRef.current?.focus()
      }
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="h-14 bg-surface border-b border-edge/60 flex items-center px-5 gap-4 shrink-0">
        <button
          onClick={toggle}
          className="p-1.5 -ml-1 rounded-lg hover:bg-hover-bg transition-colors lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu size={20} className="text-body" />
        </button>
        <span className="text-lg font-bold text-heading shrink-0">Ventas</span>

        <div className="flex-1 max-w-lg mx-auto">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint" />
            <Input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Buscar producto o marca..."
              className="pl-9 h-9 bg-surface-alt border-edge text-sm rounded-lg"
            />
          </div>
        </div>

        {priceLists.length > 0 && (
          <div ref={listDropdownRef} className="relative shrink-0">
            <button
              disabled={!canSelectList}
              onClick={() => canSelectList && setListDropdownOpen(prev => !prev)}
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
              <div className="absolute top-full right-0 mt-1 surface-elevated z-30 py-1 min-w-[180px]">
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

        <span className="text-sm text-subtle capitalize shrink-0 hidden md:block">
          {formatDate(new Date())}
        </span>
        <Button
          className="h-9 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-semibold shrink-0"
          onClick={handleNewSale}
        >
          + Nueva venta
        </Button>
      </header>

      {/* Content: products + cart */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto">
          <ProductPanel
            products={products}
            search={search}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
          />
        </div>
        <div className="w-[380px] shrink-0 bg-surface border-l border-edge/60 flex flex-col">
          <CartPanel
            businessId={businessId}
            activePriceList={activePriceList}
            priceListOverrides={priceListOverrides}
            operatorId={activeOperator?.role === 'owner' || !activeOperator ? null : activeOperator.profile_id ?? null}
          />
        </div>
      </div>
    </div>
  )
}
