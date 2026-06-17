'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { translateDbError } from '@/lib/errors'
import type { ProductVariant } from '@/lib/types'
import { unwrapProductWithVariants } from '@/lib/mappers'

interface ProductStockModalProps {
  productId: string
  businessId: string
  onClose: () => void
}

export default function ProductStockModal({ productId, businessId, onClose }: ProductStockModalProps) {
  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()

  const { data, isLoading: loading, error } = useQuery({
    queryKey: ['product-variants-stock', productId],
    queryFn: async () => {
      const { data: rpc, error: rpcError } = await supabase
        .rpc('get_product_with_variants', { p_product_id: productId })
      if (rpcError) throw new Error(translateDbError(rpcError.message, 'No se pudo cargar el stock de variantes.'))
      const result = unwrapProductWithVariants(rpc)
      if (!result || result.product.business_id !== businessId) throw new Error('Producto no encontrado')
      return result
    },
  })

  const variants = data?.variants ?? []
  const totalStock = variants.reduce((sum, v) => sum + (v.stock ?? 0), 0)
  const productName = data?.product.name ?? ''

  function stockColor(v: ProductVariant) {
    if (v.stock <= 0) return 'text-destructive'
    if (v.stock <= v.min_stock) return 'text-warning'
    return 'text-success'
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-[640px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false} aria-describedby={undefined}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-edge shrink-0">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold text-heading truncate">
              {productName || 'Producto'}
            </DialogTitle>
            <p className="text-xs text-subtle mt-0.5">Stock por variante</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint shrink-0"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-hint">Cargando variantes...</div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error?.message}
            </div>
          ) : variants.length === 0 ? (
            <div className="py-10 text-center text-sm text-hint">Este producto no tiene variantes.</div>
          ) : (
            <div className="rounded-xl border border-edge/70 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variante</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map(v => {
                    const label = v.option_values.map(ov => ov.value).join(' / ') || '—'
                    const price = Number(v.price)
                    const cost = Number(v.cost)
                    const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0
                    return (
                      <TableRow key={v.id}>
                        <TableCell>
                          <span className="text-sm font-medium text-heading">{label}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={`text-sm font-semibold ${stockColor(v)}`}>
                            {v.stock}
                          </span>
                          <span className="text-xs text-hint ml-1">uds</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="text-sm text-heading">{formatMoney(price)}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className="text-sm text-subtle">{formatMoney(cost)}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={`text-sm font-semibold ${margin > 0 ? 'text-success' : 'text-hint'}`}>
                            {margin > 0 ? `${margin}%` : '—'}
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {!loading && !error && variants.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-edge bg-surface-alt/40">
            <span className="text-xs text-subtle">Total de unidades</span>
            <span className="text-sm font-semibold text-heading tabular-nums">
              {totalStock} <span className="text-xs font-normal text-hint">uds</span>
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
