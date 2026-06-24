'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Trash } from '@phosphor-icons/react/dist/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cn } from '@/lib/utils'
import type { MercaderiaItem } from './types'
import ProductSearchInput, { type ProductResult } from './ProductSearchInput'
import type { PriceList } from '@/lib/types'
import type { InventoryBrand } from '@/components/inventory/types'
import NewProductModal from '@/components/inventory/NewProductModal'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

interface Category {
  id: string
  name: string
  icon: string
}

interface NewProductResult {
  id: string
  name: string
  cost: number
}

interface Props {
  businessId: string
  operatorId: string | null
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
  operatorId,
  supabaseClient,
  items,
  onItemsChange,
  canUpdateStock,
  searchInputRef,
  firstItemCostRef,
  totalRef,
}: Props) {
  const formatMoney = useFormatMoney()
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
    const [plResult, catResult, brandResult] = await Promise.all([
      supabaseClient
        .from('price_lists')
        .select('id, business_id, name, description, multiplier, created_at, rounding_step, rounding_up')
        .eq('business_id', businessId)
        .order('name'),
      supabaseClient
        .from('categories')
        .select('id, business_id, name, icon')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('position'),
      supabaseClient
        .from('brands')
        .select('id, name')
        .eq('business_id', businessId)
        .order('name'),
    ])
    if (!plResult.error && !catResult.error && !brandResult.error) {
      modalDataFetchedRef.current = true
    }
    if (plResult.data) setPriceLists(plResult.data as PriceList[])
    if (catResult.data) setCategories(catResult.data as Category[])
    if (brandResult.data) setBrands(brandResult.data as InventoryBrand[])
  }

  function addProductToItems(product: ProductResult) {
    const existing = items.find(
      i => i.product_id === product.product_id &&
           (i.variant_id ?? null) === (product.variant_id ?? null)
    )
    if (existing) {
      onItemsChange(
        items.map(i =>
          i.product_id === product.product_id &&
          (i.variant_id ?? null) === (product.variant_id ?? null)
            ? { ...i, quantity: i.quantity + 1 }
            : i
        )
      )
    } else {
      onItemsChange([
        ...items,
        {
          product_id: product.product_id,
          product_name: product.product_name,
          variant_id: product.variant_id ?? null,
          variant_label: product.variant_label ?? null,
          quantity: 1,
          unit_cost: product.cost,
          update_cost: false,
          _original_cost: product.cost,
          stock: product.stock,
          _original_quantity: 0,
        },
      ])
    }
  }

  async function handleCreateNew(initialName: string) {
    setNewProductInitialName(initialName)
    await fetchModalData()
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
          supabaseClient={supabaseClient}
          onSelect={addProductToItems}
          onCreateNew={handleCreateNew}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div
              key={`${item.product_id}:${item.variant_id ?? 'null'}`}
              className="rounded-lg border border-edge bg-surface p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-heading truncate">
                  {item.product_name}
                  {item.variant_label && (
                    <span className="font-normal text-hint"> — {item.variant_label}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="p-1 rounded text-hint hover:text-destructive hover:bg-destructive/10 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 shrink-0"
                >
                  <Trash size={13} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-hint whitespace-nowrap">Cant.</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={item.quantity === 0 ? '' : item.quantity}
                    onChange={e => {
                      const parsed = parseInt(e.target.value, 10)
                      updateItem(index, { quantity: Number.isNaN(parsed) ? 0 : Math.max(0, parsed) })
                    }}
                    placeholder="0"
                    aria-invalid={item.quantity < 1}
                    className={cn(
                      'w-16 h-8 rounded-lg border bg-card px-2 text-sm text-center text-body focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-input/30',
                      item.quantity < 1 ? 'border-destructive' : 'border-input'
                    )}
                  />
                </div>

                <div className="flex items-center gap-1.5 ml-auto">
                  {item.unit_cost !== item._original_cost && item._original_cost > 0 && (
                    <span className="text-[10px] text-amber-500 whitespace-nowrap">
                      era {formatMoney(item._original_cost)}
                    </span>
                  )}
                  <label className="text-xs text-hint whitespace-nowrap">Costo unit.</label>
                  <div className="relative">
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
                      inputMode="decimal"
                      value={item.unit_cost}
                      onChange={e =>
                        updateItem(index, { unit_cost: parseFloat(e.target.value) || 0 })
                      }
                      className="w-24 h-8 rounded-lg border border-input bg-card pl-5 pr-2 text-sm text-right text-body tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 dark:bg-input/30"
                    />
                  </div>
                </div>
              </div>

              {(() => {
                const delta = item.quantity - item._original_quantity
                const stockAfter = item.stock + delta
                const noun = item.variant_label ? 'esta variante' : 'este producto'
                const unit = Math.abs(stockAfter) === 1 ? 'unidad' : 'unidades'
                const numClass = cn(
                  'tabular-nums font-semibold',
                  delta > 0 ? 'text-success'
                    : delta < 0 ? 'text-warning'
                    : 'text-body'
                )
                if (delta === 0) {
                  return (
                    <p className="text-xs text-hint">
                      El stock de {noun} se mantiene en{' '}
                      <span className={numClass}>{stockAfter}</span> {unit}.
                    </p>
                  )
                }
                return (
                  <p className="text-xs text-hint">
                    El stock de {noun} pasa de{' '}
                    <span className="tabular-nums font-medium text-body">{item.stock}</span> a{' '}
                    <span className={numClass}>{stockAfter}</span> {unit} al guardar.
                  </p>
                )
              })()}

              <div className="flex items-center justify-between">
                <label
                  className={cn(
                    'flex items-center gap-2 select-none',
                    canUpdateStock ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                  )}
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
                    className={cn(
                      'relative w-8 h-4 rounded-full transition-colors shrink-0 disabled:cursor-not-allowed',
                      item.update_cost && canUpdateStock ? 'bg-primary' : 'bg-muted-foreground/40'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform',
                        item.update_cost && canUpdateStock ? 'translate-x-4' : 'translate-x-0'
                      )}
                    />
                  </button>
                  <span className="text-xs text-hint">Actualizar costo</span>
                </label>

                <span className="text-xs font-semibold text-heading">
                  {formatMoney(item.quantity * item.unit_cost)}
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
            {formatMoney(total)}
          </span>
        </div>
      )}

      <NewProductModal
        open={newProductOpen}
        onClose={() => setNewProductOpen(false)}
        businessId={businessId}
        operatorId={operatorId}
        priceLists={priceLists}
        categories={categories}
        brands={brands}
        initialName={newProductInitialName}
        onCreated={product => {
          const p = product as unknown as NewProductResult
          addProductToItems({
            product_id: p.id,
            product_name: p.name,
            variant_id: null,
            variant_label: null,
            stock: 0,
            cost: p.cost,
          })
        }}
      />
    </div>
  )
}
