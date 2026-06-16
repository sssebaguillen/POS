'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { calculateProductPrice, getMarginPercent } from '@/lib/price-lists'
import type { PriceList, PriceListOverride, ProductVariant, ProductWithVariants } from '@/lib/types'
import { unwrapProductWithVariants } from '@/lib/mappers'
import type { PriceListProduct } from '@/components/price-lists/types'

interface VariantPriceModalProps {
  open: boolean
  onClose: () => void
  product: PriceListProduct
  activeList: PriceList
  activeMultiplier: number
  productOverride: PriceListOverride | null
  brandOverride: PriceListOverride | null
  overrides: PriceListOverride[]
}

function getVariantLabel(variant: ProductVariant, data: ProductWithVariants): string {
  return data.options
    .map(o => variant.option_values.find(ov => ov.option_id === o.id)?.value ?? '')
    .filter(Boolean)
    .join(' / ')
}

export default function VariantPriceModal({
  open,
  onClose,
  product,
  activeList,
  activeMultiplier,
  productOverride,
  brandOverride,
  overrides,
}: VariantPriceModalProps) {
  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()
  const [data, setData] = useState<ProductWithVariants | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setData(null)
    supabase.rpc('get_product_with_variants', { p_product_id: product.id }).then(({ data: rpc }) => {
      setLoading(false)
      setData(unwrapProductWithVariants(rpc))
    })
  }, [open, product.id, supabase])

  const activeVariants = useMemo(
    () => data?.variants.filter(v => v.is_active) ?? [],
    [data]
  )

  const marginPct = getMarginPercent(activeMultiplier)

  const multiplierSource = productOverride
    ? 'Ajuste por producto'
    : brandOverride
      ? 'Ajuste por marca'
      : activeList.name

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent className="sm:max-w-[600px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false}>
        <VisuallyHidden><DialogTitle>Variantes — {product.name}</DialogTitle></VisuallyHidden>

        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-heading">{product.name}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-3.5">
          <div className="rounded-xl border border-edge/70 bg-surface overflow-hidden">
            <div className="grid grid-cols-4 divide-x divide-edge/60">
              <div className="px-3 py-2.5">
                <p className="text-xs text-subtle uppercase tracking-wide">Categoría</p>
                <p className="text-sm font-medium text-body truncate">{product.categories?.name ?? 'Sin categoría'}</p>
              </div>
              <div className="px-3 py-2.5">
                <p className="text-xs text-subtle uppercase tracking-wide">Marca</p>
                <p className="text-sm font-medium text-body truncate">{product.brand?.name ?? 'Sin marca'}</p>
              </div>
              <div className="px-3 py-2.5">
                <p className="text-xs text-subtle uppercase tracking-wide">Margen activo</p>
                <p className={`text-sm font-semibold tabular-nums ${
                  marginPct > 0
                    ? 'text-success'
                    : marginPct === 0
                      ? 'text-warning'
                      : 'text-destructive'
                }`}>
                  +{marginPct}%
                </p>
              </div>
              <div className="px-3 py-2.5">
                <p className="text-xs text-subtle uppercase tracking-wide">Lista</p>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  productOverride ?? brandOverride
                    ? 'bg-primary/10 dark:bg-primary/20 text-primary border border-primary/20 dark:border-primary/40'
                    : 'bg-surface-alt text-subtle border border-edge/60'
                }`}>
                  {multiplierSource}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-edge/70 overflow-hidden">
            {loading ? (
              <div className="py-10 text-center text-sm text-hint">Cargando variantes…</div>
            ) : activeVariants.length === 0 ? (
              <div className="py-10 text-center text-sm text-hint">Sin variantes activas.</div>
            ) : (
              <div className="overflow-y-auto max-h-[320px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variante</TableHead>
                      <TableHead className="text-right">Costo</TableHead>
                      <TableHead className="text-right">Precio de lista</TableHead>
                      <TableHead className="text-right">Margen %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeVariants.map(variant => {
                      const label = data ? getVariantLabel(variant, data) : variant.id
                      const cost = Number(variant.cost)
                      const price = Number(variant.price)
                      const listPrice = calculateProductPrice(
                        cost,
                        price,
                        product.id,
                        product.brand_id,
                        activeList,
                        overrides,
                        price,
                      )
                      // Margen real por variante: si tiene precio explícito (price > 0), el
                      // margen se infiere de price/cost; si depende de la lista, usa el multiplicador
                      // efectivo (productOverride > brandOverride > activeList.multiplier).
                      const margin =
                        cost > 0
                          ? price > 0
                            ? getMarginPercent(price / cost)
                            : getMarginPercent(activeMultiplier)
                          : null
                      const isManual = price > 0 && cost > 0 && Math.abs(price / cost - activeMultiplier) > 0.0001

                      return (
                        <TableRow key={variant.id}>
                          <TableCell>
                            <p className="font-medium text-heading">{label || '—'}</p>
                            {variant.sku && (
                              <p className="text-xs text-hint">{variant.sku}</p>
                            )}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums${cost === 0 ? ' text-hint' : ''}`}>
                            {formatMoney(cost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span className="inline-flex items-center gap-1.5 justify-end">
                              {formatMoney(listPrice)}
                              {isManual && (
                                <span
                                  className="inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-medium bg-primary/10 dark:bg-primary/20 text-primary border border-primary/20 dark:border-primary/40"
                                  title="Precio manual de la variante — la lista no lo modifica"
                                >
                                  Manual
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {margin === null ? (
                              <span className="text-hint">—</span>
                            ) : (
                              <span className={
                                margin > 0
                                  ? 'text-success font-semibold'
                                  : margin === 0
                                    ? 'text-warning font-semibold'
                                    : 'text-destructive font-semibold'
                              }>
                                {margin}%
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
