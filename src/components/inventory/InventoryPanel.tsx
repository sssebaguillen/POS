'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, LayoutList, SlidersHorizontal, X, CheckSquare, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PageHeader from '@/components/shared/PageHeader'
import FilterSidebar from '@/components/inventory/FilterSidebar'
import NewProductModal from '@/components/inventory/NewProductModal'
import EditProductModal from '@/components/inventory/EditProductModal'
import CategoryModal from '@/components/inventory/CategoryModal'
import BrandModal from '@/components/inventory/BrandModal'
import ImportProductsModal from '@/components/inventory/ImportProductsModal'
import ConfirmModal from '@/components/shared/ConfirmModal'
import BulkActionBar from '@/components/inventory/BulkActionBar'
import QuickEditCategoryModal from '@/components/inventory/QuickEditCategoryModal'
import QuickEditBrandModal from '@/components/inventory/QuickEditBrandModal'
import ProductCard from '@/components/inventory/ProductCard'
import ProductListRow from '@/components/inventory/ProductListRow'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct, SortOption } from '@/components/inventory/types'
import { getStatus } from '@/components/inventory/types'
import { useToast } from '@/hooks/useToast'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import Toast from '@/components/shared/Toast'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { trackFeatureUsed } from '@/lib/analytics'
import { fetchInventoryProducts } from '@/lib/inventory-products'

const PAGE_SIZE = 60

type ConfirmState = { title: string; message: string; onConfirm: () => void } | null

type FilterStatus = 'all' | 'low' | 'out' | 'discontinued'

interface Props {
  businessId: string | null
  operatorId: string | null
  readOnly: boolean
  initialProducts: InventoryProduct[]
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  priceLists: PriceList[]
  productOverrides: PriceListOverride[]
  initialViewMode?: 'grid' | 'list'
}

