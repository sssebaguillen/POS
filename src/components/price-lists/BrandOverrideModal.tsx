'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import type { PriceList, PriceListOverride } from '@/lib/types'
import { normalizePriceListOverride } from '@/lib/mappers'

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

  function handleClose() {
    if (saving) return
    onClose()
  }

  async function handleSubmit() {
    const parsedPercentage = Number(percentage)
    if (!Number.isFinite(parsedPercentage) || parsedPercentage <= 0) {
      setError('El margen debe ser un número mayor a 0.')
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
      setError('No se pudo guardar el precio por marca.')
      setSaving(false)
      return
    }

    onSaved({
      ...normalizePriceListOverride(data),
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
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false}>
        <VisuallyHidden><DialogTitle>Precio por marca</DialogTitle></VisuallyHidden>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-heading">Precio por marca</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-3.5">
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="rounded-xl border border-edge/70 bg-surface px-3 py-2.5">
            <p className="text-xs text-subtle uppercase tracking-wide">Marca</p>
            <p className="text-sm font-semibold text-heading">{brandName}</p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-label text-subtle">Margen de ganancia</label>
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
            <p className="text-caption text-hint">10% = +10% sobre el costo · 60% = +60% sobre el costo</p>
          </div>

          <div className="pt-1 flex items-center justify-between gap-2.5">
            {existingOverride ? (
              <Button
                type="button"
                variant="destructive"
                className="h-9 px-5 rounded-lg text-sm"
                onClick={() => void handleDelete()}
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
                type="button"
                onClick={() => void handleSubmit()}
                className="h-9 px-5 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={saving}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
