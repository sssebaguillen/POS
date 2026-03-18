'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import PageHeader from '@/components/shared/PageHeader'
import NewProductModal from '@/components/stock/NewProductModal'
import EditProductModal from '@/components/stock/EditProductModal'
import CategoryModal from '@/components/stock/CategoryModal'
import BrandModal from './BrandModal'
import ImportProductsModal from '@/components/stock/ImportProductsModal'
import ConfirmModal from '@/components/shared/ConfirmModal'
import type { PriceList, PriceListOverride } from '@/components/price-lists/types'
import type { InventoryBrand, InventoryCategory, InventoryProduct } from '@/components/stock/types'

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
    badge: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50',
    bar: 'bg-emerald-500',
  },
  low: {
    label: 'STOCK BAJO',
    border: 'border-amber-300 dark:border-amber-800/50',
    badge: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50',
    bar: 'bg-amber-500',
  },
  out: {
    label: 'SIN STOCK',
    border: 'border-red-300 dark:border-red-800/50 border-dashed',
    badge: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50',
    bar: 'bg-red-500',
  },
  discontinued: {
    label: 'DISCONTINUADO',
    border: 'border-faint border-dashed',
    badge: 'bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
  },
}

export default function InventoryPanel({ businessId, operatorId, readOnly, initialProducts, categories: initialCategories, brands: initialBrands, defaultPriceList, productOverrides }: Props) {
  const [products, setProducts] = useState(initialProducts)
  const [categories, setCategories] = useState<InventoryCategory[]>(initialCategories)
  const [brands, setBrands] = useState<InventoryBrand[]>(initialBrands)
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [showBrands, setShowBrands] = useState(false)
  const [editingProduct, setEditingProduct] = useState<InventoryProduct | null>(null)
  const [crudError, setCrudError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState>(null)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    setCategories(initialCategories)
  }, [initialCategories])

  useEffect(() => {
    setBrands(initialBrands)
  }, [initialBrands])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter(product => {
      const status = getStatus(product)
      const matchesQuery =
        q.length === 0 ||
        product.name.toLowerCase().includes(q) ||
        (product.sku ?? '').toLowerCase().includes(q) ||
        (product.barcode ?? '').toLowerCase().includes(q)
      const matchesCategory = selectedCategory === 'all' || product.category_id === selectedCategory
      const matchesStatus = statusFilter === 'all' || status === statusFilter
      return matchesQuery && matchesCategory && matchesStatus
    })
  }, [products, query, selectedCategory, statusFilter])

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

  function handleEditProduct(product: InventoryProduct) {
    if (readOnly) {
      setCrudError('Tu rol tiene acceso de solo lectura para stock.')
      return
    }

    setEditingProduct(product)
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

  function handleDeleteProduct(product: InventoryProduct) {
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

  if (!businessId) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
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
    <div className="flex flex-col h-screen overflow-hidden">
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
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar producto, marca o codigo..."
            className="h-9 max-w-xs rounded-lg text-sm"
          />
          <SelectDropdown
            value={selectedCategory}
            onChange={setSelectedCategory}
            options={[
              { value: 'all', label: 'Todas las categorias' },
              ...categories.map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })),
            ]}
            className="h-9 w-44"
          />

          <div className="flex gap-1.5 ml-auto">
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

          <span className="text-xs text-subtle ml-2">{filtered.length} productos</span>
        </div>
      </div>

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

      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="surface-card p-12 text-center text-hint">
            No hay productos con los filtros actuales
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
            {filtered.map(product => {
              const status = getStatus(product)
              const config = statusConfig[status]
              const margin = product.cost > 0 && product.price > 0
                ? Math.round(((product.price - product.cost) / product.price) * 100)
                : 0
              const stockPercent = product.min_stock > 0
                ? Math.min(100, Math.round((product.stock / (product.min_stock * 2)) * 100))
                : 100

              return (
                <article
                  key={product.id}
                  className={`rounded-[20px] border-2 bg-surface p-5 flex flex-col relative transition-shadow hover:shadow-md ${config.border}`}
                >
                  <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badge}`}>
                    {config.label}
                  </span>

                  <div className="h-12 w-12 mb-3 mx-auto rounded-xl bg-surface-alt border border-edge flex items-center justify-center text-xs font-semibold text-subtle">
                    CAT
                  </div>

                  <h3 className="font-semibold text-heading text-sm leading-tight mb-1 line-clamp-2">
                    {product.name}
                  </h3>


                  <div className="grid grid-cols-2 gap-2 mb-3 rounded-lg bg-surface-alt px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="text-label text-hint">Categoría</p>
                      <p className="text-caption text-subtle truncate">{product.categories?.name ?? '—'}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-label text-hint">Marca</p>
                      <p className="text-caption text-subtle truncate">{product.brand?.name ?? '—'}</p>
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

                  {margin > 0 && (
                    <div className="mb-2">
                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        +{margin}% margen
                      </span>
                    </div>
                  )}

                  <div className="mb-3">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-emphasis text-heading">
                        {product.stock} <span className="text-xs font-normal text-hint">uds</span>
                      </span>
                      <span className="text-[10px] text-hint">min. {product.min_stock}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-alt overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${config.bar}`}
                        style={{ width: `${stockPercent}%` }}
                      />
                    </div>
                  </div>

                  {!readOnly && (
                    <div className="flex flex-col gap-1.5 mt-auto">
                      <button
                        onClick={() => handleEditProduct(product)}
                        disabled={loadingId === product.id}
                        className="w-full text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
                      >
                        Editar
                      </button>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => updateProduct(product.id, { is_active: !product.is_active })}
                          disabled={loadingId === product.id}
                          className="text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
                        >
                          {product.is_active ? 'Baja' : 'Activar'}
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product)}
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
            })}
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

      <ConfirmModal
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null) }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  )
}
