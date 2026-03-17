'use client'

import { useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import NewProductModal from '@/components/stock/NewProductModal'
import type { InventoryProduct, InventoryBrand } from '@/components/stock/types'
import type { PriceList } from '@/components/price-lists/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Category {
  id: string
  name: string
  icon: string
}

interface Props {
  businessId: string
  initialProducts: InventoryProduct[]
  categories: Category[]
  brands: InventoryBrand[]
  defaultPriceList: PriceList | null
}

type StatusFilter = 'all' | 'active' | 'inactive'

export default function ProductsPanel({ businessId, initialProducts, categories, brands, defaultPriceList }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [products, setProducts] = useState(initialProducts)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [crudError, setCrudError] = useState<string | null>(null)

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return products.filter(product => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        product.name.toLowerCase().includes(normalizedQuery) ||
        product.sku?.toLowerCase().includes(normalizedQuery) ||
        product.barcode?.toLowerCase().includes(normalizedQuery)

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && product.is_active) ||
        (statusFilter === 'inactive' && !product.is_active)

      return matchesQuery && matchesStatus
    })
  }, [products, query, statusFilter])

  const totals = useMemo(() => {
    const activeCount = products.filter(product => product.is_active).length
    const inactiveCount = products.length - activeCount

    return {
      all: products.length,
      active: activeCount,
      inactive: inactiveCount,
    }
  }, [products])

  async function toggleStatus(product: InventoryProduct) {
    setCrudError(null)
    setLoadingId(product.id)

    const { error } = await supabase
      .from('products')
      .update({ is_active: !product.is_active })
      .eq('id', product.id)
      .eq('business_id', businessId)

    if (error) {
      setCrudError(error.message)
      setLoadingId(null)
      return
    }

    setProducts(prev => prev.map(item => (
      item.id === product.id ? { ...item, is_active: !item.is_active } : item
    )))
    setLoadingId(null)
  }

  async function deleteProduct(product: InventoryProduct) {
    const confirmed = window.confirm(`Eliminar "${product.name}"? Esta accion no se puede deshacer.`)
    if (!confirmed) return

    setCrudError(null)
    setLoadingId(product.id)

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', product.id)
      .eq('business_id', businessId)

    if (error) {
      setCrudError(error.message)
      setLoadingId(null)
      return
    }

    setProducts(prev => prev.filter(item => item.id !== product.id))
    setLoadingId(null)
  }

  function exportCsv() {
    const headers = ['id', 'nombre', 'categoria', 'sku', 'precio', 'costo', 'stock', 'estado']
    const rows = filteredProducts.map(product => [
      product.id,
      product.name,
      product.categories?.name ?? '',
      product.sku ?? '',
      product.price.toString(),
      product.cost.toString(),
      product.stock.toString(),
      product.is_active ? 'activo' : 'inactivo',
    ])

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `productos-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Productos">
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={exportCsv}
          disabled={filteredProducts.length === 0}
        >
          Exportar CSV
        </Button>
        <Button
          size="sm"
          className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={() => setShowNewProduct(true)}
        >
          Nuevo producto
        </Button>
      </PageHeader>

      <div className="bg-surface border-b border-edge/60 px-5 py-3 flex flex-wrap gap-3 items-center">
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Buscar por nombre, SKU o codigo..."
          className="h-9 max-w-sm rounded-lg text-sm"
        />

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setStatusFilter('all')}
            className={`h-8 px-3 rounded-full text-xs font-medium transition-colors ${
              statusFilter === 'all' ? 'bg-heading text-white' : 'bg-surface-alt text-body hover:bg-hover-bg'
            }`}
          >
            Todos ({totals.all})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`h-8 px-3 rounded-full text-xs font-medium transition-colors ${
              statusFilter === 'active' ? 'bg-primary text-primary-foreground' : 'bg-surface-alt text-body hover:bg-hover-bg'
            }`}
          >
            Activos ({totals.active})
          </button>
          <button
            onClick={() => setStatusFilter('inactive')}
            className={`h-8 px-3 rounded-full text-xs font-medium transition-colors ${
              statusFilter === 'inactive' ? 'bg-red-600 text-white' : 'bg-surface-alt text-body hover:bg-hover-bg'
            }`}
          >
            Inactivos ({totals.inactive})
          </button>
        </div>
      </div>

      {crudError && (
        <div className="mx-5 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {crudError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5">
        <div className="surface-card p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-28 text-center text-sm text-hint">
                    No hay productos para mostrar
                  </TableCell>
                </TableRow>
              ) : (
                filteredProducts.map(product => {
                  const lowStock = product.is_active && product.stock <= product.min_stock

                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <p className="font-medium text-heading">{product.name}</p>
                        <p className="text-xs text-hint">{product.barcode ?? 'Sin codigo de barras'}</p>
                      </TableCell>
                      <TableCell className="text-body">
                        {product.categories?.name ?? 'Sin categoria'}
                      </TableCell>
                      <TableCell className="text-body">{product.sku ?? '-'}</TableCell>
                      <TableCell className="text-right tabular-nums">${product.price.toLocaleString('es-AR')}</TableCell>
                      <TableCell className="text-right tabular-nums">${product.cost.toLocaleString('es-AR')}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={lowStock ? 'text-amber-700 font-semibold' : 'text-body'}>
                          {product.stock}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          product.is_active
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {product.is_active ? 'Activo' : 'Inactivo'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg text-xs"
                            disabled={loadingId === product.id}
                            onClick={() => toggleStatus(product)}
                          >
                            {product.is_active ? 'Desactivar' : 'Activar'}
                          </Button>
                          <Button
                            variant="cancel"
                            size="sm"
                            className="h-8 rounded-lg text-xs"
                            disabled={loadingId === product.id}
                            onClick={() => deleteProduct(product)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <NewProductModal
        open={showNewProduct}
        onClose={() => setShowNewProduct(false)}
        businessId={businessId}
        categories={categories}
        brands={brands}
        defaultPriceList={defaultPriceList}
        onCreated={product => setProducts(prev => [product, ...prev])}
      />
    </div>
  )
}
