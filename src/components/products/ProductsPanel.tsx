'use client'

import { useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import NewProductModal from '@/components/stock/NewProductModal'
import ConfirmModal from '@/components/shared/ConfirmModal'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import type { InventoryProduct, InventoryBrand } from '@/components/stock/types'
import type { PriceList } from '@/lib/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ConfirmState = { title: string; message: string; onConfirm: () => void } | null

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
  priceLists: PriceList[]
}

type StatusFilter = 'all' | 'active' | 'inactive'

export default function ProductsPanel({ businessId, initialProducts, categories, brands, priceLists }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [products, setProducts] = useState(initialProducts)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [crudError, setCrudError] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState>(null)

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

  const csvData = useMemo(
    () =>
      filteredProducts.map(product => ({
        id: product.id,
        nombre: product.name,
        categoria: product.categories?.name ?? '',
        sku: product.sku ?? '',
        precio: product.price,
        costo: product.cost,
        stock: product.stock,
        estado: product.is_active ? 'activo' : 'inactivo',
      })),
    [filteredProducts]
  )

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

  function deleteProduct(product: InventoryProduct) {
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

        if (error) {
          setCrudError(error.message)
          setLoadingId(null)
          return
        }

        setProducts(prev => prev.filter(item => item.id !== product.id))
        setLoadingId(null)
      },
    })
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Productos">
        <ExportCSVButton data={csvData} filename={`productos-${new Date().toISOString().slice(0, 10)}`} />
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

        <div className="pill-tabs">
          <button
            onClick={() => setStatusFilter('all')}
            className={`pill-tab${statusFilter === 'all' ? ' pill-tab-active' : ''}`}
          >
            Todos ({totals.all})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`pill-tab${statusFilter === 'active' ? ' pill-tab-active' : ''}`}
          >
            Activos ({totals.active})
          </button>
          <button
            onClick={() => setStatusFilter('inactive')}
            className={`pill-tab${statusFilter === 'inactive' ? ' pill-tab-active' : ''}`}
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
        priceLists={priceLists}
        onCreated={product => setProducts(prev => [product, ...prev])}
      />

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
