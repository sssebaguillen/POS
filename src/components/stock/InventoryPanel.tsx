'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, LayoutList, Pencil, SlidersHorizontal, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PageHeader from '@/components/shared/PageHeader'
import FilterSidebar from '@/components/stock/FilterSidebar'
import NewProductModal from '@/components/stock/NewProductModal'
import EditProductModal from '@/components/stock/EditProductModal'
import CategoryModal from '@/components/stock/CategoryModal'
import BrandModal from './BrandModal'
import ImportProductsModal from '@/components/stock/ImportProductsModal'
import ConfirmModal from '@/components/shared/ConfirmModal'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { PriceList, PriceListOverride } from '@/components/price-lists/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct, SortOption } from '@/components/stock/types'

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
  defaultPriceList: PriceList | null
  productOverrides: PriceListOverride[]
}

function getStatus(product: InventoryProduct): 'ok' | 'low' | 'out' | 'discontinued' {
  if (!product.is_active) return 'discontinued'
  if (product.stock <= 0) return 'out'
  if (product.stock <= product.min_stock) return 'low'
  return 'ok'
}

const statusConfig = {
  ok: {
    label: 'EN STOCK',
    border: 'border-emerald-300 dark:border-emerald-800/50',
    hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-800/50',
    badge: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50',
    bar: 'bg-emerald-500',
  },
  low: {
    label: 'STOCK BAJO',
    border: 'border-amber-300 dark:border-amber-800/50',
    hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-800/50',
    badge: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50',
    bar: 'bg-amber-500',
  },
  out: {
    label: 'SIN STOCK',
    border: 'border-red-300 dark:border-red-800/50 border-dashed',
    hoverBorder: 'hover:border-red-300 dark:hover:border-red-800/50',
    badge: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50',
    bar: 'bg-red-500',
  },
  discontinued: {
    label: 'DISCONTINUADO',
    border: 'border-faint border-dashed',
    hoverBorder: 'hover:border-muted-foreground/40',
    badge: 'bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
  },
}

interface QuickEditCategoryModalProps {
  open: boolean
  product: InventoryProduct | null
  categories: InventoryCategory[]
  businessId: string
  operatorId: string | null
  onSaved: (productId: string, categoryId: string | null, newCategory?: InventoryCategory) => void
  onClose: () => void
}

