'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/shared/PageHeader'
import NewProductModal from '@/components/stock/NewProductModal'

interface InventoryCategory {
  id: string
  name: string
  icon: string
}

interface InventoryProduct {
  id: string
  name: string
  price: number
  cost: number
  stock: number
  min_stock: number
  is_active: boolean
  category_id: string | null
  sku: string | null
  barcode: string | null
  categories?: {
    name: string
    icon: string
  } | null
}

type FilterStatus = 'all' | 'low' | 'out' | 'discontinued'

interface Props {
  initialProducts: InventoryProduct[]
  categories: InventoryCategory[]
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
    border: 'border-emerald-300',
    badge: 'bg-emerald-50 text-emerald-700',
    bar: 'bg-emerald-500',
  },
  low: {
    label: 'STOCK BAJO',
    border: 'border-amber-300',
    badge: 'bg-amber-50 text-amber-700',
    bar: 'bg-amber-500',
  },
  out: {
    label: 'SIN STOCK',
    border: 'border-red-300 border-dashed',
    badge: 'bg-red-50 text-red-600',
    bar: 'bg-red-500',
  },
  discontinued: {
    label: 'DISCONTINUADO',
    border: 'border-faint border-dashed',
    badge: 'bg-muted text-muted-foreground',
    bar: 'bg-muted-foreground',
  },
}

