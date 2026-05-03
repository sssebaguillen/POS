'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceList } from '@/lib/types'

interface NewPriceListModalProps {
  open: boolean
  onClose: () => void
  businessId: string
  hasDefault: boolean
  products: { id: string; name: string; price: number; cost: number }[]
  onCreated: (list: PriceList, newOverrides: { price_list_id: string; product_id: string; brand_id: null; multiplier: number }[]) => void
}

export default function NewPriceListModal({
  open,
  onClose,
  businessId,
  hasDefault,
  products,
  onCreated,
}: NewPriceListModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [percentage, setPercentage] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [overwriteManual, setOverwriteManual] = useState<boolean | null>(null)
  const [accordionOpen, setAccordionOpen] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const affectedProducts = useMemo(() => {
    const parsedPercentage = Number(percentage)
    if (!percentage.trim() || !Number.isFinite(parsedPercentage) || parsedPercentage <= 0) return []
    const newMultiplier = 1 + parsedPercentage / 100
    return products.filter(p =>
      p.cost > 0 && p.price > 0 &&
      Math.abs(p.price - p.cost * newMultiplier) > 0.01
    )
  }, [products, percentage])

  function resetForm() {
    setName('')
    setDescription('')
    setPercentage('0')
    setError(null)
    setOverwriteManual(null)
    setAccordionOpen(false)
  }

  function handleClose() {
    if (saving) return
    resetForm()
    onClose()
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }

    const parsedPercentage = Number(percentage)
    if (!percentage.trim() || !Number.isFinite(parsedPercentage) || parsedPercentage <= 0) {
      setError('El margen debe ser un número mayor a 0.')
      return
    }

    if (affectedProducts.length > 0 && overwriteManual === null) {
      setError('Indicá qué hacer con los productos que no coinciden con este margen')
      return
    }

    setSaving(true)
    setError(null)

    const newMultiplier = 1 + parsedPercentage / 100

    const { data, error: insertError } = await supabase
      .from('price_lists')
      .insert({
        business_id: businessId,
        name: name.trim(),
        description: description.trim() || null,
        multiplier: newMultiplier,
        is_default: !hasDefault,
      })
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .single()

    setSaving(false)

    if (insertError || !data) {
      setError(insertError?.message ?? 'Error al crear la lista de precios')
      return
    }

    let createdOverrides: { price_list_id: string; product_id: string; brand_id: null; multiplier: number }[] = []

    // Respetar precios manuales: crear overrides para los productos que difieren
    if (overwriteManual === false && affectedProducts.length > 0) {
      const overridesToCreate = affectedProducts.map(p => ({
        price_list_id: data.id,
        product_id: p.id,
        brand_id: null as null,
        multiplier: p.price / p.cost,
      }))

      const { data: insertedOverrides } = await supabase
        .from('price_list_overrides')
        .insert(overridesToCreate)
        .select('id, price_list_id, product_id, brand_id, multiplier')

      createdOverrides = (insertedOverrides ?? []).map(o => ({
        price_list_id: o.price_list_id,
        product_id: o.product_id,
        brand_id: null,
        multiplier: Number(o.multiplier),
      }))
    }

    onCreated(
      {
        id: data.id,
        business_id: data.business_id,
        name: data.name,
        description: data.description,
        multiplier: Number(data.multiplier),
        is_default: data.is_default,
        created_at: data.created_at,
      },
      createdOverrides
    )

    resetForm()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h2 className="text-base font-semibold text-heading">Nueva lista de precios</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-hint hover:text-body transition-colors p-0.5"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3.5 flex-1 overflow-y-auto">
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-label text-subtle">
              Nombre<span className="text-red-400 ml-0.5">*</span>
            </label>
            <Input
              value={name}
              onChange={event => {
                setName(event.target.value)
                setError(null)
              }}
              placeholder="Ej: Mayorista"
              className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
              autoFocus
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-label text-subtle">Descripción</label>
            <Input
              value={description}
              onChange={event => {
                setDescription(event.target.value)
                setError(null)
              }}
              placeholder="Opcional"
              className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-label text-subtle">
              Margen de ganancia<span className="text-red-400 ml-0.5">*</span>
            </label>
            <div className="relative">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={percentage}
                onChange={event => {
                  setPercentage(event.target.value)
                  setError(null)
                  setOverwriteManual(null)
                }}
                placeholder="Ej: 60"
                className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring pr-8"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-hint pointer-events-none">%</span>
            </div>
            <p className="text-caption text-hint">10% = +10% sobre el costo · 60% = +60% sobre el costo</p>
          </div>

          {affectedProducts.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2.5 flex flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  <span className="font-semibold">
                    {affectedProducts.length} {affectedProducts.length === 1 ? 'producto tiene' : 'productos tienen'} un precio de venta que no coincide con este margen.
                  </span>
                  {' '}¿Qué querés hacer con {affectedProducts.length === 1 ? 'ese producto' : 'ellos'}?
                </p>

                <button
                  type="button"
                  onClick={() => setAccordionOpen(prev => !prev)}
                  className="text-left text-xs text-amber-600 dark:text-amber-400 underline underline-offset-2 w-fit"
                >
                  {accordionOpen ? 'Ocultar productos ▴' : 'Ver productos afectados ▾'}
                </button>

                {accordionOpen && (
                  <div className="mt-1 rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">
                    <div className="max-h-40 overflow-y-auto divide-y divide-amber-100 dark:divide-amber-900">
                      {affectedProducts.map(p => {
                        const currentMargin = Math.round((p.price / p.cost - 1) * 100)
                        return (
                          <div key={p.id} className="flex items-center justify-between px-2.5 py-1.5 bg-white/60 dark:bg-amber-950/20">
                            <span className="text-xs text-amber-800 dark:text-amber-300 truncate mr-2">{p.name}</span>
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                              {currentMargin}% margen actual
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setOverwriteManual(true); setError(null) }}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    overwriteManual === true
                      ? 'bg-amber-600 border-amber-600 text-white'
                      : 'border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/40'
                  }`}
                >
                  Sobreescribir con el margen de la lista
                </button>
                <button
                  type="button"
                  onClick={() => { setOverwriteManual(false); setError(null) }}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    overwriteManual === false
                      ? 'bg-amber-600 border-amber-600 text-white'
                      : 'border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/40'
                  }`}
                >
                  Respetar precios actuales
                </button>
              </div>
            </div>
          )}

          <div className="pt-1 flex items-center justify-end gap-2.5">
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
              {saving ? 'Creando...' : 'Crear lista'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
