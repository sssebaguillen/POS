'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceListOverride, PriceListProduct } from '@/components/price-lists/types'

interface ProductOverrideModalProps {
  open: boolean
  onClose: () => void
  priceListId: string
  product: PriceListProduct
  currentOverride: PriceListOverride | null
  effectiveMultiplier: number
  onSaved: (override: PriceListOverride | null) => void
}

export default function ProductOverrideModal({
  open,
  onClose,
  priceListId,
  product,
  currentOverride,
  effectiveMultiplier,
  onSaved,
}: ProductOverrideModalProps) {
  const [percentage, setPercentage] = useState(currentOverride ? ((currentOverride.multiplier - 1) * 100).toFixed(2) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) return
    setPercentage(currentOverride ? ((currentOverride.multiplier - 1) * 100).toFixed(2) : '')
    setError(null)
  }, [open, currentOverride])

  function handleClose() {
    if (saving) return
    setError(null)
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
      setError('El margen debe ser un numero mayor a 0')
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
        id: data.id,
        price_list_id: data.price_list_id,
        product_id: data.product_id,
        brand_id: data.brand_id,
        multiplier: Number(data.multiplier),
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
      id: data.id,
      price_list_id: data.price_list_id,
      product_id: data.product_id,
      brand_id: data.brand_id,
      multiplier: Number(data.multiplier),
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="bg-primary px-6 py-3.5 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Override por producto</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            aria-label="Cerrar modal"
          >
            <span className="text-white text-sm">X</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 flex flex-col gap-3.5">
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="rounded-xl border border-edge/70 bg-surface-alt px-3 py-2.5">
            <p className="text-xs text-subtle uppercase tracking-wide">Producto</p>
            <p className="text-sm font-semibold text-heading">{product.name}</p>
            <p className="text-xs text-hint mt-1">Margen efectivo actual: +{((effectiveMultiplier - 1) * 100).toFixed(0)}%</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-subtle uppercase tracking-wide">Margen de ganancia</label>
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
                placeholder="Vaciar para eliminar override"
                className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring pr-8"
              />
              {percentage.trim() !== '' && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-hint pointer-events-none">%</span>
              )}
            </div>
            <p className="text-[11px] text-hint">10% = +10% sobre el costo · 60% = +60% sobre el costo</p>
          </div>

          <div className="pt-1 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="cancel"
              size="sm"
              className="rounded-lg text-xs"
              onClick={handleClose}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={saving}
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