export default function InventoryPanel({ businessId, operatorId, readOnly, initialProducts, categories: initialCategories, brands: initialBrands, priceLists, productOverrides: initialProductOverrides, initialViewMode = 'list' }: Props) {
  const [products, setProducts] = useState(initialProducts)
  const [categories, setCategories] = useState<InventoryCategory[]>(initialCategories)
  const [brands, setBrands] = useState<InventoryBrand[]>(initialBrands)
  const [productOverrides, setProductOverrides] = useState<PriceListOverride[]>(initialProductOverrides)
  const [query, setQuery] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedBrands, setSelectedBrands] = useState<string[]>([])
  const [showFilterSidebar, setShowFilterSidebar] = useState(false)
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [showBrands, setShowBrands] = useState(false)
  const [editingProduct, setEditingProduct] = useState<InventoryProduct | null>(null)
  const [quickEditCategoryProduct, setQuickEditCategoryProduct] = useState<InventoryProduct | null>(null)
  const [quickEditBrandProduct, setQuickEditBrandProduct] = useState<InventoryProduct | null>(null)
  const [crudError, setCrudError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [sort, setSort] = useState<SortOption>({ field: 'name', dir: 'asc' })
  const [showInCatalogOnly, setShowInCatalogOnly] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialViewMode)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const { toast, showToast, dismissToast } = useToast()
  const formatMoney = useFormatMoney()

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const deleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const router = useRouter()

  const supabase = useMemo(() => createClient(), [])
  const { setRef, indicator } = usePillIndicator(statusFilter)

  const activeFilterCount = selectedCategories.length + selectedBrands.length + (showInCatalogOnly ? 1 : 0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(product => {
      const status = getStatus(product)
      const matchesQuery =
        q.length === 0 ||
        product.name.toLowerCase().includes(q) ||
        (product.sku ?? '').toLowerCase().includes(q) ||
        (product.barcode ?? '').toLowerCase().includes(q)
      const matchesCategory =
        selectedCategories.length === 0 ||
        (product.category_id !== null && selectedCategories.includes(product.category_id))
      const matchesBrand =
        selectedBrands.length === 0 ||
        (product.brand_id != null && selectedBrands.includes(product.brand_id))
      const matchesStatus = statusFilter === 'all' || status === statusFilter
      const matchesCatalog = !showInCatalogOnly || product.show_in_catalog === true
      return matchesQuery && matchesCategory && matchesBrand && matchesStatus && matchesCatalog
    })
  }, [products, query, selectedCategories, selectedBrands, statusFilter, showInCatalogOnly])

  const sorted = useMemo(() => {
    if (sort.field === 'name' && sort.dir === 'asc') return filtered
    const arr = [...filtered]
    if (sort.field === 'name') {
      arr.sort((a, b) => b.name.localeCompare(a.name))
      return arr
    }
    arr.sort((a, b) => {
      let va = 0
      let vb = 0
      if (sort.field === 'price') { va = a.price; vb = b.price }
      else if (sort.field === 'cost') { va = a.cost; vb = b.cost }
      else if (sort.field === 'stock') { va = a.stock; vb = b.stock }
      else if (sort.field === 'margin') {
        va = a.cost > 0 && a.price > 0 ? ((a.price - a.cost) / a.price) * 100 : 0
        vb = b.cost > 0 && b.price > 0 ? ((b.price - b.cost) / b.price) * 100 : 0
      }
      return sort.dir === 'asc' ? va - vb : vb - va
    })
    return arr
  }, [filtered, sort])

  const visibleProducts = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount])

  // Reset pagination when the filtered/sorted set changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(PAGE_SIZE)
  }, [query, selectedCategories, selectedBrands, showInCatalogOnly, sort, statusFilter])

  // Infinite scroll: load more products when near the bottom of the scroll area
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    function onScroll() {
      if (!el) return
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 400
      if (nearBottom && visibleCount < filtered.length) {
        setVisibleCount(prev => Math.min(prev + PAGE_SIZE, filtered.length))
      }
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [filtered.length, visibleCount])

  // Clear any pending deferred deletes on unmount
  useEffect(() => {
    const timers = deleteTimersRef.current
    return () => { timers.forEach(id => clearTimeout(id)) }
  }, [])

  const activeProducts = products.filter(p => p.is_active)
  const totalStock = activeProducts.reduce((acc, p) => acc + p.stock, 0)
  const inventoryValue = activeProducts.reduce((acc, p) => acc + p.cost * p.stock, 0)
  const avgMargin = (() => {
    const withCost = activeProducts.filter(p => p.cost > 0 && p.price > 0)
    if (withCost.length === 0) return 0
    const margins = withCost.map(p => ((p.price - p.cost) / p.price) * 100)
    return margins.reduce((a, b) => a + b, 0) / margins.length
  })()
  const outOfStock = activeProducts.filter(p => p.stock <= 0).length
  const lowStock = activeProducts.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
  const categoryCount = new Set(products.map(p => p.category_id).filter(Boolean)).size

  const updateProduct = useCallback(async (productId: string, values: Partial<InventoryProduct>) => {
    if (readOnly) {
      setCrudError('No tenés permiso para editar el inventario.')
      return
    }

    if (!businessId) {
      setCrudError('No se encontró el negocio activo para actualizar productos.')
      return
    }

    setCrudError(null)
    setLoadingId(productId)

    const { error } = await supabase
      .from('products')
      .update(values)
      .eq('id', productId)
      .eq('business_id', businessId)

    if (!error) {
      setProducts(prev => prev.map(product => {
        if (product.id !== productId) return product

        if (!Object.prototype.hasOwnProperty.call(values, 'brand_id')) {
          return { ...product, ...values }
        }

        const nextBrandId = (values.brand_id as string | null | undefined) ?? null
        const nextBrand = nextBrandId
          ? brands.find(brand => brand.id === nextBrandId) ?? null
          : null

        return {
          ...product,
          ...values,
          brand_id: nextBrandId,
          brand: nextBrand,
        }
      }))
    } else {
      setCrudError(error.message)
    }

    setLoadingId(null)
  }, [brands, businessId, readOnly, supabase])

  function handleBrandsChanged(updatedBrands: InventoryBrand[]) {
    setBrands(updatedBrands)
    setProducts(prev => prev.map(product => {
      if (!product.brand_id) {
        return { ...product, brand: null }
      }

      const nextBrand = updatedBrands.find(brand => brand.id === product.brand_id)
      if (!nextBrand) {
        return { ...product, brand_id: null, brand: null }
      }

      return {
        ...product,
        brand: { id: nextBrand.id, name: nextBrand.name },
      }
    }))
  }

  const handleQuickCategorySaved = useCallback((productId: string, categoryId: string | null, newCategory?: InventoryCategory) => {
    if (newCategory) {
      setCategories(prev => [...prev, newCategory].sort((a, b) => a.name.localeCompare(b.name)))
    }
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      const cat = categoryId
        ? (newCategory ?? categories.find(c => c.id === categoryId) ?? null)
        : null
      return { ...p, category_id: categoryId, categories: cat ? { name: cat.name, icon: cat.icon } : null }
    }))
  }, [categories])

  const handleQuickBrandSaved = useCallback((productId: string, brandId: string | null, newBrand?: InventoryBrand) => {
    if (newBrand) {
      setBrands(prev => [...prev, newBrand].sort((a, b) => a.name.localeCompare(b.name)))
    }
    setProducts(prev => prev.map(p => {
      if (p.id !== productId) return p
      const brand = brandId
        ? (newBrand ?? brands.find(b => b.id === brandId) ?? null)
        : null
      return { ...p, brand_id: brandId, brand: brand ? { id: brand.id, name: brand.name } : null }
    }))
  }, [brands])

  const handleDeleteProductImpl = useCallback((product: InventoryProduct) => {
    if (readOnly) {
      setCrudError('No tenés permiso para editar el inventario.')
      return
    }

    if (!businessId) {
      setCrudError('No se encontró el negocio activo para eliminar productos.')
      return
    }

    const bid = businessId
    const TOAST_DURATION = 6000

    setPendingConfirm({
      title: `Eliminar "${product.name}"`,
      message: 'El producto será eliminado. Tendrás unos segundos para deshacer.',
      onConfirm: () => {
        setCrudError(null)

        // Optimistically remove from UI immediately
        setProducts(prev => prev.filter(p => p.id !== product.id))

        showToast({
          message: `"${product.name}" eliminado`,
          duration: TOAST_DURATION,
          onUndo: () => {
            const timer = deleteTimersRef.current.get(product.id)
            if (timer !== undefined) {
              clearTimeout(timer)
              deleteTimersRef.current.delete(product.id)
            }
            setProducts(prev => [product, ...prev])
          },
        })

        // Schedule actual DB delete after toast expires
        const timer = setTimeout(async () => {
          deleteTimersRef.current.delete(product.id)
          const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', product.id)
            .eq('business_id', bid)
          if (error) {
            // DB delete failed — restore the product and surface the error
            setProducts(prev => [product, ...prev])
            setCrudError(error.message)
          }
        }, TOAST_DURATION + 500)

        deleteTimersRef.current.set(product.id, timer)
      },
    })
  }, [businessId, readOnly, showToast, supabase])

  function exportCsv() {
    const headers = ['id', 'nombre', 'categoria', 'precio', 'costo', 'stock', 'stock_minimo', 'activo']
    const rows = filtered.map(product => [
      product.id,
      product.name,
      product.categories?.name ?? '',
      Number(product.price).toFixed(2),
      Number(product.cost).toFixed(2),
      String(product.stock),
      String(product.min_stock),
      product.is_active ? 'si' : 'no',
    ])

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `stock-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleEdit = useCallback((product: InventoryProduct) => {
    if (readOnly) {
      setCrudError('No tenés permiso para editar el inventario.')
      return
    }
    setEditingProduct(product)
  }, [readOnly])

  const handleToggleActive = useCallback((product: InventoryProduct) => {
    void updateProduct(product.id, { is_active: !product.is_active })
  }, [updateProduct])

  const handleDeleteProduct = useCallback((product: InventoryProduct) => {
    handleDeleteProductImpl(product)
  }, [handleDeleteProductImpl])

  const handleQuickCategory = useCallback((product: InventoryProduct) => {
    if (readOnly) return
    setQuickEditCategoryProduct(product)
  }, [readOnly])

  const handleQuickBrand = useCallback((product: InventoryProduct) => {
    if (readOnly) return
    setQuickEditBrandProduct(product)
  }, [readOnly])

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    setSelectionMode(true)
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map(p => p.id)))
    setSelectionMode(true)
  }, [filtered])

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleCloseSelection = useCallback(() => {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }, [])

  const handleBulkDelete = useCallback(async () => {
    if (!businessId) return
    trackFeatureUsed('bulk_action')
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    const { data, error } = await supabase.rpc('bulk_delete_products', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_product_ids: ids,
    })
    setBulkLoading(false)
    if (error) {
      showToast({ message: error.message })
      return
    }
    const result = data as { deleted: number; discontinued: number } | null
    const deleted = result?.deleted ?? 0
    const discontinued = result?.discontinued ?? 0

    if (discontinued > 0 && deleted > 0) {
      showToast({ message: `${deleted} eliminados, ${discontinued} discontinuados (tenían ventas)` })
    } else if (discontinued > 0) {
      showToast({ message: `${discontinued} productos discontinuados (tenían ventas)` })
    } else {
      showToast({ message: `${deleted} productos eliminados` })
    }

    // Update local state: if no items were discontinued, filter them all out.
    // Mixed result: router.refresh() handles it (the RPC does not return which IDs remain).
    if (discontinued === 0) {
      setProducts(prev => prev.filter(p => !ids.includes(p.id)))
    }

    handleCloseSelection()
    router.refresh()
  }, [businessId, selectedIds, supabase, showToast, handleCloseSelection, router])

  const handleBulkActivate = useCallback(async () => {
    if (!businessId) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    const { data, error } = await supabase.rpc('bulk_set_product_status', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_product_ids: ids,
      p_is_active: true,
    })
    setBulkLoading(false)
    if (error) {
      showToast({ message: error.message })
      return
    }
    const result = data as { updated: number } | null
    showToast({ message: `${result?.updated ?? 0} productos activados` })
    // Update local state directly — do not rely on router.refresh()
    setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, is_active: true } : p))
    handleCloseSelection()
    router.refresh()
  }, [businessId, selectedIds, supabase, showToast, handleCloseSelection, router])

  const handleBulkDeactivate = useCallback(async () => {
    if (!businessId) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    const { data, error } = await supabase.rpc('bulk_set_product_status', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_product_ids: ids,
      p_is_active: false,
    })
    setBulkLoading(false)
    if (error) {
      showToast({ message: error.message })
      return
    }
    const result = data as { updated: number } | null
    showToast({ message: `${result?.updated ?? 0} productos discontinuados` })
    // Update local state directly — do not rely on router.refresh()
    setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, is_active: false } : p))
    handleCloseSelection()
    router.refresh()
  }, [businessId, selectedIds, supabase, showToast, handleCloseSelection, router])

  const handleBulkChangeCategory = useCallback(async (categoryId: string | null) => {
    if (!businessId) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    const { data, error } = await supabase.rpc('bulk_update_product_category', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_product_ids: ids,
      p_category_id: categoryId,
    })
    setBulkLoading(false)
    if (error) {
      showToast({ message: error.message })
      return
    }
    const result = data as { updated: number } | null
    const catName = categoryId ? categories.find(c => c.id === categoryId)?.name ?? '' : 'ninguna'
    showToast({ message: `${result?.updated ?? 0} productos → categoría: ${catName}` })
    // Update local state directly
    const nextCat = categoryId ? categories.find(c => c.id === categoryId) ?? null : null
    setProducts(prev => prev.map(p =>
      ids.includes(p.id)
        ? { ...p, category_id: categoryId, categories: nextCat ? { name: nextCat.name, icon: nextCat.icon } : null }
        : p
    ))
    handleCloseSelection()
    router.refresh()
  }, [businessId, selectedIds, supabase, showToast, handleCloseSelection, router, categories])

  const handleBulkChangeBrand = useCallback(async (brandId: string | null) => {
    if (!businessId) return
    setBulkLoading(true)
    const ids = Array.from(selectedIds)
    const { data, error } = await supabase.rpc('bulk_update_product_brand', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_product_ids: ids,
      p_brand_id: brandId,
    })
    setBulkLoading(false)
    if (error) {
      showToast({ message: error.message })
      return
    }
    const result = data as { updated: number } | null
    const brandName = brandId ? brands.find(b => b.id === brandId)?.name ?? '' : 'ninguna'
    showToast({ message: `${result?.updated ?? 0} productos → marca: ${brandName}` })
    // Update local state directly
    const nextBrand = brandId ? brands.find(b => b.id === brandId) ?? null : null
    setProducts(prev => prev.map(p =>
      ids.includes(p.id)
        ? { ...p, brand_id: brandId, brand: nextBrand ? { id: nextBrand.id, name: nextBrand.name } : null }
        : p
    ))
    handleCloseSelection()
    router.refresh()
  }, [businessId, selectedIds, supabase, showToast, handleCloseSelection, router, brands])

  if (!businessId) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="Inventario" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="surface-card p-6">
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              No se encontró tu negocio. Intentá recargar la página.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Inventario">
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={() => { setShowImport(true); trackFeatureUsed('import_products') }}
          disabled={readOnly || !businessId}
          title={readOnly ? 'Sin permiso de inventario' : undefined}
        >
          Importar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          Exportar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={() => setShowCategories(true)}
          disabled={readOnly}
          title={readOnly ? 'Sin permiso de inventario' : undefined}
        >
          Categorías
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={() => setShowBrands(true)}
          disabled={readOnly}
          title={readOnly ? 'Sin permiso de inventario' : undefined}
        >
          Marcas
        </Button>
        {!readOnly && (
          <Button
            size="sm"
            className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => setShowNewProduct(true)}
          >
            <Plus size={15} />
            Nuevo producto
          </Button>
        )}
      </PageHeader>

      <div className="bg-surface border-b border-edge/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar producto, marca o código..."
            className="h-9 max-w-xs rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={() => setShowFilterSidebar(true)}
            className={`h-9 px-4 rounded-xl border text-sm font-medium flex items-center gap-2 transition-colors shrink-0 ${
              activeFilterCount > 0
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-edge bg-surface text-body hover:bg-surface-alt'
            }`}
          >
            <SlidersHorizontal size={14} />
            Filtros
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          <div className="pill-tabs shrink-0">
            {indicator && (
              <span
                className="pill-tab-indicator"
                style={{
                  transform: `translateX(${indicator.left}px)`,
                  width: indicator.width,
                }}
              />
            )}
            {([
              { key: 'all', label: 'Todos' },
              { key: 'low', label: 'Stock bajo' },
              { key: 'out', label: 'Sin stock' },
              { key: 'discontinued', label: 'Discontinuados' },
            ] as const).map(s => (
              <button
                key={s.key}
                ref={setRef(s.key)}
                onClick={() => setStatusFilter(s.key)}
                className={`pill-tab${statusFilter === s.key ? ' pill-tab-active' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto shrink-0">
            <span className="text-xs text-subtle shrink-0 whitespace-nowrap">
              {filtered.length} productos
              {selectionMode && selectedIds.size > 0 && (
                <span className="text-primary font-medium"> ({selectedIds.size} sel.)</span>
              )}
            </span>

            {!readOnly && !selectionMode && (
              <button
                type="button"
                onClick={() => setSelectionMode(true)}
                className="inline-flex items-center gap-1 rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium text-subtle hover:text-body hover:bg-surface-alt transition-colors touch-manipulation"
              >
                <CheckSquare size={13} />
                Seleccionar
              </button>
            )}

            {!readOnly && selectionMode && (
              <>
                <button
                  type="button"
                  onClick={selectedIds.size === filtered.length ? handleDeselectAll : handleSelectAll}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors touch-manipulation"
                >
                  <CheckSquare size={12} />
                  {selectedIds.size === filtered.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </button>
                <button
                  type="button"
                  onClick={handleCloseSelection}
                  className="inline-flex items-center gap-1 rounded-md border border-edge px-2.5 py-1.5 text-xs font-medium text-subtle hover:text-body hover:bg-surface-alt transition-colors touch-manipulation"
                >
                  <X size={12} />
                  Cancelar selección
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 border border-edge rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => { setViewMode('list'); document.cookie = 'inventory-view-mode=list; path=/; max-age=31536000; SameSite=Lax'; localStorage.setItem('inventory-view-mode', 'list') }}
              className={`p-2 rounded-md transition-colors touch-manipulation ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-subtle hover:text-body hover:bg-surface-alt'}`}
              title="Vista lista"
              aria-label="Vista lista"
            >
              <LayoutList size={15} />
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('grid'); document.cookie = 'inventory-view-mode=grid; path=/; max-age=31536000; SameSite=Lax'; localStorage.setItem('inventory-view-mode', 'grid') }}
              className={`p-2 rounded-md transition-colors touch-manipulation ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-subtle hover:text-body hover:bg-surface-alt'}`}
              title="Vista cuadrícula"
              aria-label="Vista cuadrícula"
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 bg-surface border-b border-edge/60">
          {selectedCategories.map(id => {
            const cat = categories.find(c => c.id === id)
            if (!cat) return null
            return (
              <span key={id} className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary rounded-full px-2.5 py-1 font-medium">
                {cat.icon} {cat.name}
                <button
                  type="button"
                  onClick={() => setSelectedCategories(prev => prev.filter(c => c !== id))}
                  aria-label={`Quitar categoría ${cat.name}`}
                  className="hover:opacity-70 transition-opacity p-0.5 -m-0.5 touch-manipulation"
                >
                  <X size={11} />
                </button>
              </span>
            )
          })}
          {selectedBrands.map(id => {
            const brand = brands.find(b => b.id === id)
            if (!brand) return null
            return (
              <span key={id} className="flex items-center gap-1.5 text-xs bg-surface-alt text-body border border-edge rounded-full px-2.5 py-1 font-medium">
                {brand.name}
                <button
                  type="button"
                  onClick={() => setSelectedBrands(prev => prev.filter(b => b !== id))}
                  aria-label={`Quitar marca ${brand.name}`}
                  className="hover:opacity-70 transition-opacity p-0.5 -m-0.5 touch-manipulation"
                >
                  <X size={11} />
                </button>
              </span>
            )
          })}
          <button
            type="button"
            onClick={() => { setSelectedCategories([]); setSelectedBrands([]) }}
            className="text-xs text-subtle hover:text-body transition-colors"
          >
            Limpiar todo
          </button>
        </div>
      )}

      {crudError && (
        <div className="mx-5 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {crudError}
        </div>
      )}

      {readOnly && (
        <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          Solo podés ver el inventario, sin permiso para editarlo.
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="surface-card p-12 text-center text-hint">
            Sin resultados. Probá ajustando los filtros.
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
            {visibleProducts.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                readOnly={readOnly}
                loadingId={loadingId}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(product.id)}
                onToggleSelect={handleToggleSelect}
                onEdit={handleEdit}
                onToggleActive={handleToggleActive}
                onDelete={handleDeleteProduct}
                onQuickCategory={handleQuickCategory}
                onQuickBrand={handleQuickBrand}
              />
            ))}
          </div>
        ) : (
          <div className="surface-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Estado</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="hidden xl:table-cell">Categoría</TableHead>
                  <TableHead className="hidden xl:table-cell">Marca</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Venta</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Costo</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Margen</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  {!readOnly && <TableHead className="text-right">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleProducts.map(product => (
                  <ProductListRow
                    key={product.id}
                    product={product}
                    readOnly={readOnly}
                    loadingId={loadingId}
                    selectionMode={selectionMode}
                    isSelected={selectedIds.has(product.id)}
                    onToggleSelect={handleToggleSelect}
                    onEdit={handleEdit}
                    onToggleActive={handleToggleActive}
                    onDelete={handleDeleteProduct}
                    onQuickCategory={handleQuickCategory}
                    onQuickBrand={handleQuickBrand}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {visibleCount < filtered.length && (
          <div className="py-4 text-center text-xs text-subtle">
            Mostrando {visibleCount} de {filtered.length}. Seguí scrolleando para ver más.
          </div>
        )}
      </div>

      {!readOnly && (
        <NewProductModal
          open={showNewProduct}
          onClose={() => setShowNewProduct(false)}
          businessId={businessId}
          priceLists={priceLists}
          categories={categories}
          brands={brands}
          onCreated={product => setProducts(prev => [product, ...prev])}
        />
      )}

      {showCategories && businessId && (
        <CategoryModal
          open={showCategories}
          onClose={() => setShowCategories(false)}
          businessId={businessId}
          operatorId={operatorId}
          stockWriteAllowed={!readOnly}
          initialCategories={categories}
          onCategoriesChanged={updated => setCategories(updated)}
        />
      )}

      {editingProduct && (
        <EditProductModal
          open={Boolean(editingProduct)}
          onClose={() => setEditingProduct(null)}
          product={editingProduct}
          businessId={businessId}
          categories={categories}
          brands={brands}
          priceLists={priceLists}
          existingOverrides={productOverrides.filter(o => o.product_id === editingProduct.id)}
          onSaved={(values, nextOverrides) => {
            void updateProduct(editingProduct.id, values)
            setProductOverrides(prev => [
              ...prev.filter(o => o.product_id !== editingProduct.id),
              ...nextOverrides,
            ])
            setEditingProduct(null)
          }}
        />
      )}

      {showBrands && businessId && (
        <BrandModal
          open={showBrands}
          onClose={() => setShowBrands(false)}
          businessId={businessId}
          operatorId={operatorId}
          stockWriteAllowed={!readOnly}
          initialBrands={brands}
          onBrandsChanged={handleBrandsChanged}
        />
      )}

      {showImport && businessId && (
        <ImportProductsModal
          businessId={businessId}
          categories={categories}
          brands={brands}
          operatorId={operatorId}
          stockWriteAllowed={!readOnly}
          onClose={() => setShowImport(false)}
          onImported={async () => {
            setShowImport(false)
            const [
              { data: updatedProducts, error: productsError },
              { data: updatedCategories, error: categoriesError },
              { data: updatedBrands, error: brandsError },
            ] = await Promise.all([
              fetchInventoryProducts(supabase, businessId),
              supabase
                .from('categories')
                .select('id, name, icon')
                .eq('business_id', businessId)
                .eq('is_active', true)
                .order('position'),
              supabase
                .from('brands')
                .select('id, name')
                .eq('business_id', businessId)
                .order('name'),
            ])
            const refreshError = productsError ?? categoriesError ?? brandsError
            if (refreshError) {
              setCrudError(refreshError.message)
              return
            }
            if (updatedProducts) {
              setProducts(updatedProducts)
              setVisibleCount(PAGE_SIZE)
            }
            if (updatedCategories) setCategories(updatedCategories)
            if (updatedBrands) setBrands(updatedBrands)
          }}
        />
      )}

      <div className="bg-surface border-t border-edge/60 px-5 py-2.5 flex items-center gap-6 text-caption text-subtle shrink-0 overflow-x-auto">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {activeProducts.length} productos activos
        </span>
        <span>{totalStock} uds en stock</span>
        <span>Valor inventario {formatMoney(inventoryValue)}</span>
        <span>Margen promedio {avgMargin.toFixed(0)}%</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          {outOfStock} sin stock
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          {lowStock} stock bajo
        </span>
        <span className="ml-auto">{categoryCount} categorías</span>
      </div>

      {quickEditCategoryProduct !== null && businessId && (
        <QuickEditCategoryModal
          open
          product={quickEditCategoryProduct}
          categories={categories}
          businessId={businessId}
          operatorId={operatorId}
          onSaved={handleQuickCategorySaved}
          onClose={() => setQuickEditCategoryProduct(null)}
        />
      )}

      {quickEditBrandProduct !== null && businessId && (
        <QuickEditBrandModal
          open
          product={quickEditBrandProduct}
          brands={brands}
          businessId={businessId}
          operatorId={operatorId}
          onSaved={handleQuickBrandSaved}
          onClose={() => setQuickEditBrandProduct(null)}
        />
      )}

      <ConfirmModal
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null) }}
        onCancel={() => setPendingConfirm(null)}
      />

      <FilterSidebar
        open={showFilterSidebar}
        onClose={() => setShowFilterSidebar(false)}
        categories={categories}
        brands={brands}
        selectedCategories={selectedCategories}
        selectedBrands={selectedBrands}
        onCategoriesChange={setSelectedCategories}
        onBrandsChange={setSelectedBrands}
        sort={sort}
        onSortChange={setSort}
        showInCatalogOnly={showInCatalogOnly}
        onShowInCatalogChange={setShowInCatalogOnly}
      />

      {toast && <Toast message={toast.message} duration={toast.duration} onUndo={toast.onUndo} onDismiss={dismissToast} />}

      {!readOnly && selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          categories={categories}
          brands={brands}
          loading={bulkLoading}
          onDelete={handleBulkDelete}
          onActivate={handleBulkActivate}
          onDeactivate={handleBulkDeactivate}
          onChangeCategory={handleBulkChangeCategory}
          onChangeBrand={handleBulkChangeBrand}
        />
      )}
    </div>
  )
}