function QuickEditCategoryModal({ open, product, categories, businessId, operatorId, onSaved, onClose }: QuickEditCategoryModalProps) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('📦')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (open && product) {
      setSelectedId(product.category_id ?? '')
      setCreating(false)
      setNewName('')
      setNewIcon('📦')
      setError(null)
    }
  }, [open, product])

  async function handleSave() {
    if (!product) return
    setSaving(true)
    setError(null)

    if (creating) {
      if (!newName.trim()) { setError('El nombre es obligatorio'); setSaving(false); return }
      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_category_guarded', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_name: newName.trim(),
        p_icon: newIcon.trim() || '📦',
      })
      const result = rpcResult as { success: boolean; error?: string } | null
      if (rpcError || !result?.success) {
        setError(result?.error ?? rpcError?.message ?? 'Error al crear la categoría')
        setSaving(false)
        return
      }
      const { data: fetched, error: fetchError } = await supabase
        .from('categories')
        .select('id, name, icon')
        .eq('business_id', businessId)
        .eq('name', newName.trim())
        .limit(1)
        .single()
      if (fetchError || !fetched) { setError(fetchError?.message ?? 'Error al obtener la categoría creada'); setSaving(false); return }
      const { error: updateError } = await supabase
        .from('products')
        .update({ category_id: fetched.id })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(updateError.message); setSaving(false); return }
      onSaved(product.id, fetched.id, { id: fetched.id, name: fetched.name, icon: fetched.icon })
    } else {
      const categoryId = selectedId === '' ? null : selectedId
      const { error: updateError } = await supabase
        .from('products')
        .update({ category_id: categoryId })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(updateError.message); setSaving(false); return }
      onSaved(product.id, categoryId)
    }

    setSaving(false)
    onClose()
  }

  const categoryOptions = [
    { value: '', label: 'Sin categoría' },
    ...categories.map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })),
  ]

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl">
        <div className="px-5 pt-4 pb-3 border-b border-edge/60">
          <p className="font-semibold text-heading text-sm">Cambiar categoría</p>
          <p className="text-xs text-subtle truncate mt-0.5">{product?.name}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {!creating ? (
            <>
              <SelectDropdown
                value={selectedId}
                onChange={setSelectedId}
                options={categoryOptions}
                placeholder="Sin categoría"
                usePortal
              />
              <button type="button" onClick={() => setCreating(true)} className="text-xs text-primary hover:underline">
                + Crear nueva categoría
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  value={newIcon}
                  onChange={e => setNewIcon(e.target.value)}
                  placeholder="📦"
                  className="h-9 w-14 text-sm rounded-lg text-center shrink-0"
                />
                <Input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Nombre de la categoría"
                  className="h-9 text-sm rounded-lg flex-1"
                  autoFocus
                />
              </div>
              <button type="button" onClick={() => { setCreating(false); setNewName(''); setNewIcon('📦') }} className="text-xs text-subtle hover:text-body transition-colors">
                ← Volver a seleccionar
              </button>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="px-5 py-3 bg-muted/40 flex justify-end gap-2 border-t border-edge-soft">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button size="sm" className="rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave} disabled={saving || (creating && !newName.trim())}>
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface QuickEditBrandModalProps {
  open: boolean
  product: InventoryProduct | null
  brands: InventoryBrand[]
  businessId: string
  operatorId: string | null
  onSaved: (productId: string, brandId: string | null, newBrand?: InventoryBrand) => void
  onClose: () => void
}

function QuickEditBrandModal({ open, product, brands, businessId, operatorId, onSaved, onClose }: QuickEditBrandModalProps) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (open && product) {
      setSelectedId(product.brand_id ?? '')
      setCreating(false)
      setNewName('')
      setError(null)
    }
  }, [open, product])

  async function handleSave() {
    if (!product) return
    setSaving(true)
    setError(null)

    if (creating) {
      if (!newName.trim()) { setError('El nombre es obligatorio'); setSaving(false); return }
      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_brand_guarded', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_name: newName.trim(),
      })
      const result = rpcResult as { success: boolean; error?: string } | null
      if (rpcError || !result?.success) {
        setError(result?.error ?? rpcError?.message ?? 'Error al crear la marca')
        setSaving(false)
        return
      }
      const { data: fetched, error: fetchError } = await supabase
        .from('brands')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('name', newName.trim())
        .limit(1)
        .single()
      if (fetchError || !fetched) { setError(fetchError?.message ?? 'Error al obtener la marca creada'); setSaving(false); return }
      const { error: updateError } = await supabase
        .from('products')
        .update({ brand_id: fetched.id })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(updateError.message); setSaving(false); return }
      onSaved(product.id, fetched.id, { id: fetched.id, name: fetched.name })
    } else {
      const brandId = selectedId === '' ? null : selectedId
      const { error: updateError } = await supabase
        .from('products')
        .update({ brand_id: brandId })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(updateError.message); setSaving(false); return }
      onSaved(product.id, brandId)
    }

    setSaving(false)
    onClose()
  }

  const brandOptions = [
    { value: '', label: 'Sin marca' },
    ...brands.map(b => ({ value: b.id, label: b.name })),
  ]

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl">
        <div className="px-5 pt-4 pb-3 border-b border-edge/60">
          <p className="font-semibold text-heading text-sm">Cambiar marca</p>
          <p className="text-xs text-subtle truncate mt-0.5">{product?.name}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {!creating ? (
            <>
              <SelectDropdown
                value={selectedId}
                onChange={setSelectedId}
                options={brandOptions}
                placeholder="Sin marca"
                usePortal
              />
              <button type="button" onClick={() => setCreating(true)} className="text-xs text-primary hover:underline">
                + Crear nueva marca
              </button>
            </>
          ) : (
            <>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Nombre de la marca"
                className="h-9 text-sm rounded-lg"
                autoFocus
              />
              <button type="button" onClick={() => { setCreating(false); setNewName('') }} className="text-xs text-subtle hover:text-body transition-colors">
                ← Volver a seleccionar
              </button>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="px-5 py-3 bg-muted/40 flex justify-end gap-2 border-t border-edge-soft">
          <Button variant="outline" size="sm" className="rounded-lg" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button size="sm" className="rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave} disabled={saving || (creating && !newName.trim())}>
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ProductCardProps {
  product: InventoryProduct
  readOnly: boolean
  loadingId: string | null
  onEdit: (product: InventoryProduct) => void
  onToggleActive: (product: InventoryProduct) => void
  onDelete: (product: InventoryProduct) => void
  onQuickCategory: (product: InventoryProduct) => void
  onQuickBrand: (product: InventoryProduct) => void
}

const ProductCard = memo(function ProductCard({
  product,
  readOnly,
  loadingId,
  onEdit,
  onToggleActive,
  onDelete,
  onQuickCategory,
  onQuickBrand,
}: ProductCardProps) {
  const status = getStatus(product)
  const config = statusConfig[status]
  const margin = product.cost > 0 && product.price > 0
    ? Math.round(((product.price - product.cost) / product.price) * 100)
    : 0

  return (
    <article
      className={`rounded-[20px] border-2 border-edge/30 ${config.hoverBorder} bg-surface p-4 flex flex-col relative transition-all hover:shadow-md`}
    >
      <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badge}`}>
        {config.label}
      </span>

      <h3
        className="font-semibold text-heading text-sm leading-tight mb-2 truncate pr-16"
        title={product.name}
      >
        {product.name}
      </h3>

      <div className="flex flex-col gap-0.5 mb-3">
        <div
          className={`group/catfield flex items-center gap-1 min-w-0 rounded px-1 -mx-1 ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickCategory(product) : undefined}
        >
          <p className="text-xs text-subtle truncate flex-1 min-w-0">
            <span className="text-hint">Cat:</span> {product.categories?.name ?? '—'}
          </p>
          {!readOnly && (
            <Pencil size={9} className="shrink-0 text-primary opacity-0 group-hover/catfield:opacity-50 transition-opacity" />
          )}
        </div>
        <div
          className={`group/brandfield flex items-center gap-1 min-w-0 rounded px-1 -mx-1 ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickBrand(product) : undefined}
        >
          <p className="text-xs text-subtle truncate flex-1 min-w-0">
            <span className="text-hint">Marca:</span> {product.brand?.name ?? '—'}
          </p>
          {!readOnly && (
            <Pencil size={9} className="shrink-0 text-primary opacity-0 group-hover/brandfield:opacity-50 transition-opacity" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg bg-surface-alt px-2 py-1.5">
          <p className="text-label text-hint">Venta</p>
          <p className="text-emphasis text-heading">
            ${Number(product.price).toLocaleString('es-AR')}
          </p>
        </div>
        <div className="rounded-lg bg-surface-alt px-2 py-1.5">
          <p className="text-label text-hint">Costo</p>
          <p className="text-body-sm text-subtle">
            ${Number(product.cost).toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-3">
        <span className="text-emphasis text-heading">
          {product.stock} <span className="text-xs font-normal text-hint">uds</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-hint">min. {product.min_stock}</span>
          <span className={`text-[10px] font-semibold ${margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'invisible'}`}>
            +{margin}%
          </span>
        </div>
      </div>

      {!readOnly && (
        <div className="flex flex-col gap-1.5 mt-auto">
          <button
            onClick={() => onEdit(product)}
            disabled={loadingId === product.id}
            className="w-full text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
          >
            Editar
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => onToggleActive(product)}
              disabled={loadingId === product.id}
              className="text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
            >
              {product.is_active ? 'Baja' : 'Activar'}
            </button>
            <button
              onClick={() => onDelete(product)}
              disabled={loadingId === product.id}
              className="text-xs py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}
    </article>
  )
})

const ProductListRow = memo(function ProductListRow({
  product,
  readOnly,
  loadingId,
  onEdit,
  onToggleActive,
  onDelete,
  onQuickCategory,
  onQuickBrand,
}: ProductCardProps) {
  const status = getStatus(product)
  const config = statusConfig[status]
  const margin = product.cost > 0 && product.price > 0
    ? Math.round(((product.price - product.cost) / product.price) * 100)
    : 0

  return (
    <TableRow>
      <TableCell>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${config.badge}`}>
          {config.label}
        </span>
      </TableCell>

      <TableCell>
        <p className="font-semibold text-sm text-heading">{product.name}</p>
        <p className="text-xs text-subtle xl:hidden">
          {product.categories?.name ?? '—'} · {product.brand?.name ?? '—'}
        </p>
      </TableCell>

      <TableCell className="hidden xl:table-cell">
        <div
          className={`group/cat flex items-center gap-1 min-w-0 rounded px-1 -mx-1 ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickCategory(product) : undefined}
        >
          <p className="text-sm text-subtle truncate">{product.categories?.name ?? '—'}</p>
          {!readOnly && (
            <Pencil size={11} className="shrink-0 text-primary opacity-0 group-hover/cat:opacity-50 transition-opacity" />
          )}
        </div>
      </TableCell>

      <TableCell className="hidden xl:table-cell">
        <div
          className={`group/brand flex items-center gap-1 min-w-0 rounded px-1 -mx-1 ${!readOnly ? 'cursor-pointer hover:bg-primary/5' : ''}`}
          onClick={!readOnly ? () => onQuickBrand(product) : undefined}
        >
          <p className="text-sm text-subtle truncate">{product.brand?.name ?? '—'}</p>
          {!readOnly && (
            <Pencil size={11} className="shrink-0 text-primary opacity-0 group-hover/brand:opacity-50 transition-opacity" />
          )}
        </div>
      </TableCell>

      <TableCell className="text-right hidden md:table-cell">
        <p className="text-sm font-semibold text-heading tabular-nums">${Number(product.price).toLocaleString('es-AR')}</p>
      </TableCell>

      <TableCell className="text-right hidden lg:table-cell">
        <p className="text-sm text-subtle tabular-nums">${Number(product.cost).toLocaleString('es-AR')}</p>
      </TableCell>

      <TableCell className="text-right hidden lg:table-cell">
        <span className={`text-sm font-semibold ${margin > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-hint'}`}>
          {margin > 0 ? `+${margin}%` : '—'}
        </span>
      </TableCell>

      <TableCell className="text-right">
        <p className="text-sm font-semibold text-heading tabular-nums">{product.stock} <span className="text-xs font-normal text-hint">uds</span></p>
        <p className="text-xs text-hint">min. {product.min_stock}</p>
      </TableCell>

      {!readOnly && (
        <TableCell>
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => onEdit(product)}
              disabled={loadingId === product.id}
              className="text-xs px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
            >
              Editar
            </button>
            <button
              onClick={() => onToggleActive(product)}
              disabled={loadingId === product.id}
              className="text-xs px-3 py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
            >
              {product.is_active ? 'Baja' : 'Activar'}
            </button>
            <button
              onClick={() => onDelete(product)}
              disabled={loadingId === product.id}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
            >
              Eliminar
            </button>
          </div>
        </TableCell>
      )}
    </TableRow>
  )
})

export default function InventoryPanel({ businessId, operatorId, readOnly, initialProducts, categories: initialCategories, brands: initialBrands, defaultPriceList, productOverrides }: Props) {
  const [products, setProducts] = useState(initialProducts)
  const [categories, setCategories] = useState<InventoryCategory[]>(initialCategories)
  const [brands, setBrands] = useState<InventoryBrand[]>(initialBrands)
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
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('inventory-view-mode')
    if (saved === 'grid' || saved === 'list') setViewMode(saved)
  }, [])


  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    setCategories(initialCategories)
  }, [initialCategories])

  useEffect(() => {
    setBrands(initialBrands)
  }, [initialBrands])

  const activeFilterCount = selectedCategories.length + selectedBrands.length + (showInCatalogOnly ? 1 : 0)

  const filtered = useMemo(() => {
    setVisibleCount(PAGE_SIZE)
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

  // Handlers estables via ref para no re-renderizar ProductCard en cada update de estado
  const handlersRef = useRef({
    edit: (_product: InventoryProduct) => {},
    toggleActive: (_product: InventoryProduct) => {},
    delete: (_product: InventoryProduct) => {},
    quickCategory: (_product: InventoryProduct) => {},
    quickBrand: (_product: InventoryProduct) => {},
  })

  // Infinite scroll: al llegar al final del área virtual, carga mas productos
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [sort])

  // Infinite scroll: al llegar al final del área virtual, carga mas productos
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

  const handleEdit = useCallback((product: InventoryProduct) => handlersRef.current.edit(product), [])
  const handleToggleActive = useCallback((product: InventoryProduct) => handlersRef.current.toggleActive(product), [])
  const handleDeleteProduct = useCallback((product: InventoryProduct) => handlersRef.current.delete(product), [])
  const handleQuickCategory = useCallback((product: InventoryProduct) => handlersRef.current.quickCategory(product), [])
  const handleQuickBrand = useCallback((product: InventoryProduct) => handlersRef.current.quickBrand(product), [])

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

  async function updateProduct(productId: string, values: Partial<InventoryProduct>) {
    if (readOnly) {
      setCrudError('Tu rol tiene acceso de solo lectura para stock.')
      return
    }

    if (!businessId) {
      setCrudError('No se encontro el negocio activo para actualizar productos.')
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
  }

  function handleBrandsChanged(updatedBrands: InventoryBrand[]) {
    setBrands(updatedBrands)
    setProducts(prev => prev.map(product => {
      if (!product.brand_id) {
        return {
          ...product,
          brand: null,
        }
      }

      const nextBrand = updatedBrands.find(brand => brand.id === product.brand_id)
      if (!nextBrand) {
        return {
          ...product,
          brand_id: null,
          brand: null,
        }
      }

      return {
        ...product,
        brand: {
          id: nextBrand.id,
          name: nextBrand.name,
        },
      }
    }))
  }

  function handleQuickCategorySaved(productId: string, categoryId: string | null, newCategory?: InventoryCategory) {
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
  }

  function handleQuickBrandSaved(productId: string, brandId: string | null, newBrand?: InventoryBrand) {
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
  }

  function handleDeleteProductImpl(product: InventoryProduct) {
    if (readOnly) {
      setCrudError('Tu rol tiene acceso de solo lectura para stock.')
      return
    }

    if (!businessId) {
      setCrudError('No se encontro el negocio activo para eliminar productos.')
      return
    }

    setPendingConfirm({
      title: `Eliminar "${product.name}"`,
      message: 'Esta accion no se puede deshacer.',
      onConfirm: async () => {
        setCrudError(null)
        setLoadingId(product.id)

        const { error } = await supabase
          .from('products')
          .delete()
          .eq('id', product.id)
          .eq('business_id', businessId)

        if (!error) {
          setProducts(prev => prev.filter(p => p.id !== product.id))
        } else {
          setCrudError(error.message)
        }
        setLoadingId(null)
      },
    })
  }

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

  // Actualizar handlers estables en cada render para que siempre capturen el closure actual
  handlersRef.current = {
    edit: (product: InventoryProduct) => {
      if (readOnly) {
        setCrudError('Tu rol tiene acceso de solo lectura para stock.')
        return
      }
      setEditingProduct(product)
    },
    toggleActive: (product: InventoryProduct) => {
      void updateProduct(product.id, { is_active: !product.is_active })
    },
    delete: handleDeleteProductImpl,
    quickCategory: (product: InventoryProduct) => {
      if (readOnly) return
      setQuickEditCategoryProduct(product)
    },
    quickBrand: (product: InventoryProduct) => {
      if (readOnly) return
      setQuickEditBrandProduct(product)
    },
  }

  if (!businessId) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="Stock" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="surface-card p-6">
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              No se pudo obtener el negocio asociado al usuario actual.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Stock">
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={() => setShowImport(true)}
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
            Nuevo producto
          </Button>
        )}
      </PageHeader>

      <div className="bg-surface border-b border-edge/60 px-5 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar producto, marca o codigo..."
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

          <div className="flex items-center gap-1.5 shrink-0">
            {([
              { key: 'all', label: 'Todos', style: 'bg-primary text-primary-foreground', inactive: 'bg-surface-alt text-body hover:bg-hover-bg' },
              { key: 'low', label: 'Stock bajo', style: 'bg-amber-500 text-white', inactive: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 hover:bg-amber-100 dark:hover:bg-amber-900/40' },
              { key: 'out', label: 'Sin stock', style: 'bg-red-500 text-white', inactive: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/40' },
              { key: 'discontinued', label: 'Discontinuados', style: 'bg-subtle text-white', inactive: 'bg-surface-alt text-body hover:bg-hover-bg' },
            ] as const).map(s => (
              <button
                key={s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`px-3 h-8 rounded-full text-xs font-medium transition-colors ${statusFilter === s.key ? s.style : s.inactive}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <span className="text-xs text-subtle ml-auto shrink-0">{filtered.length} productos</span>

          <div className="flex items-center gap-1 shrink-0 border border-edge rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => { setViewMode('list'); localStorage.setItem('inventory-view-mode', 'list') }}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-subtle hover:text-body hover:bg-surface-alt'}`}
              title="Vista lista"
            >
              <LayoutList size={15} />
            </button>
            <button
              type="button"
              onClick={() => { setViewMode('grid'); localStorage.setItem('inventory-view-mode', 'grid') }}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-subtle hover:text-body hover:bg-surface-alt'}`}
              title="Vista cuadricula"
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 py-2 bg-surface border-b border-edge/60">
          {selectedCategories.map(id => {
            const cat = categories.find(c => c.id === id)
            if (!cat) return null
            return (
              <span key={id} className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary rounded-full px-2.5 py-1 font-medium">
                {cat.icon} {cat.name}
                <button
                  type="button"
                  onClick={() => setSelectedCategories(prev => prev.filter(c => c !== id))}
                  className="hover:opacity-70 transition-opacity"
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
                  className="hover:opacity-70 transition-opacity"
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
        <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-700">
          Acceso de solo lectura habilitado para stock.
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="surface-card p-12 text-center text-hint">
            No hay productos con los filtros actuales
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {visibleProducts.map(product => (
              <ProductCard
                key={product.id}
                product={product}
                readOnly={readOnly}
                loadingId={loadingId}
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
                  <TableHead>Estado</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="hidden xl:table-cell">Categoria</TableHead>
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
            Mostrando {visibleCount} de {filtered.length} — seguí scrolleando para ver más
          </div>
        )}
      </div>

      {!readOnly && (
        <NewProductModal
          open={showNewProduct}
          onClose={() => setShowNewProduct(false)}
          businessId={businessId}
          defaultPriceList={defaultPriceList}
          categories={categories}
          brands={brands}
          onCreated={product => setProducts(prev => [product, ...prev])}
        />
      )}

      {businessId && (
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
          categories={categories}
          brands={brands}
          defaultPriceList={defaultPriceList}
          existingOverride={productOverrides.find(override => override.product_id === editingProduct.id) ?? null}
          onSaved={values => {
            void updateProduct(editingProduct.id, values)
            setEditingProduct(null)
          }}
        />
      )}

      {businessId && (
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
          onClose={() => setShowImport(false)}
          onImported={async () => {
            setShowImport(false)
            const [{ data: updatedProducts }, { data: updatedCategories }, { data: updatedBrands }] = await Promise.all([
              supabase
                .from('products')
                .select('id, business_id, name, price, cost, stock, min_stock, is_active, show_in_catalog, category_id, sku, barcode, brand_id, brands(id, name), categories(name, icon)')
                .eq('business_id', businessId)
                .order('name'),
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
            if (updatedProducts) {
              setProducts(updatedProducts.map(p => ({
                ...p,
                price: Number(p.price),
                cost: Number(p.cost),
                brand_id: p.brand_id ?? null,
                brand: Array.isArray(p.brands) ? p.brands[0] ?? null : (p.brands as { id: string; name: string } | null) ?? null,
                categories: Array.isArray(p.categories) ? p.categories[0] ?? null : (p.categories as { name: string; icon: string } | null) ?? null,
              })))
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
        <span>Valor inventario ${inventoryValue.toLocaleString('es-AR')}</span>
        <span>Margen promedio {avgMargin.toFixed(0)}%</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          {outOfStock} sin stock
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          {lowStock} stock bajo
        </span>
        <span className="ml-auto">{categoryCount} categorias</span>
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
    </div>
  )
}
