'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Download, Pencil, Plus, Search, X } from 'lucide-react'
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
import ExportPriceListModal from '@/components/price-lists/ExportPriceListModal'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { PriceListProduct } from '@/components/price-lists/types'
import type { PriceListExportItem } from '@/components/price-lists/ExportPriceListModal'
import { calculateProductPrice } from '@/lib/price-lists'
import { trackFeatureUsed } from '@/lib/analytics'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { usePillIndicator } from '@/hooks/usePillIndicator'

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
  useEffect(() => { trackFeatureUsed('price_lists') }, [])

  const [lists, setLists] = useState<PriceList[]>(initialLists)
  const [overrides, setOverrides] = useState<PriceListOverride[]>(initialOverrides)
  const [activeListId, setActiveListId] = useState<string | null>(initialLists[0]?.id ?? null)
  const { setRef: setListRef, indicator: listIndicator } = usePillIndicator(activeListId ?? '')
  const [showNewListModal, setShowNewListModal] = useState(false)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [overrideProductId, setOverrideProductId] = useState<string | null>(null)
  const [overrideBrandId, setOverrideBrandId] = useState<string | null>(null)
  const [showExportModal, setShowExportModal] = useState(false)
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

  const editingListOverrides = useMemo(() => {
    if (!editingListId) return []
    return overrides.filter(o => o.price_list_id === editingListId)
  }, [overrides, editingListId])

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

  const exportItems = useMemo<PriceListExportItem[]>(() => {
    return productRows.map(row => ({
      productId: row.product.id,
      productName: row.product.name,
      brandId: row.product.brand_id ?? null,
      brandName: row.product.brand?.name ?? null,
      categoryId: row.product.category_id ?? null,
      categoryName: row.product.categories?.name ?? null,
      cost: row.product.cost,
      basePrice: row.product.price,
      listPrice: row.finalPrice,
      marginPercent: row.margin,
      multiplier: row.activeMultiplier,
      hasOverride: Boolean(row.productOverride ?? row.brandOverride),
    }))
  }, [productRows])

  function handleCreated(
    list: PriceList,
    newOverrides: { price_list_id: string; product_id: string; brand_id: null; multiplier: number }[]
  ) {
    setLists(prev => {
      const base = list.is_default
        ? prev.map(l => ({ ...l, is_default: false }))
        : prev
      return [...base, list]
    })

    if (newOverrides.length > 0) {
      setOverrides(prev => [
        ...prev,
        ...newOverrides.map((o, i) => ({
          id: `auto-${list.id}-${i}`,  // temp id — replaced on next page load
          price_list_id: o.price_list_id,
          product_id: o.product_id,
          brand_id: o.brand_id,
          multiplier: o.multiplier,
        })),
      ])
    }

    setActiveListId(list.id)
    setShowNewListModal(false)
  }

  function handleSaved(
    updated: PriceList,
    upsertedOverrides: PriceListOverride[],
    deletedOverrideIds: string[]
  ) {
    setLists(prev => prev.map(list => (list.id === updated.id ? updated : list)))

    setOverrides(prev => {
      let next = prev.filter(o => !deletedOverrideIds.includes(o.id))
      for (const upserted of upsertedOverrides) {
        const idx = next.findIndex(o => o.id === upserted.id)
        if (idx >= 0) {
          next = next.map(o => (o.id === upserted.id ? upserted : o))
        } else {
          next = [...next, upserted]
        }
      }
      return next
    })

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
      setCrudError('No se encontró el negocio activo.')
      return
    }

    setSavingDefaultId(listId)
    setCrudError(null)

    const { error } = await supabase.rpc('swap_default_price_list', {
      p_price_list_id: listId,
      p_business_id: businessId,
    })

    if (error) {
      console.error('swap_default_price_list:', error)
      setCrudError('No se pudo cambiar la lista predeterminada. Intentá de nuevo.')
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
            <Plus size={15} />
            Nueva lista
          </Button>
        )}
      </PageHeader>

      <div className="bg-surface border-b border-edge/60 px-5 py-3">
        {lists.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge bg-surface-alt px-4 py-3 text-sm text-hint">
            No hay listas de precios creadas. Crea la primera lista para comenzar.
          </div>
        ) : (
          <div className="pill-tabs overflow-x-auto flex-nowrap pb-1">
            {listIndicator && (
              <span
                className="pill-tab-indicator"
                style={{
                  transform: `translateX(${listIndicator.left}px)`,
                  width: listIndicator.width,
                }}
              />
            )}
            {lists.map(list => {
              const isActive = activeListId === list.id

              return (
                <button
                  key={list.id}
                  type="button"
                  ref={setListRef(list.id)}
                  onClick={() => setActiveListId(list.id)}
                  className={`pill-tab whitespace-nowrap${isActive ? ' pill-tab-active' : ''}`}
                >
                  {list.name}
                  {list.is_default && (
                    <span className="ml-1 rounded-full border border-primary/25 bg-primary/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      Predeterminada
                    </span>
                  )}
                </button>
              )
            })}
            {!readOnly && (
              <button
                type="button"
                onClick={() => setShowNewListModal(true)}
                className="pill-tab"
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
        <div className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>{crudError}</span>
          <button
            type="button"
            onClick={() => setCrudError(null)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Cerrar"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5">
        {!activeList ? (
          <div className="surface-card p-12 text-center text-hint">
            Selecciona una lista de precios para ver los productos.
          </div>
        ) : (
          <div className="surface-card overflow-hidden p-0">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-edge/50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-heading font-display leading-none">{activeList.name}</h2>
                  <span className="text-xs text-subtle">+{getMarginPercent(activeList.multiplier)}% sobre costo</span>
                  {activeList.description && (
                    <span className="text-xs text-hint truncate max-w-[240px]">{activeList.description}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar producto o marca..."
                    className="pl-7 pr-3 h-8 text-xs rounded-lg border border-edge bg-card text-body placeholder:text-hint focus:outline-none focus:ring-1 focus:ring-primary/40 w-48"
                  />
                </div>
                <div className="h-5 w-px bg-edge/60 mx-0.5" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-lg px-2"
                  onClick={() => setShowExportModal(true)}
                  disabled={exportItems.length === 0}
                  title="Exportar lista a CSV"
                  aria-label="Exportar lista a CSV"
                >
                  <Download size={14} />
                </Button>
                {!activeList.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-xs"
                    onClick={() => void makeDefault(activeList.id)}
                    disabled={readOnly || savingDefaultId === activeList.id || !businessId}
                    title="Esta lista se aplicará automáticamente a las ventas nuevas en el POS"
                  >
                    {savingDefaultId === activeList.id ? 'Guardando...' : 'Predeterminar'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg text-xs"
                  onClick={() => setEditingListId(activeList.id)}
                  disabled={readOnly}
                >
                  Editar lista
                </Button>
              </div>
            </div>

            <GroupedPriceRowsTable
              key={`${activeList.id}|${search}`}
              groupedRows={groupedRows}
              filteredRowsCount={filteredRows.length}
              readOnly={readOnly}
              searchActive={!!search.trim()}
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
          products={products}
          onCreated={handleCreated}
        />
      )}

      {editingList && (
        <EditPriceListModal
          key={editingList.id}
          open={Boolean(editingList)}
          onClose={() => setEditingListId(null)}
          list={editingList}
          products={products}
          existingOverrides={editingListOverrides}
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

      {activeList && showExportModal && (
        <ExportPriceListModal
          key={activeList.id}
          open={showExportModal}
          onClose={() => setShowExportModal(false)}
          priceListName={activeList.name}
          items={exportItems}
        />
      )}
    </div>
  )
}

interface GroupedPriceRowsTableProps {
  groupedRows: GroupedPriceRows[]
  filteredRowsCount: number
  readOnly: boolean
  searchActive: boolean
  onEditBrandOverride: (brandId: string) => void
  onEditProductOverride: (productId: string) => void
}

function GroupedPriceRowsTable({
  groupedRows,
  filteredRowsCount,
  readOnly,
  searchActive,
  onEditBrandOverride,
  onEditProductOverride,
}: GroupedPriceRowsTableProps) {
  const formatMoney = useFormatMoney()
  const [visibleGroupCount, setVisibleGroupCount] = useState(20)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => searchActive ? new Set(groupedRows.map(g => g.key)) : new Set()
  )

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
            <TableHead className="text-right">Costo</TableHead>
            <TableHead className="text-right">Precio lista</TableHead>
            <TableHead className="text-right">Margen %</TableHead>
            <TableHead className="text-right">Ajuste</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupedRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-28 text-center text-sm text-hint">
                No hay productos activos para calcular precios.
              </TableCell>
            </TableRow>
          ) : (
            visibleGroups.map(group => {
              const isExpanded = expandedGroups.has(group.key)
              return (
                <Fragment key={`brand-${group.key}`}>
                  <TableRow
                    className="bg-primary/[0.04] hover:bg-primary/[0.07] cursor-pointer select-none dark:bg-primary/[0.07] dark:hover:bg-primary/[0.10]"
                    onClick={() => toggleGroup(group.key)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          size={13}
                          className={`text-hint transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                        <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{group.label}</span>
                        <span className="text-xs text-hint">
                          {group.rows.length} {group.rows.length === 1 ? 'producto' : 'productos'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right">
                      {group.brandOverride && (
                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary text-primary-foreground">
                          +{getMarginPercent(group.brandOverride.multiplier)}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={e => { e.stopPropagation(); group.brandId && onEditBrandOverride(group.brandId) }}
                          aria-label={`Ajustar margen de la marca ${group.label}`}
                          title={`Ajustar margen de ${group.label}`}
                          disabled={readOnly || !group.brandId}
                        >
                          <Pencil size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  {isExpanded && group.rows.map(row => (
                    <TableRow key={row.product.id}>
                      <TableCell>
                        <p className="font-medium text-heading">{row.product.name}</p>
                        <p className="text-xs text-hint">{row.product.categories?.name ?? 'Sin categoría'}</p>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums${row.product.cost === 0 ? ' text-hint' : ''}`}>
                        {formatMoney(row.product.cost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.finalPrice)}
                        {(row.productOverride ?? row.brandOverride) && (
                          <span className="ml-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                            Ajuste
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.margin === null ? (
                          <span className="text-hint">—</span>
                        ) : (
                          <span className={
                            row.margin > 0
                              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                              : row.margin === 0
                                ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                : 'text-red-600 dark:text-red-400 font-semibold'
                          }>
                            {row.margin}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg text-xs gap-1.5"
                            onClick={() => onEditProductOverride(row.product.id)}
                            aria-label={`Ajustar precio de ${row.product.name}`}
                            title="Ajustar precio de este producto"
                            disabled={readOnly}
                          >
                            <Pencil size={13} />
                            Ajustar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              )
            })
          )}
        </TableBody>
      </Table>
      <div ref={sentinelRef} />
      {visibleGroupCount < groupedRows.length && (
        <p className="py-3 text-center text-xs text-subtle">
          Mostrando {visibleGroups.reduce((total, group) => total + group.rows.length, 0)} de {filteredRowsCount} productos. Desplazate para ver más.
        </p>
      )}
    </>
  )
}
