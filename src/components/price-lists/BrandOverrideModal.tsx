'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceList, PriceListOverride } from '@/components/price-lists/types'

interface BrandOverrideModalProps {
  open: boolean
  onClose: () => void
  brandId: string
  brandName: string
  priceListId: string
  defaultPriceList: PriceList
  existingOverride: PriceListOverride | null
  onSaved: (override: PriceListOverride) => void
  onDeleted: () => void
}

export default function BrandOverrideModal({
  open,
  onClose,
  brandId,
  brandName,
  priceListId,
  defaultPriceList,
  existingOverride,
  onSaved,
  onDeleted,
}: BrandOverrideModalProps) {
  const [percentage, setPercentage] = useState(
    existingOverride
      ? ((existingOverride.multiplier - 1) * 100).toFixed(2)
      : ((defaultPriceList.multiplier - 1) * 100).toFixed(2)
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) return
    setPercentage(
      existingOverride
        ? ((existingOverride.multiplier - 1) * 100).toFixed(2)
        : ((defaultPriceList.multiplier - 1) * 100).toFixed(2)
    )
    setError(null)
  }, [open, existingOverride, defaultPriceList])

  function handleClose() {
    if (saving) return
    onClose()
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const parsedPercentage = Number(percentage)
    if (!Number.isFinite(parsedPercentage) || parsedPercentage <= 0) {
      return
    }

    setSaving(true)

    const { data, error } = await supabase
      .from('price_list_overrides')
      .upsert(
        {
          price_list_id: priceListId,
          product_id: null,
          brand_id: brandId,
          multiplier: 1 + parsedPercentage / 100,
        },
        { onConflict: 'price_list_id,brand_id' }
      )
      .select('id, price_list_id, product_id, brand_id, multiplier')
      .single()

    if (error || !data) {
      setError(error?.message ?? 'Error al guardar el override de marca')
      setSaving(false)
      return
    }

    onSaved({
      id: data.id,
      price_list_id: data.price_list_id,
      product_id: data.product_id,
      brand_id: data.brand_id,
      multiplier: Number(data.multiplier),
    })

    setSaving(false)
    onClose()
  }

  async function handleDelete() {
    if (!existingOverride) return

    setSaving(true)

    const { error } = await supabase
      .from('price_list_overrides')
      .delete()
      .eq('id', existingOverride.id)

    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }

    onDeleted()
    setSaving(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="bg-primary px-6 py-3.5 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Override por marca</h2>
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
            <p className="text-xs text-subtle uppercase tracking-wide">Marca</p>
            <p className="text-sm font-semibold text-heading">{brandName}</p>
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
                }}
                placeholder="Ej: 60"
                className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-hint pointer-events-none">%</span>
            </div>
            <p className="text-[11px] text-hint">10% = +10% sobre el costo · 60% = +60% sobre el costo</p>
          </div>

          <div className="pt-1 flex items-center justify-between gap-2.5">
            {existingOverride ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="rounded-lg text-xs"
                onClick={() => void handleDelete()}
                disabled={saving}
              >
                Eliminar override
              </Button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2.5">
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
