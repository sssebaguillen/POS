'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MercaderiaItem } from './types'
import ProductSearchInput from './ProductSearchInput'
import type { PriceList } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import NewProductModal from '@/components/inventory/NewProductModal'

interface Category {
  id: string
  name: string
  icon: string
}

interface ProductSearchResult {
  id: string
  name: string
  stock: number
  cost: number
}

interface NewProductResult {
  id: string
  name: string
  cost: number
}

interface Props {
  businessId: string
  supabaseClient: SupabaseClient
  items: MercaderiaItem[]
  onItemsChange: (items: MercaderiaItem[]) => void
  canUpdateStock: boolean
  searchInputRef?: React.RefObject<HTMLDivElement | null>
  firstItemCostRef?: React.RefObject<HTMLInputElement | null>
  totalRef?: React.RefObject<HTMLDivElement | null>
}

export default function MercaderiaItemsSection({
  businessId,
  supabaseClient,
  items,
  onItemsChange,
  canUpdateStock,
  searchInputRef,
  firstItemCostRef,
  totalRef,
}: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductInitialName, setNewProductInitialName] = useState('')
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<InventoryBrand[]>([])
  const modalDataFetchedRef = useRef(false)

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0),
    [items]
  )

  async function fetchModalData() {
    if (modalDataFetchedRef.current) return
    modalDataFetchedRef.current = true
    const [plResult, catResult, brandResult] = await Promise.all([
      supabase
        .from('price_lists')
        .select('id, business_id, name, description, multiplier, is_default, created_at')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('categories')
        .select('id, business_id, name, icon')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('position'),
      supabase
        .from('brands')
        .select('id, name')
        .eq('business_id', businessId)
        .order('name'),
    ])
    if (plResult.data) setPriceLists(plResult.data as PriceList[])
    if (catResult.data) setCategories(catResult.data as Category[])
    if (brandResult.data) setBrands(brandResult.data as InventoryBrand[])
  }

  function addProductToItems(product: { id: string; name: string; cost: number }) {
    const existing = items.find(i => i.product_id === product.id)
    if (existing) {
      onItemsChange(
        items.map(i =>
          i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      )
    } else {
      onItemsChange([
        ...items,
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_cost: product.cost,
          update_cost: false,
          _original_cost: product.cost,
        },
      ])
    }
  }

  function handleProductSelect(product: ProductSearchResult) {
    addProductToItems(product)
  }

  function handleCreateNew(initialName: string) {
    setNewProductInitialName(initialName)
    void fetchModalData()
    setNewProductOpen(true)
  }

  const updateItem = useCallback(
    (index: number, patch: Partial<MercaderiaItem>) => {
      onItemsChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    },
    [items, onItemsChange]
  )

  function removeItem(index: number) {
    onItemsChange(items.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <div ref={searchInputRef as React.RefObject<HTMLDivElement>}>
        <ProductSearchInput
          businessId={businessId}
          supabaseClient={supabase}
          onSelect={handleProductSelect}
          onCreateNew={handleCreateNew}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div
              key={item.product_id}
              className="rounded-lg border border-edge bg-surface p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-heading truncate">{item.product_name}</span>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="p-1 rounded text-hint hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-hint whitespace-nowrap">Cant.</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.quantity}
                    onChange={e =>
                      updateItem(index, { quantity: Math.max(1, parseInt(e.target.value) || 1) })
                    }
                    className="w-16 h-8 rounded-lg border border-input bg-card px-2 text-sm text-center text-body focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-input/30"
                  />
                </div>

                <div className="flex items-center gap-1.5 flex-1">
                  <label className="text-xs text-hint whitespace-nowrap">Costo unit.</label>
                  <div className="relative flex-1">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-hint">$</span>
                    <input
                      ref={
                        index === 0
                          ? (firstItemCostRef as React.RefObject<HTMLInputElement>)
                          : undefined
                      }
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_cost}
                      onChange={e =>
                        updateItem(index, { unit_cost: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full h-8 rounded-lg border border-input bg-card pl-5 pr-2 text-sm text-body focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-input/30"
                    />
                  </div>
                  {item.unit_cost !== item._original_cost && item._original_cost > 0 && (
                    <span className="text-[10px] text-amber-500 whitespace-nowrap">
                      era ${item._original_cost.toLocaleString('es-AR')}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label
                  className={`flex items-center gap-2 select-none ${
                    canUpdateStock ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                  }`}
                  title={!canUpdateStock ? 'Sin permiso de escritura' : undefined}
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.update_cost}
                    disabled={!canUpdateStock}
                    onClick={() =>
                      canUpdateStock && updateItem(index, { update_cost: !item.update_cost })
                    }
                    className={`relative w-8 h-4 rounded-full transition-colors shrink-0 disabled:cursor-not-allowed ${
                      item.update_cost && canUpdateStock
                        ? 'bg-primary'
                        : 'bg-muted-foreground/40'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                        item.update_cost && canUpdateStock ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                  <span className="text-xs text-hint">Actualizar costo</span>
                </label>

                <span className="text-xs font-semibold text-heading">
                  ${(item.quantity * item.unit_cost).toLocaleString('es-AR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div
          ref={totalRef as React.RefObject<HTMLDivElement>}
          className="flex items-center justify-between rounded-lg border border-edge/60 bg-surface-alt px-4 py-2.5"
        >
          <span className="text-sm text-hint">Total</span>
          <span className="text-base font-semibold text-heading">
            $
            {total.toLocaleString('es-AR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      )}

      <NewProductModal
        open={newProductOpen}
        onClose={() => setNewProductOpen(false)}
        businessId={businessId}
        priceLists={priceLists}
        categories={categories}
        brands={brands}
        initialName={newProductInitialName}
        onCreated={product => addProductToItems(product as unknown as NewProductResult)}
      />
    </div>
  )
}
