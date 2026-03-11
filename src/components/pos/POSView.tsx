'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, Menu } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/shared/AppShell'
import { useCartStore } from '@/lib/store/cart.store'
import ProductPanel from '@/components/pos/ProductPanel'
import CartPanel from '@/components/pos/CartPanel'
import type { Product } from '@/lib/types'

interface Category {
  id: string
  name: string
  icon: string
}

interface ProductWithCategory extends Product {
  categories?: { name: string; icon: string } | null
}

interface Props {
  products: ProductWithCategory[]
  categories: Category[]
  businessId: string | null
}

function formatDate(date: Date) {
  return date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export default function POSView({ products, categories, businessId }: Props) {
  const { toggle } = useSidebar()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const clearCart = useCartStore(s => s.clearCart)
  const addItem = useCartStore(s => s.addItem)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  function handleNewSale() {
    clearCart()
    setSearch('')
    searchRef.current?.focus()
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const barcodeMatch = products.find(p => p.barcode === search)
      if (barcodeMatch) {
        addItem(barcodeMatch)
        setSearch('')
        return
      }
      const filtered = products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase())
      )
      if (filtered.length === 1) {
        addItem(filtered[0])
        setSearch('')
      }
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="h-14 bg-surface border-b border-edge/60 flex items-center px-5 gap-4 shrink-0">
        <button
          onClick={toggle}
          className="p-1.5 -ml-1 rounded-lg hover:bg-hover-bg transition-colors"
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

        <span className="text-sm text-subtle capitalize shrink-0 hidden md:block">
          {formatDate(new Date())}
        </span>
        <Button
          className="h-9 px-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold shrink-0"
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
            categories={categories}
            search={search}
          />
        </div>
        <div className="w-[380px] shrink-0 bg-surface border-l border-edge/60 flex flex-col">
          <CartPanel businessId={businessId} />
        </div>
      </div>
    </div>
  )
}