export default function InventoryPanel({ initialProducts, categories }: Props) {
  const [products, setProducts] = useState(initialProducts)
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showNewProduct, setShowNewProduct] = useState(false)

  const supabase = createClient()

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

  // Aggregate stats
  const activeProducts = products.filter(p => p.is_active)
  const totalStock = activeProducts.reduce((acc, p) => acc + p.stock, 0)
  const inventoryValue = activeProducts.reduce((acc, p) => acc + p.cost * p.stock, 0)
  const avgMargin = (() => {
    const withCost = activeProducts.filter(p => p.cost > 0)
    if (withCost.length === 0) return 0
    const margins = withCost.map(p => ((p.price - p.cost) / p.price) * 100)
    return margins.reduce((a, b) => a + b, 0) / margins.length
  })()
  const outOfStock = activeProducts.filter(p => p.stock <= 0).length
  const lowStock = activeProducts.filter(p => p.stock > 0 && p.stock <= p.min_stock).length
  const categoryCount = new Set(products.map(p => p.category_id).filter(Boolean)).size

  async function updateProduct(productId: string, values: Partial<InventoryProduct>) {
    setLoadingId(productId)
    const { error } = await supabase
      .from('products')
      .update(values)
      .eq('id', productId)

    if (!error) {
      setProducts(prev => prev.map(p => (p.id === productId ? { ...p, ...values } : p)))
    }
    setLoadingId(null)
  }

  async function handleAdjustStock(product: InventoryProduct) {
    const raw = prompt(`Nuevo stock para ${product.name}`, String(product.stock))
    if (raw === null) return
    const nextStock = Number(raw)
    if (!Number.isFinite(nextStock) || nextStock < 0) return
    await updateProduct(product.id, { stock: Math.trunc(nextStock) })
  }

  async function handleEditProduct(product: InventoryProduct) {
    const nextName = prompt('Nombre del producto', product.name)
    if (!nextName) return
    const nextPrice = prompt('Precio de venta', String(product.price))
    if (!nextPrice) return
    const nextCost = prompt('Precio de costo', String(product.cost))
    if (!nextCost) return

    await updateProduct(product.id, {
      name: nextName.trim(),
      price: Number(nextPrice) || product.price,
      cost: Number(nextCost) || product.cost,
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

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Stock">
        <Button variant="outline" size="sm" className="rounded-lg text-xs" disabled>
          ↓ Importar
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={exportCsv} disabled={filtered.length === 0}>
          ↑ Exportar
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg text-xs" disabled>
          📁 Categorías
        </Button>
        <Button variant="outline" size="sm" className="rounded-lg text-xs" disabled>
          🏷️ Marcas
        </Button>
        <Button size="sm" className="rounded-lg text-xs bg-emerald-700 hover:bg-emerald-800 text-white" onClick={() => setShowNewProduct(true)}>
          + Nuevo producto
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="bg-surface border-b border-edge/60 px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar producto, marca o código..."
            className="h-9 max-w-xs rounded-lg text-sm"
          />
          <select
            className="h-9 rounded-lg border border-edge px-3 text-sm bg-surface text-body"
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
          >
            <option value="all">Todas las categorías</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.icon} {category.name}
              </option>
            ))}
          </select>

          <div className="flex gap-1.5 ml-auto">
            {([
              { key: 'all', label: 'Todos', style: 'bg-heading text-white', inactive: 'bg-surface-alt text-body hover:bg-hover-bg' },
              { key: 'low', label: 'Stock bajo', style: 'bg-amber-500 text-white', inactive: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
              { key: 'out', label: 'Sin stock', style: 'bg-red-500 text-white', inactive: 'bg-red-50 text-red-700 hover:bg-red-100' },
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

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-5">
        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-surface border border-edge/60 p-12 text-center text-hint">
            No hay productos con los filtros actuales
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
            {filtered.map(product => {
              const status = getStatus(product)
              const config = statusConfig[status]
              const margin = product.cost > 0
                ? Math.round(((product.price - product.cost) / product.price) * 100)
                : 0
              const stockPercent = product.min_stock > 0
                ? Math.min(100, Math.round((product.stock / (product.min_stock * 2)) * 100))
                : 100

              return (
                <article
                  key={product.id}
                  className={`rounded-2xl border-2 bg-surface p-4 flex flex-col relative transition-shadow hover:shadow-md ${config.border}`}
                >
                  {/* Status badge */}
                  <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full ${config.badge}`}>
                    {config.label}
                  </span>

                  {/* Emoji */}
                  <div className="text-4xl mb-3 mx-auto">
                    {product.categories?.icon ?? '📦'}
                  </div>

                  {/* Name */}
                  <h3 className="font-semibold text-heading text-sm leading-tight mb-1 line-clamp-2">
                    {product.name}
                  </h3>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {product.categories?.name && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-subtle">
                        {product.categories.name}
                      </span>
                    )}
                  </div>

                  {/* Prices */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="rounded-lg bg-surface-alt px-2 py-1.5">
                      <p className="text-[10px] text-hint uppercase font-medium">Venta</p>
                      <p className="text-sm font-bold text-heading">
                        ${Number(product.price).toLocaleString('es-AR')}
                      </p>
                    </div>
                    <div className="rounded-lg bg-surface-alt px-2 py-1.5">
                      <p className="text-[10px] text-hint uppercase font-medium">Costo</p>
                      <p className="text-sm font-bold text-heading">
                        ${Number(product.cost).toLocaleString('es-AR')}{' '}
                        <span className="text-[10px] font-normal text-hint">{margin}%</span>
                      </p>
                    </div>
                  </div>

                  {/* Stock bar */}
                  <div className="mb-3">
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-lg font-bold text-heading">
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

                  {/* Actions */}
                  <div className="flex gap-1.5 mt-auto">
                    <button
                      onClick={() => handleEditProduct(product)}
                      disabled={loadingId === product.id}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
                    >
                      ✏️ Editar
                    </button>
                    <button
                      onClick={() => handleAdjustStock(product)}
                      disabled={loadingId === product.id}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
                    >
                      + Ajustar
                    </button>
                    <button
                      onClick={() => updateProduct(product.id, { is_active: !product.is_active })}
                      disabled={loadingId === product.id}
                      className="flex-1 text-xs py-1.5 rounded-lg border border-edge text-body hover:bg-hover-bg transition-colors disabled:opacity-50"
                    >
                      ⊘ Baja
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      <NewProductModal
        open={showNewProduct}
        onClose={() => setShowNewProduct(false)}
        categories={categories}
        onCreated={product => setProducts(prev => [product, ...prev])}
      />

      {/* Bottom stats bar */}
      <div className="bg-surface border-t border-edge/60 px-5 py-2.5 flex items-center gap-6 text-xs text-subtle shrink-0 overflow-x-auto">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          {activeProducts.length} productos activos
        </span>
        <span>○ {totalStock} uds en stock</span>
        <span>$ Valor inventario ${inventoryValue.toLocaleString('es-AR')}</span>
        <span>↗ Margen promedio {avgMargin.toFixed(0)}%</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          {outOfStock} sin stock
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          {lowStock} stock bajo
        </span>
        <span className="ml-auto">📁 {categoryCount} categorías</span>
      </div>
    </div>
  )
}
