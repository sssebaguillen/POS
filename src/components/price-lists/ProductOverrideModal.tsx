'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceListOverride } from '@/lib/types'
import type { PriceListProduct } from '@/components/price-lists/types'
import { normalizePriceListOverride } from '@/lib/mappers'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

interface ProductOverrideModalProps {
  open: boolean
  onClose: () => void
  priceListId: string
  product: PriceListProduct
  currentOverride: PriceListOverride | null
  brandOverride: PriceListOverride | null
  listMultiplier: number
  effectiveMultiplier: number
  onSaved: (override: PriceListOverride | null) => void
}

export default function ProductOverrideModal({
  open,
  onClose,
  priceListId,
  product,
  currentOverride,
  brandOverride,
  listMultiplier,
  effectiveMultiplier,
  onSaved,
}: ProductOverrideModalProps) {
  const [percentage, setPercentage] = useState(currentOverride ? ((currentOverride.multiplier - 1) * 100).toFixed(2) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()

  const currentPrice = product.cost > 0 ? product.cost * effectiveMultiplier : null

  const parsedPct = Number(percentage)
  const previewPrice = product.cost > 0 && percentage.trim() !== '' && Number.isFinite(parsedPct) && parsedPct > 0
    ? product.cost * (1 + parsedPct / 100)
    : null

  const priceChanged = previewPrice !== null && currentPrice !== null
    && Math.abs(previewPrice - currentPrice) > 0.005

  function handleClose() {
    if (saving) return
    setError(null)
    onClose()
  }

  async function handleReset() {
    if (!currentOverride && !brandOverride) return
    setSaving(true)
    setError(null)

    if (currentOverride) {
      const { error: deleteError } = await supabase
        .from('price_list_overrides')
        .delete()
        .eq('id', currentOverride.id)

      setSaving(false)

      if (deleteError) {
        setError(deleteError.message)
        return
      }

      onSaved(null)
      onClose()
      return
    }

    // brand override only: pin product to list base multiplier to bypass brand override
    const { data, error: insertError } = await supabase
      .from('price_list_overrides')
      .insert({
        price_list_id: priceListId,
        product_id: product.id,
        brand_id: null,
        multiplier: listMultiplier,
      })
      .select('id, price_list_id, product_id, brand_id, multiplier')
      .single()

    setSaving(false)

    if (insertError || !data) {
      setError(insertError?.message ?? 'Error al restablecer el override')
      return
    }

    onSaved({
      ...normalizePriceListOverride(data),
    })
    onClose()
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    const nextValue = percentage.trim()

    if (!nextValue) {
      if (!currentOverride) {
        setSaving(false)
        onSaved(null)
        onClose()
        return
      }

      const { error: deleteError } = await supabase
        .from('price_list_overrides')
        .delete()
        .eq('id', currentOverride.id)

      setSaving(false)

      if (deleteError) {
        setError(deleteError.message)
        return
      }

      onSaved(null)
      onClose()
      return
    }

    const parsedPercentage = Number(nextValue)
    if (!Number.isFinite(parsedPercentage) || parsedPercentage <= 0) {
      setSaving(false)
      setError('El margen debe ser un número mayor a 0.')
      return
    }

    const parsedMultiplier = 1 + parsedPercentage / 100

    if (currentOverride) {
      const { data, error: updateError } = await supabase
        .from('price_list_overrides')
        .update({ multiplier: parsedMultiplier })
        .eq('id', currentOverride.id)
        .select('id, price_list_id, product_id, brand_id, multiplier')
        .single()

      setSaving(false)

      if (updateError || !data) {
        setError(updateError?.message ?? 'Error al actualizar override')
        return
      }

      onSaved({
        ...normalizePriceListOverride(data),
      })
      onClose()
      return
    }

    const { data, error: insertError } = await supabase
      .from('price_list_overrides')
      .insert({
        price_list_id: priceListId,
        product_id: product.id,
        brand_id: null,
        multiplier: parsedMultiplier,
      })
      .select('id, price_list_id, product_id, brand_id, multiplier')
      .single()

    setSaving(false)

    if (insertError || !data) {
      setError(insertError?.message ?? 'Error al crear override')
      return
    }

    onSaved({
      ...normalizePriceListOverride(data),
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-heading">Precio por producto</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 flex flex-col gap-3.5">
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="rounded-xl border border-edge/70 bg-surface px-3 py-2.5">
            <p className="text-xs text-subtle uppercase tracking-wide">Producto</p>
            <p className="text-sm font-semibold text-heading">{product.name}</p>
            <div className="flex items-baseline gap-3 mt-1">
              <p className="text-xs text-hint">Margen actual: +{((effectiveMultiplier - 1) * 100).toFixed(0)}%</p>
              {currentPrice !== null && (
                <p className="text-xs text-hint">Precio actual: <span className="font-medium text-body">{formatMoney(currentPrice)}</span></p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-label text-subtle">Nuevo margen de ganancia</label>
            <div className="relative">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={percentage}
                onChange={event => {
                  setPercentage(event.target.value)
                  setError(null)
                }}
                placeholder="Vaciar para eliminar"
                className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring pr-8"
              />
              {percentage.trim() !== '' && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-hint pointer-events-none">%</span>
              )}
            </div>
            {previewPrice !== null ? (
              <p className="text-caption">
                <span className="text-hint">Precio resultante: </span>
                <span className={`font-semibold ${priceChanged ? 'text-primary' : 'text-hint'}`}>
                  {formatMoney(previewPrice)}
                </span>
                {priceChanged && currentPrice !== null && (
                  <span className="text-hint ml-1">
                    ({previewPrice > currentPrice ? '+' : ''}{formatMoney(previewPrice - currentPrice)})
                  </span>
                )}
              </p>
            ) : (
              <p className="text-caption text-hint">10% = +10% sobre el costo · 60% = +60% sobre el costo</p>
            )}
          </div>

          <div className="pt-1 flex items-center justify-between gap-2.5">
            {(currentOverride ?? brandOverride) ? (
              <Button
                type="button"
                variant="destructive"
                className="h-9 px-5 rounded-lg text-sm"
                onClick={() => void handleReset()}
                disabled={saving}
              >
                Restablecer
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="cancel"
                className="h-9 px-5 rounded-xl text-sm"
                onClick={handleClose}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="h-9 px-5 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={saving}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
