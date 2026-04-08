'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import NewPriceListModal from '@/components/price-lists/NewPriceListModal'
import EditPriceListModal from '@/components/price-lists/EditPriceListModal'
import ProductOverrideModal from '@/components/price-lists/ProductOverrideModal'
import BrandOverrideModal from '@/components/price-lists/BrandOverrideModal'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { PriceListProduct } from '@/components/price-lists/types'
import { calculateProductPrice } from '@/lib/price-lists'

interface PriceListsPanelProps {
  businessId: string
  readOnly: boolean
  initialLists: PriceList[]
  products: PriceListProduct[]
  initialOverrides: PriceListOverride[]
}

interface ProductRowData {
  product: PriceListProduct
  productOverride: PriceListOverride | null
  brandOverride: PriceListOverride | null
  activeMultiplier: number
  finalPrice: number
  margin: number | null
}

interface GroupedPriceRows {
  key: string
  brandId: string | null
  brandName: string | null
  label: string
  brandOverride: PriceListOverride | null
  rows: ProductRowData[]
}

function getMarginPercent(multiplier: number): number {
  return Math.round((multiplier - 1) * 100)
}

export default function PriceListsPanel({
  businessId,
  readOnly,
  initialLists,
  products,
  initialOverrides,
}: PriceListsPanelProps) {
  const [lists, setLists] = useState<PriceList[]>(initialLists)
  const [overrides, setOverrides] = useState<PriceListOverride[]>(initialOverrides)
  const [activeListId, setActiveListId] = useState<string | null>(initialLists[0]?.id ?? null)
  const [showNewListModal, setShowNewListModal] = useState(false)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [overrideProductId, setOverrideProductId] = useState<string | null>(null)
  const [overrideBrandId, setOverrideBrandId] = useState<string | null>(null)
  const [savingDefaultId, setSavingDefaultId] = useState<string | null>(null)
  const [crudError, setCrudError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const supabase = useMemo(() => createClient(), [])

  const activeList = useMemo(
    () => lists.find(list => list.id === activeListId) ?? null,
    [lists, activeListId]
  )

  const editingList = useMemo(
    () => lists.find(list => list.id === editingListId) ?? null,
    [lists, editingListId]
  )

  const overrideProduct = useMemo(
    () => products.find(product => product.id === overrideProductId) ?? null,
    [products, overrideProductId]
  )

  const activeListOverrides = useMemo(() => {
    if (!activeList) return []
    return overrides.filter(override => override.price_list_id === activeList.id)
  }, [overrides, activeList])

  const selectedBrandOverride = useMemo(() => {
    if (!overrideBrandId) return null
    return activeListOverrides.find(override => {
      return override.product_id === null && override.brand_id === overrideBrandId
    }) ?? null
  }, [activeListOverrides, overrideBrandId])

  const productRows = useMemo(() => {
    if (!activeList) return []

    return products.map(product => {
      const productOverride = activeListOverrides.find(
        override => override.product_id === product.id
      ) ?? null

      const productBrandId = product.brand_id ?? null
      const brandOverride =
        productOverride || !productBrandId
          ? null
          : activeListOverrides.find(override => override.product_id === null && override.brand_id === productBrandId) ?? null

      const activeMultiplier =
        productOverride?.multiplier ?? brandOverride?.multiplier ?? activeList.multiplier

      const finalPrice = calculateProductPrice(
        product.cost,
        product.price,
        product.id,
        product.brand_id ?? null,
        activeList,
        overrides
      )
      const margin = product.cost <= 0 ? null : getMarginPercent(activeMultiplier)

      return {
        product,
        productOverride,
        brandOverride,
        activeMultiplier,
        finalPrice,
        margin,
      }
    })
  }, [products, activeList, activeListOverrides, overrides])

  const filteredRows = useMemo(() => {
    if (!search.trim()) return productRows
    const q = search.trim().toLowerCase()
    return productRows.filter(row =>
      row.product.name.toLowerCase().includes(q) ||
      (row.product.brand?.name ?? '').toLowerCase().includes(q)
    )
  }, [productRows, search])

  const groupedRows = useMemo(() => {
    const groups = new Map<string, GroupedPriceRows>()

    for (const row of filteredRows) {
      const brandId = row.product.brand_id ?? null
      const brandName = row.product.brand?.name ?? null
      const brandKey = brandId ?? '__sin_marca__'

      if (!groups.has(brandKey)) {
        const brandOverride = brandId
          ? activeListOverrides.find(override => override.product_id === null && override.brand_id === brandId) ?? null
          : null

        groups.set(brandKey, {
          key: brandKey,
          brandId,
          brandName,
          label: brandName ?? 'Sin marca',
          brandOverride,
          rows: [],
        })
      }

      groups.get(brandKey)?.rows.push(row)
    }

    return Array.from(groups.values())
  }, [filteredRows, activeListOverrides])

  function handleCreated(list: PriceList) {
    setLists(prev => {
      const base = list.is_default
        ? prev.map(l => ({ ...l, is_default: false }))
        : prev
      return [...base, list]
    })
    setActiveListId(list.id)
    setShowNewListModal(false)
  }

  function handleSaved(updated: PriceList) {
    setLists(prev => prev.map(list => (list.id === updated.id ? updated : list)))
    setEditingListId(null)
  }

  function handleDeleted(id: string) {
    setLists(prev => {
      const next = prev.filter(list => list.id !== id)
      if (activeListId === id) {
        setActiveListId(next[0]?.id ?? null)
      }
      return next
    })
    setOverrides(prev => prev.filter(override => override.price_list_id !== id))
    setEditingListId(null)
  }

  function handleSavedOverride(productId: string, override: PriceListOverride | null) {
    if (!activeList) return

    setOverrides(prev => {
      const withoutProduct = prev.filter(item => !(item.price_list_id === activeList.id && item.product_id === productId))
      if (!override) return withoutProduct
      return [...withoutProduct, override]
    })
    setOverrideProductId(null)
  }

  function handleSavedBrandOverride(brandId: string, override: PriceListOverride) {
    if (!activeList) return

    setOverrides(prev => {
      const withoutBrand = prev.filter(item => {
        if (item.price_list_id !== activeList.id || item.product_id !== null) return true
        return item.brand_id !== brandId
      })

      return [...withoutBrand, override]
    })

    setOverrideBrandId(null)
  }

  function handleDeletedBrandOverride(brandId: string) {
    if (!activeList) return

    setOverrides(prev => prev.filter(item => {
      if (item.price_list_id !== activeList.id || item.product_id !== null) return true
      return item.brand_id !== brandId
    }))

    setOverrideBrandId(null)
  }

  async function makeDefault(listId: string) {
    if (!businessId) {
      setCrudError('No se encontro el negocio activo para actualizar la lista por defecto.')
      return
    }

    setSavingDefaultId(listId)
    setCrudError(null)

    const { error } = await supabase.rpc('swap_default_price_list', {
      p_price_list_id: listId,
      p_business_id: businessId,
    })

    if (error) {
      setCrudError(error.message)
      setSavingDefaultId(null)
      return
    }

    setLists(prev => prev.map(list => ({ ...list, is_default: list.id === listId })))
    setSavingDefaultId(null)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Listas de precios">
        {!readOnly && (
          <Button
            className="h-9 px-4 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
            onClick={() => setShowNewListModal(true)}
            disabled={!businessId}
          >
            + Nueva lista
          </Button>
        )}
      </PageHeader>

      <div className="bg-surface border-b border-edge/60 px-5 py-3">
        {lists.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge bg-surface-alt px-4 py-3 text-sm text-hint">
            No hay listas de precios creadas. Crea la primera lista para comenzar.
          </div>
        ) : (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {lists.map(list => {
              const isActive = activeListId === list.id

              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => setActiveListId(list.id)}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-primary text-white'
                      : 'bg-surface-alt text-body hover:bg-hover-bg'
                  }`}
                >
                  {list.name}
                  {list.is_default && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'}`}>
                      Default
                    </span>
                  )}
                </button>
              )
            })}
            {!readOnly && (
              <button
                type="button"
                onClick={() => setShowNewListModal(true)}
                className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-surface-alt text-body hover:bg-hover-bg transition-colors"
                aria-label="Crear lista"
                title="Crear lista"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {crudError && (
        <div className="mx-5 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {crudError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5">
        {!activeList ? (
          <div className="surface-card p-12 text-center text-hint">
            Selecciona una lista de precios para ver los productos.
          </div>
        ) : (
          <div className="surface-card p-2">
            <div className="px-2 pb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-heading">{activeList.name}</h2>
              {activeList.description && <span className="text-xs text-hint">{activeList.description}</span>}
              <div className="relative ml-auto">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar producto o marca..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-edge bg-surface-alt text-body placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary/40 w-56"
                />
              </div>
              <span className="text-xs text-subtle">Global: x{activeList.multiplier.toFixed(4)}</span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg text-xs"
                onClick={() => setEditingListId(activeList.id)}
                disabled={readOnly}
              >
                Editar lista
              </Button>
              {!activeList.is_default && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg text-xs"
                  onClick={() => void makeDefault(activeList.id)}
                  disabled={readOnly || savingDefaultId === activeList.id || !businessId}
                >
                  {savingDefaultId === activeList.id ? 'Guardando...' : 'Marcar default'}
                </Button>
              )}
            </div>

            <GroupedPriceRowsTable
              key={`${activeList.id}|${search}`}
              groupedRows={groupedRows}
              filteredRowsCount={filteredRows.length}
              readOnly={readOnly}
              onEditBrandOverride={setOverrideBrandId}
              onEditProductOverride={setOverrideProductId}
            />
          </div>
        )}
      </div>

      {businessId && (
        <NewPriceListModal
          open={showNewListModal}
          onClose={() => setShowNewListModal(false)}
          businessId={businessId}
          hasDefault={lists.some(l => l.is_default)}
          onCreated={handleCreated}
        />
      )}

      {editingList && (
        <EditPriceListModal
          key={editingList.id}
          open={Boolean(editingList)}
          onClose={() => setEditingListId(null)}
          list={editingList}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}

      {activeList && overrideProduct && (
        <ProductOverrideModal
          key={`${activeList.id}:${overrideProduct.id}:${activeListOverrides.find(override => override.product_id === overrideProduct.id)?.id ?? 'new'}`}
          open={Boolean(overrideProduct)}
          onClose={() => setOverrideProductId(null)}
          priceListId={activeList.id}
          product={overrideProduct}
          currentOverride={
            activeListOverrides.find(override => override.product_id === overrideProduct.id) ?? null
          }
          brandOverride={
            productRows.find(row => row.product.id === overrideProduct.id)?.brandOverride ?? null
          }
          listMultiplier={activeList.multiplier}
          effectiveMultiplier={
            productRows.find(row => row.product.id === overrideProduct.id)?.activeMultiplier ?? activeList.multiplier
          }
          onSaved={override => handleSavedOverride(overrideProduct.id, override)}
        />
      )}

      {activeList && overrideBrandId && (
        <BrandOverrideModal
          key={`${activeList.id}:${overrideBrandId}:${selectedBrandOverride?.id ?? 'new'}`}
          open={Boolean(overrideBrandId)}
          onClose={() => setOverrideBrandId(null)}
          brandId={overrideBrandId}
          brandName={groupedRows.find(group => group.brandId === overrideBrandId)?.label ?? 'Marca'}
          priceListId={activeList.id}
          defaultPriceList={activeList}
          existingOverride={selectedBrandOverride}
          onSaved={override => handleSavedBrandOverride(overrideBrandId, override)}
          onDeleted={() => handleDeletedBrandOverride(overrideBrandId)}
        />
      )}
    </div>
  )
}

interface GroupedPriceRowsTableProps {
  groupedRows: GroupedPriceRows[]
  filteredRowsCount: number
  readOnly: boolean
  onEditBrandOverride: (brandId: string) => void
  onEditProductOverride: (productId: string) => void
}

function GroupedPriceRowsTable({
  groupedRows,
  filteredRowsCount,
  readOnly,
  onEditBrandOverride,
  onEditProductOverride,
}: GroupedPriceRowsTableProps) {
  const [visibleGroupCount, setVisibleGroupCount] = useState(20)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleGroupCount(prev => prev + 20)
        }
      },
      { rootMargin: '300px' }
    )

    observer.observe(sentinel)

    return () => observer.disconnect()
  }, [])

  const visibleGroups = useMemo(
    () => groupedRows.slice(0, visibleGroupCount),
    [groupedRows, visibleGroupCount]
  )

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Producto</TableHead>
            <TableHead>Marca</TableHead>
            <TableHead className="text-right">Costo</TableHead>
            <TableHead className="text-right">Precio lista</TableHead>
            <TableHead className="text-right">Margen %</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-28 text-center text-sm text-hint">
                No hay productos activos para calcular precios.
              </TableCell>
            </TableRow>
          ) : (
            visibleGroups.map(group => (
              <Fragment key={`brand-${group.key}`}>
                <TableRow className="bg-surface-alt/70">
                  <TableCell colSpan={6}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{group.label}</span>
                        {group.brandOverride && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary text-primary-foreground">
                            +{((group.brandOverride.multiplier - 1) * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => group.brandId && onEditBrandOverride(group.brandId)}
                        aria-label={`Editar override de marca ${group.label}`}
                        title="Editar override de marca"
                        disabled={readOnly || !group.brandId}
                      >
                        <Pencil size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>

                {group.rows.map(row => (
                  <TableRow key={row.product.id}>
                    <TableCell>
                      <p className="font-medium text-heading">{row.product.name}</p>
                      <p className="text-xs text-hint">{row.product.categories?.name ?? 'Sin categoria'}</p>
                    </TableCell>
                    <TableCell className="text-body">{row.product.brand?.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">${row.product.cost.toLocaleString('es-AR')}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      ${row.finalPrice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {(row.productOverride ?? row.brandOverride) && (
                        <span className="ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary text-primary-foreground">
                          Override
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.margin === null ? (
                        <span className="text-hint">—</span>
                      ) : (
                        <span className={row.margin > 0 ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                          {row.margin}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => onEditProductOverride(row.product.id)}
                          aria-label={`Editar override de ${row.product.name}`}
                          title="Editar override"
                          disabled={readOnly}
                        >
                          <Pencil size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
      <div ref={sentinelRef} />
      {visibleGroupCount < groupedRows.length && (
        <p className="py-3 text-center text-xs text-subtle">
          Mostrando {visibleGroups.reduce((total, group) => total + group.rows.length, 0)} de {filteredRowsCount} productos — seguí scrolleando para ver más
        </p>
      )}
    </>
  )
}
