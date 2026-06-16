'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, LayoutList, X, Plus, SlidersHorizontal as FilterIcon, Search, Tag, ArrowDownToLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PageHeader from '@/components/shared/PageHeader'
import { createPortal } from 'react-dom'
import ProductFilter, {
  EMPTY_FILTER,
  countActiveFilters,
  type ProductFilterValue,
} from '@/components/shared/ProductFilter'
import NewProductModal from '@/components/inventory/NewProductModal'
import EditProductModal from '@/components/inventory/EditProductModal'
import CategoryModal from '@/components/inventory/CategoryModal'
import BrandModal from '@/components/inventory/BrandModal'
import ImportProductsModal from '@/components/inventory/ImportProductsModal'
import HeaderActionDropdown from '@/components/inventory/HeaderActionDropdown'
import ConfirmModal from '@/components/shared/ConfirmModal'
import BulkActionBar from '@/components/inventory/BulkActionBar'
import QuickEditCategoryModal from '@/components/inventory/QuickEditCategoryModal'
import QuickEditBrandModal from '@/components/inventory/QuickEditBrandModal'
import ProductCard, { SelectionCheckbox } from '@/components/inventory/ProductCard'
import InsightSurfaceAnchor from '@/components/insights/InsightSurfaceAnchor'
import ProductListRow from '@/components/inventory/ProductListRow'
import ProductStockModal from '@/components/inventory/ProductStockModal'
import type { PriceList, PriceListOverride } from '@/lib/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct } from '@/components/inventory/types'
import { getStatus } from '@/components/inventory/types'
import { useToast } from '@/hooks/useToast'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { trackFeatureUsed } from '@/lib/analytics'
import { fetchInventoryProducts } from '@/lib/inventory-products'
import { translateDbError, ERR } from '@/lib/errors'
import CategoryIconPreview from '@/components/inventory/CategoryIconPreview'

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
  const [filterValue, setFilterValue] = useState<ProductFilterValue>(EMPTY_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)

  // Derived from filterValue for backward compat with existing logic
  const query = filterValue.search
  const selectedCategories = filterValue.categoryIds
  const selectedBrands = filterValue.brandIds
  const showInCatalogOnly = filterValue.showInCatalogOnly
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [showBrands, setShowBrands] = useState(false)
  const [editingProduct, setEditingProduct] = useState<InventoryProduct | null>(null)
  const [quickEditCategoryProduct, setQuickEditCategoryProduct] = useState<InventoryProduct | null>(null)
  const [quickEditBrandProduct, setQuickEditBrandProduct] = useState<InventoryProduct | null>(null)
  const [selectedStockProductId, setSelectedStockProductId] = useState<string | null>(null)
  const [crudError, setCrudError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(initialViewMode)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const { showToast } = useToast()
  const formatMoney = useFormatMoney()

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const deleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const router = useRouter()

  const supabase = useMemo(() => createClient(), [])

  // Deep-link from the dashboard stock alerts: /inventory?product={id} opens that
  // product's edit modal on arrival (the only product detail/action surface today),
  // then strips the param so back/refresh doesn't reopen it. Read-only operators
  // just land on the list — no modal, no error toast.
  const deepLinkHandledRef = useRef(false)
  useEffect(() => {
    if (deepLinkHandledRef.current) return
    deepLinkHandledRef.current = true
    const targetId = new URLSearchParams(window.location.search).get('product')
    if (!targetId) return
    if (!readOnly) {
      const target = products.find(p => p.id === targetId)
      if (target) setEditingProduct(target)
    }
    window.history.replaceState(null, '', '/inventory')
  }, [products, readOnly])

  // Single source of truth for the status filter: filterValue.stockStatus.
  // Pills (desktop) and the sidebar "Estado" section both read/write this one
  // field, so they can never desync. effectiveStatusFilter is the pill-key view
  // of stockStatus used by the filter logic and the active-pill highlight.
  const effectiveStatusFilter: FilterStatus =
    filterValue.stockStatus === 'low-stock' ? 'low'
    : filterValue.stockStatus === 'out-of-stock' ? 'out'
    : filterValue.stockStatus === 'discontinued' ? 'discontinued'
    : 'all'

  const { setRef, indicator } = usePillIndicator(effectiveStatusFilter)
  const { setRef: setViewRef, indicator: viewIndicator } = usePillIndicator(viewMode)

  const activeFilterCount = countActiveFilters(filterValue)

  const reloadInventoryProducts = useCallback(async () => {
    if (!businessId) {
      setCrudError('No se encontró el negocio activo para recargar productos.')
      return
    }

    const { data, error } = await fetchInventoryProducts(supabase, businessId)
    if (error || !data) {
      setCrudError(translateDbError(error?.message ?? '', 'No se pudieron recargar los productos.'))
      return
    }

    setProducts(data)
  }, [businessId, supabase])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const catalogOnly = filterValue.stockStatus === 'catalog-only' || filterValue.showInCatalogOnly
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
      const matchesStatus = effectiveStatusFilter === 'all' || status === effectiveStatusFilter
      const matchesCatalog = !catalogOnly || product.show_in_catalog === true
      return matchesQuery && matchesCategory && matchesBrand && matchesStatus && matchesCatalog
    })
  }, [products, query, selectedCategories, selectedBrands, effectiveStatusFilter, filterValue.stockStatus, filterValue.showInCatalogOnly])

  const sortField = filterValue.sortField
  const sortDir = filterValue.sortDir

  const sorted = useMemo(() => {
    if (sortField === 'name' && sortDir === 'asc') return filtered
    const arr = [...filtered]
    if (sortField === 'name') {
      arr.sort((a, b) => b.name.localeCompare(a.name))
      return arr
    }
    arr.sort((a, b) => {
      let va = 0
      let vb = 0
      if (sortField === 'price') { va = a.price; vb = b.price }
      else if (sortField === 'cost') { va = a.cost; vb = b.cost }
      else if (sortField === 'stock') { va = a.stock; vb = b.stock }
      else if (sortField === 'margin') {
        va = a.cost > 0 && a.price > 0 ? ((a.price - a.cost) / a.price) * 100 : 0
        vb = b.cost > 0 && b.price > 0 ? ((b.price - b.cost) / b.price) * 100 : 0
      }
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return arr
  }, [filtered, sortField, sortDir])

  const visibleProducts = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount])

  // Reset pagination when the filtered/sorted set changes.
  // Depend on sortField/sortDir (primitivos) y NO en el objeto `sort` (L72), que se
  // recrea en cada render → haría correr este efecto en cada render y resetearía
  // visibleCount a PAGE_SIZE, rompiendo el scroll infinito con >PAGE_SIZE productos.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, selectedCategories, selectedBrands, showInCatalogOnly, sortField, sortDir, filterValue.stockStatus])

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

  const { activeProducts, totalStock, inventoryValue, avgMargin, outOfStock, lowStock, categoryCount } = useMemo(() => {
    const activeProducts = products.filter(p => p.is_active)
    const totalStock = activeProducts.reduce((acc, p) => acc + p.stock, 0)
    const inventoryValue = activeProducts.reduce((acc, p) => acc + p.cost * p.stock, 0)
    const withCost = activeProducts.filter(p => p.cost > 0 && p.price > 0)
    const avgMargin = withCost.length === 0
      ? 0
      : withCost.reduce((acc, p) => acc + ((p.price - p.cost) / p.price) * 100, 0) / withCost.length
    const outOfStock = activeProducts.filter(p => p.stock <= 0).length
    const lowStock = activeProducts.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
    const categoryCount = new Set(products.map(p => p.category_id).filter(Boolean)).size
    return { activeProducts, totalStock, inventoryValue, avgMargin, outOfStock, lowStock, categoryCount }
  }, [products])

  const updateProduct = useCallback(async (productId: string, values: Partial<InventoryProduct>) => {
    if (readOnly) {
      setCrudError('No tienes permiso para editar el inventario.')
      return
    }

    if (!businessId) {
      setCrudError('No se encontró el negocio activo para actualizar productos.')
      return
    }

    setCrudError(null)
    setLoadingId(productId)

    const { data: rpcResult, error: rpcError } = await supabase.rpc('update_product', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_product_id: productId,
      p_changes: values as Record<string, unknown>,
    })

    const result = rpcResult as { success: boolean; error?: string } | null
    const error = rpcError || (!result?.success ? { message: result?.error ?? 'Error al actualizar el producto' } : null)

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
      setCrudError(translateDbError(error.message, ERR.INV1))
    }

    setLoadingId(null)
  }, [brands, businessId, operatorId, readOnly, supabase])

  function handleCategoriesChanged(updatedCategories: InventoryCategory[]) {
    setCategories(updatedCategories)
    setProducts(prev => prev.map(product => {
      if (!product.category_id) {
        return { ...product, categories: null }
      }

      const nextCategory = updatedCategories.find(category => category.id === product.category_id)
      if (!nextCategory) {
        return { ...product, category_id: null, categories: null }
      }

      return {
        ...product,
        categories: { name: nextCategory.name, icon: nextCategory.icon },
      }
    }))
  }

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
      setCrudError('No tienes permiso para editar el inventario.')
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
          const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_product', {
            p_operator_id: operatorId,
            p_business_id: bid,
            p_product_id: product.id,
          })
          const result = rpcResult as { success: boolean; soft_deleted?: boolean; error?: string } | null
          if (rpcError || !result?.success) {
            // DB delete failed — restore the product and surface the error
            setProducts(prev => [product, ...prev])
            setCrudError(result?.error ?? translateDbError(rpcError?.message ?? '', ERR.INV1))
          } else if (result.soft_deleted) {
            // Product was soft-deleted (had completed sales) — bring it back to the list
            // as inactive so the user can still see it.
            setProducts(prev => [{ ...product, is_active: false }, ...prev])
          }
        }, TOAST_DURATION + 500)

        deleteTimersRef.current.set(product.id, timer)
      },
    })
  }, [businessId, operatorId, readOnly, showToast, supabase])

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
      setCrudError('No tienes permiso para editar el inventario.')
      return
    }
    setEditingProduct(product)
  }, [readOnly])

  const handleToggleActive = useCallback((product: InventoryProduct) => {
    void updateProduct(product.id, { is_active: !product.is_active })
  }, [updateProduct])

  const handleToggleCatalog = useCallback((product: InventoryProduct) => {
    void updateProduct(product.id, { show_in_catalog: !(product.show_in_catalog ?? true) })
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

  const handleViewStock = useCallback((productId: string) => {
    setSelectedStockProductId(productId)
  }, [])

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

  const allFilteredSelected = filtered.length > 0 && selectedIds.size === filtered.length
  const someFilteredSelected = selectedIds.size > 0 && !allFilteredSelected
  const handleMasterToggle = useCallback(() => {
    if (filtered.length === 0) return
    if (selectedIds.size === filtered.length) {
      handleDeselectAll()
    } else {
      handleSelectAll()
    }
  }, [filtered.length, selectedIds.size, handleDeselectAll, handleSelectAll])

  // Runs a bulk RPC and surfaces failures uniformly. The SECURITY DEFINER bulk RPCs return
  // { success:false, error } on permission/context failures (NOT via the transport error), so
  // checking only `error` would swallow them. Returns the parsed result on success, or null
  // (after toasting the error) on any failure.
  const runBulkAction = useCallback(async <T,>(
    action: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<(T & { success: boolean }) | null> => {
    setBulkLoading(true)
    const { data, error } = await action()
    setBulkLoading(false)
    const result = data as ({ success?: boolean; error?: string } & T) | null
    if (error || !result?.success) {
      showToast({ message: result?.error ?? translateDbError(error?.message ?? '', ERR.INV1) })
      return null
    }
    return result as T & { success: boolean }
  }, [showToast])

  const handleBulkDelete = useCallback(async () => {
    if (!businessId) return
    trackFeatureUsed('bulk_action')
    const ids = Array.from(selectedIds)
    const result = await runBulkAction<{ deleted: number; discontinued: number }>(() =>
      supabase.rpc('bulk_delete_products', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_product_ids: ids,
      }))
    if (!result) return
    const deleted = result.deleted ?? 0
    const discontinued = result.discontinued ?? 0

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
  }, [businessId, operatorId, selectedIds, supabase, showToast, handleCloseSelection, router, runBulkAction])

  const handleBulkActivate = useCallback(async () => {
    if (!businessId) return
    const ids = Array.from(selectedIds)
    const result = await runBulkAction<{ updated: number }>(() =>
      supabase.rpc('bulk_set_product_status', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_product_ids: ids,
        p_is_active: true,
      }))
    if (!result) return
    showToast({ message: `${result.updated ?? 0} productos activados` })
    // Update local state directly — do not rely on router.refresh()
    setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, is_active: true } : p))
    handleCloseSelection()
    router.refresh()
  }, [businessId, operatorId, selectedIds, supabase, showToast, handleCloseSelection, router, runBulkAction])

  const handleBulkDeactivate = useCallback(async () => {
    if (!businessId) return
    const ids = Array.from(selectedIds)
    const result = await runBulkAction<{ updated: number }>(() =>
      supabase.rpc('bulk_set_product_status', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_product_ids: ids,
        p_is_active: false,
      }))
    if (!result) return
    showToast({ message: `${result.updated ?? 0} productos discontinuados` })
    // Update local state directly — do not rely on router.refresh()
    setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, is_active: false } : p))
    handleCloseSelection()
    router.refresh()
  }, [businessId, operatorId, selectedIds, supabase, showToast, handleCloseSelection, router, runBulkAction])

  const handleBulkSetCatalog = useCallback(async (show: boolean) => {
    if (!businessId) return
    const ids = Array.from(selectedIds)
    const result = await runBulkAction<{ updated: number }>(() =>
      supabase.rpc('bulk_set_product_catalog', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_product_ids: ids,
        p_show_in_catalog: show,
      }))
    if (!result) return
    showToast({ message: `${result.updated ?? 0} productos ${show ? 'agregados al' : 'quitados del'} catálogo` })
    setProducts(prev => prev.map(p => ids.includes(p.id) ? { ...p, show_in_catalog: show } : p))
    handleCloseSelection()
    router.refresh()
  }, [businessId, operatorId, selectedIds, supabase, showToast, handleCloseSelection, router, runBulkAction])

  const handleBulkChangeCategory = useCallback(async (categoryId: string | null) => {
    if (!businessId) return
    const ids = Array.from(selectedIds)
    const result = await runBulkAction<{ updated: number }>(() =>
      supabase.rpc('bulk_update_product_category', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_product_ids: ids,
        p_category_id: categoryId,
      }))
    if (!result) return
    const catName = categoryId ? categories.find(c => c.id === categoryId)?.name ?? '' : 'ninguna'
    showToast({ message: `${result.updated ?? 0} productos → categoría: ${catName}` })
    // Update local state directly
    const nextCat = categoryId ? categories.find(c => c.id === categoryId) ?? null : null
    setProducts(prev => prev.map(p =>
      ids.includes(p.id)
        ? { ...p, category_id: categoryId, categories: nextCat ? { name: nextCat.name, icon: nextCat.icon } : null }
        : p
    ))
    handleCloseSelection()
    router.refresh()
  }, [businessId, operatorId, selectedIds, supabase, showToast, handleCloseSelection, router, categories, runBulkAction])

  const handleBulkChangeBrand = useCallback(async (brandId: string | null) => {
    if (!businessId) return
    const ids = Array.from(selectedIds)
    const result = await runBulkAction<{ updated: number }>(() =>
      supabase.rpc('bulk_update_product_brand', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_product_ids: ids,
        p_brand_id: brandId,
      }))
    if (!result) return
    const brandName = brandId ? brands.find(b => b.id === brandId)?.name ?? '' : 'ninguna'
    showToast({ message: `${result.updated ?? 0} productos → marca: ${brandName}` })
    // Update local state directly
    const nextBrand = brandId ? brands.find(b => b.id === brandId) ?? null : null
    setProducts(prev => prev.map(p =>
      ids.includes(p.id)
        ? { ...p, brand_id: brandId, brand: nextBrand ? { id: nextBrand.id, name: nextBrand.name } : null }
        : p
    ))
    handleCloseSelection()
    router.refresh()
  }, [businessId, operatorId, selectedIds, supabase, showToast, handleCloseSelection, router, brands, runBulkAction])

  if (!businessId) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="Inventario" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="surface-card p-6">
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              No se encontró tu negocio. Intenta recargar la página.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <PageHeader title="Inventario">
        {/* Mobile search icon */}
        <button
          onClick={() => setMobileSearchOpen(true)}
          className="inv:hidden p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-95"
          aria-label="Buscar"
        >
          <Search size={18} className="text-body" />
        </button>

        {/* Import/Export — desktop: botones; mobile: icono + menú en portal */}
        <HeaderActionDropdown
          ariaLabel="Importar / Exportar"
          icon={<ArrowDownToLine size={17} className="text-body" />}
          items={[
            {
              label: 'Importar',
              onClick: () => { setShowImport(true); trackFeatureUsed('import_products') },
              disabled: readOnly || !businessId,
              title: readOnly ? 'Sin permiso de inventario' : undefined,
            },
            { label: 'Exportar', onClick: exportCsv, disabled: filtered.length === 0 },
          ]}
        />

        {/* Categorías/Marcas — desktop: botones; mobile: icono + menú en portal */}
        <HeaderActionDropdown
          ariaLabel="Categorías / Marcas"
          icon={<Tag size={17} className="text-body" />}
          triggerDisabled={readOnly}
          items={[
            {
              label: 'Categorías',
              onClick: () => setShowCategories(true),
              disabled: readOnly,
              title: readOnly ? 'Sin permiso de inventario' : undefined,
            },
            {
              label: 'Marcas',
              onClick: () => setShowBrands(true),
              disabled: readOnly,
              title: readOnly ? 'Sin permiso de inventario' : undefined,
            },
          ]}
        />

        {!readOnly && (
          <Button
            size="sm"
            className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => setShowNewProduct(true)}
          >
            <Plus size={15} />
            <span className="hidden inv:inline">Nuevo producto</span>
          </Button>
        )}
      </PageHeader>

      {/* Mobile search overlay */}
      <div
        className={[
          'absolute inset-x-0 top-0 h-14 bg-surface border-b border-edge/60',
          'flex items-center gap-2 px-3 z-30',
          'transition-all duration-200 ease-out',
          mobileSearchOpen
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-2 pointer-events-none',
          'inv:hidden',
        ].join(' ')}
      >
        <div className="relative flex-1">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Search size={16} className="text-hint" />
          </div>
          <Input
            value={query}
            onChange={e => setFilterValue(prev => ({ ...prev, search: e.target.value }))}
            placeholder="Buscar producto, marca o código..."
            className="w-full pl-9 pr-4 h-9 text-sm rounded-lg border border-edge bg-surface"
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

      <div className="bg-surface border-b border-edge/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <Input
            value={query}
            onChange={e => setFilterValue(prev => ({ ...prev, search: e.target.value }))}
            placeholder="Buscar producto, marca o código..."
            className="hidden inv:flex h-9 max-w-xs rounded-lg text-sm"
          />
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className={`h-9 px-4 rounded-lg border text-sm font-medium flex items-center gap-2 transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] shrink-0 ${
              activeFilterCount > 0
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-edge bg-surface text-body hover:bg-surface-alt'
            }`}
          >
            <FilterIcon size={14} />
            Filtros
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          <div className="hidden inv:block shrink-0">
          <div className="pill-tabs">
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
              { key: 'all', label: 'Todos', stockStatus: 'all' },
              { key: 'low', label: 'Stock bajo', stockStatus: 'low-stock' },
              { key: 'out', label: 'Sin stock', stockStatus: 'out-of-stock' },
              { key: 'discontinued', label: 'Discontinuados', stockStatus: 'discontinued' },
            ] as const).map(s => (
              <button
                key={s.key}
                ref={setRef(s.key)}
                onClick={() => setFilterValue(prev => ({ ...prev, stockStatus: s.stockStatus }))}
                className={`pill-tab${effectiveStatusFilter === s.key ? ' pill-tab-active' : ''}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          </div>


          <div className="ml-auto flex items-center gap-2">
          <InsightSurfaceAnchor
            surfaces={['inventory_row', 'inventory']}
            size="sm"
            openLabel="Ver producto"
            onOpenEntity={(insight) => {
              const target = products.find(p => p.id === insight.target_entity_id)
              if (target) handleEdit(target)
            }}
          />
          <div className="relative flex items-center gap-1 shrink-0 border border-edge rounded-lg p-1">
            {viewIndicator && (
              <span
                className="absolute inset-y-1 bg-primary rounded-md pointer-events-none"
                style={{
                  transform: `translateX(${viewIndicator.left}px)`,
                  width: viewIndicator.width,
                  transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), width 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  willChange: 'transform, width',
                }}
              />
            )}
            <button
              ref={setViewRef('list')}
              type="button"
              onClick={() => { setViewMode('list'); document.cookie = 'inventory-view-mode=list; path=/; max-age=31536000; SameSite=Lax'; localStorage.setItem('inventory-view-mode', 'list') }}
              className={`relative p-2 rounded-md transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-95 touch-manipulation ${viewMode === 'list' ? 'text-primary-foreground' : 'text-subtle hover:text-body'}`}
              title="Vista lista"
              aria-label="Vista lista"
            >
              <LayoutList size={15} />
            </button>
            <button
              ref={setViewRef('grid')}
              type="button"
              onClick={() => { setViewMode('grid'); document.cookie = 'inventory-view-mode=grid; path=/; max-age=31536000; SameSite=Lax'; localStorage.setItem('inventory-view-mode', 'grid') }}
              className={`relative p-2 rounded-md transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-95 touch-manipulation ${viewMode === 'grid' ? 'text-primary-foreground' : 'text-subtle hover:text-body'}`}
              title="Vista cuadrícula"
              aria-label="Vista cuadrícula"
            >
              <LayoutGrid size={15} />
            </button>
          </div>
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
                <CategoryIconPreview icon={cat.icon} color={cat.icon_color ?? 'var(--primary)'} size={12} />
                {cat.name}
                <button
                  type="button"
                  onClick={() => setFilterValue(prev => ({ ...prev, categoryIds: prev.categoryIds.filter(c => c !== id) }))}
                  aria-label={`Quitar categoría ${cat.name}`}
                  className="hover:opacity-70 transition-[transform,opacity] duration-150 ease-[var(--ease-out)] active:scale-95 p-0.5 -m-0.5 touch-manipulation"
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
                  onClick={() => setFilterValue(prev => ({ ...prev, brandIds: prev.brandIds.filter(b => b !== id) }))}
                  aria-label={`Quitar marca ${brand.name}`}
                  className="hover:opacity-70 transition-[transform,opacity] duration-150 ease-[var(--ease-out)] active:scale-95 p-0.5 -m-0.5 touch-manipulation"
                >
                  <X size={11} />
                </button>
              </span>
            )
          })}
          <button
            type="button"
            onClick={() => setFilterValue(prev => ({ ...prev, categoryIds: [], brandIds: [] }))}
            className="text-xs text-subtle hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
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
        <div className="mx-5 mt-4 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
          Solo puedes ver el inventario, sin permiso para editarlo.
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="surface-card p-12 text-center text-hint">
            Sin resultados. Prueba ajustando los filtros.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3 pl-1 min-h-7">
              {viewMode === 'grid' && !readOnly && (
                <>
                  <SelectionCheckbox
                    checked={allFilteredSelected}
                    indeterminate={someFilteredSelected}
                    onClick={(e) => { e.stopPropagation(); handleMasterToggle() }}
                  />
                  <button
                    type="button"
                    onClick={handleMasterToggle}
                    className="text-xs font-medium text-subtle hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] touch-manipulation"
                  >
                    {allFilteredSelected ? 'Deseleccionar todos' : 'Seleccionar todos'}
                  </button>
                </>
              )}
              <span className="text-xs text-subtle whitespace-nowrap">
                {filtered.length} productos
                {selectedIds.size > 0 && (
                  <span className="text-primary font-medium"> ({selectedIds.size} sel.)</span>
                )}
              </span>
              {!readOnly && selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleCloseSelection}
                  className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs font-medium text-subtle hover:text-body hover:bg-surface-alt transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] touch-manipulation"
                >
                  <X size={12} />
                  Cancelar selección
                </button>
              )}
            </div>
            {viewMode === 'grid' ? (
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
                onToggleCatalog={handleToggleCatalog}
                onDelete={handleDeleteProduct}
                onQuickCategory={handleQuickCategory}
                onQuickBrand={handleQuickBrand}
                onViewStock={handleViewStock}
              />
            ))}
          </div>
        ) : (
          <div className="surface-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    {!readOnly && (
                      <SelectionCheckbox
                        checked={allFilteredSelected}
                        indeterminate={someFilteredSelected}
                        onClick={(e) => { e.stopPropagation(); handleMasterToggle() }}
                      />
                    )}
                  </TableHead>
                  <TableHead className="text-center">En catálogo</TableHead>
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
                    onToggleCatalog={handleToggleCatalog}
                    onDelete={handleDeleteProduct}
                    onQuickCategory={handleQuickCategory}
                    onQuickBrand={handleQuickBrand}
                    onViewStock={handleViewStock}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
          </>
        )}
        {visibleCount < filtered.length && (
          <div className="py-4 text-center text-xs text-subtle">
            Mostrando {visibleCount} de {filtered.length}. Sigue desplazándote para ver más.
          </div>
        )}
      </div>

      {!readOnly && (
        <NewProductModal
          open={showNewProduct}
          onClose={() => setShowNewProduct(false)}
          businessId={businessId}
          operatorId={operatorId}
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
          onCategoriesChanged={handleCategoriesChanged}
        />
      )}

      {editingProduct && (
        <EditProductModal
          open={Boolean(editingProduct)}
          onClose={() => setEditingProduct(null)}
          product={editingProduct}
          businessId={businessId}
          operatorId={operatorId}
          categories={categories}
          brands={brands}
          priceLists={priceLists}
          existingOverrides={productOverrides.filter(o => o.product_id === editingProduct.id)}
          onSaved={(values, nextOverrides) => {
            void (async () => {
              // values puede venir vacío desde handleSubmitWithVariants si el usuario
              // sólo editó variantes — en ese caso saltamos update_product para no
              // duplicar audit events.
              if (Object.keys(values).length > 0) {
                await updateProduct(editingProduct.id, values)
              }

              if (values.has_variants || editingProduct.has_variants) {
                await reloadInventoryProducts()
              }

              setProductOverrides(prev => [
                ...prev.filter(o => o.product_id !== editingProduct.id),
                ...nextOverrides,
              ])
              setEditingProduct(null)
            })()
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
                .select('id, name, icon, icon_color')
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
              setCrudError(translateDbError(refreshError.message, ERR.INV1))
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

      <div className="bg-surface border-t border-edge/60 px-4 py-2 flex items-center gap-4 text-caption text-subtle shrink-0 overflow-x-auto whitespace-nowrap">
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="hidden inv:inline">{activeProducts.length} productos activos</span>
          <span className="inv:hidden">{activeProducts.length} activos</span>
        </span>
        <span className="shrink-0">
          <span className="hidden inv:inline">{totalStock} uds en stock</span>
          <span className="inv:hidden">{totalStock} uds.</span>
        </span>
        <span className="shrink-0">
          <span className="hidden inv:inline">Valor inventario {formatMoney(inventoryValue)}</span>
          <span className="inv:hidden">{formatMoney(inventoryValue)}</span>
        </span>
        <span className="shrink-0">
          <span className="hidden inv:inline">Margen promedio {avgMargin.toFixed(0)}%</span>
          <span className="inv:hidden">~{avgMargin.toFixed(0)}%</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-destructive" />
          {outOfStock} sin stock
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-warning" />
          <span className="hidden inv:inline">{lowStock} stock bajo</span>
          <span className="inv:hidden">{lowStock} bajo</span>
        </span>
        <span className="ml-auto shrink-0 hidden inv:inline">{categoryCount} categorías</span>
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

      {selectedStockProductId && businessId && (
        <ProductStockModal
          productId={selectedStockProductId}
          businessId={businessId}
          onClose={() => setSelectedStockProductId(null)}
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

      {typeof document !== 'undefined' && createPortal(
        <>
          <div
            className={`fixed inset-0 z-40 transition-opacity duration-200 ${filterOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setFilterOpen(false)}
          />
          <div
            className={`fixed right-0 top-0 bottom-0 z-50 w-72 bg-card border-l border-edge flex flex-col transition-transform duration-200 ease-in-out ${filterOpen ? 'translate-x-0' : 'translate-x-full'}`}
            style={{ boxShadow: '-4px 0 32px rgba(0,0,0,0.10)' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
              <div className="flex items-center gap-2">
                <FilterIcon size={16} className="text-subtle" />
                <span className="font-semibold text-sm text-heading">Filtros</span>
                {activeFilterCount > 0 && (
                  <span className="text-xs font-bold bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="text-subtle hover:text-body transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 rounded-lg p-1 hover:bg-hover-bg"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <ProductFilter
                modules={['category', 'brand', 'price-range', 'stock-status', 'sort']}
                layout="sidebar"
                value={filterValue}
                onChange={setFilterValue}
                categories={categories.map(c => ({ id: c.id, name: c.name, icon: c.icon, icon_color: c.icon_color }))}
                brands={brands.map(b => ({ id: b.id, name: b.name }))}
                sortOptions={[
                  { field: 'name', label: 'Nombre' },
                  { field: 'price', label: 'Precio de venta' },
                  { field: 'cost', label: 'Costo' },
                  { field: 'stock', label: 'Stock' },
                  { field: 'margin', label: 'Margen' },
                ]}
                stockStatusOptions={[
                  { value: 'all', label: 'Todos' },
                  { value: 'low-stock', label: 'Stock bajo' },
                  { value: 'out-of-stock', label: 'Sin stock' },
                  { value: 'discontinued', label: 'Discontinuados' },
                  { value: 'catalog-only', label: 'Solo en catálogo' },
                ]}
              />
            </div>
          </div>
        </>,
        document.body
      )}


      {!readOnly && selectedIds.size > 0 && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          categories={categories}
          brands={brands}
          loading={bulkLoading}
          firstSelectedActive={(() => {
            const firstId = selectedIds.values().next().value
            return products.find(p => p.id === firstId)?.is_active ?? true
          })()}
          firstSelectedInCatalog={(() => {
            const firstId = selectedIds.values().next().value
            return products.find(p => p.id === firstId)?.show_in_catalog ?? true
          })()}
          onDelete={handleBulkDelete}
          onActivate={handleBulkActivate}
          onDeactivate={handleBulkDeactivate}
          onSetCatalog={handleBulkSetCatalog}
          onChangeCategory={handleBulkChangeCategory}
          onChangeBrand={handleBulkChangeBrand}
        />
      )}
    </div>
  )
}
