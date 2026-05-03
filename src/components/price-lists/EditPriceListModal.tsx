'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import ConfirmModal from '@/components/shared/ConfirmModal'
import type { PriceList, PriceListOverride } from '@/lib/types'
import { normalizePriceList } from '@/lib/mappers'
import { translateDbError } from '@/lib/errors'

type ConfirmState = { title: string; message: string; onConfirm: () => void } | null

interface EditPriceListModalProps {
  open: boolean
  onClose: () => void
  list: PriceList
  products: { id: string; name: string; price: number; cost: number }[]
  existingOverrides: { id: string; product_id: string | null; multiplier: number }[]
  onSaved: (list: PriceList, upsertedOverrides: PriceListOverride[], deletedOverrideIds: string[]) => void
  onDeleted: (id: string) => void
}

export default function EditPriceListModal({
  open,
  onClose,
  list,
  products,
  existingOverrides,
  onSaved,
  onDeleted,
}: EditPriceListModalProps) {
  const [name, setName] = useState(list.name)
  const [description, setDescription] = useState(list.description ?? '')
  const [percentage, setPercentage] = useState(((list.multiplier - 1) * 100).toFixed(2))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState>(null)
  const [overwriteManual, setOverwriteManual] = useState<boolean | null>(null)
  const [accordionOpen, setAccordionOpen] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  // Productos cuyo precio difiere del nuevo multiplier y no tienen override manual
  const affectedProducts = useMemo(() => {
    const parsedPercentage = Number(percentage)
    if (!percentage.trim() || !Number.isFinite(parsedPercentage) || parsedPercentage <= 0) return []
    const newMultiplier = 1 + parsedPercentage / 100
    const oldMultiplier = list.multiplier
    if (Math.abs(newMultiplier - oldMultiplier) <= 0.0001) return []

    return products.filter(p => {
      if (p.cost <= 0 || p.price <= 0) return false
      const existing = existingOverrides.find(o => o.product_id === p.id)
      // Override manual del usuario (distinto del multiplier anterior de la lista) → no afectar
      if (existing && Math.abs(existing.multiplier - oldMultiplier) > 0.0001) return false
      // Si el precio ya coincide con el nuevo multiplier → no necesita nada
      if (Math.abs(p.price - p.cost * newMultiplier) <= 0.01) return false
      return true
    })
  }, [products, percentage, list.multiplier, existingOverrides])

  function handleClose() {
    if (saving || deleting) return
    setError(null)
    setOverwriteManual(null)
    setAccordionOpen(false)
    onClose()
  }

  async function handleSave() {
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

    const { data, error: updateError } = await supabase
      .from('price_lists')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        multiplier: newMultiplier,
      })
      .eq('id', list.id)
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .single()

    if (updateError || !data) {
      setSaving(false)
      setError(updateError?.message ?? 'Error al guardar la lista')
      return
    }

    const oldMultiplier = list.multiplier
    const multiplierChanged = Math.abs(newMultiplier - oldMultiplier) > 0.0001
    const upsertedOverrides: PriceListOverride[] = []
    const deletedOverrideIds: string[] = []

    if (multiplierChanged && affectedProducts.length > 0) {
      if (overwriteManual === false) {
        // Respetar precios manuales: crear/actualizar overrides para que el precio no cambie
        const toUpsert = affectedProducts.map(p => ({
          price_list_id: list.id,
          product_id: p.id,
          brand_id: null as null,
          multiplier: p.price / p.cost,
        }))

        const { data: upserted } = await supabase
          .from('price_list_overrides')
          .upsert(toUpsert, { onConflict: 'price_list_id,product_id' })
          .select('id, price_list_id, product_id, brand_id, multiplier')

        for (const o of upserted ?? []) {
          upsertedOverrides.push({
            id: o.id,
            price_list_id: o.price_list_id,
            product_id: o.product_id,
            brand_id: o.brand_id,
            multiplier: Number(o.multiplier),
          })
        }
      } else {
        // Sobreescribir: eliminar overrides automáticos (los que coincidían con el multiplier anterior)
        const autoOverrides = existingOverrides.filter(o =>
          o.product_id !== null &&
          Math.abs(o.multiplier - oldMultiplier) <= 0.0001
        )
        if (autoOverrides.length > 0) {
          const ids = autoOverrides.map(o => o.id)
          await supabase.from('price_list_overrides').delete().in('id', ids)
          deletedOverrideIds.push(...ids)
        }
      }
    }

    setSaving(false)
    setOverwriteManual(null)
    onSaved({ ...normalizePriceList(data) }, upsertedOverrides, deletedOverrideIds)
    onClose()
  }

  function handleDelete() {
    setPendingConfirm({
      title: `Eliminar lista "${list.name}"`,
      message: 'Esta acción no se puede deshacer.',
      onConfirm: async () => {
        setDeleting(true)
        setError(null)

        const { error: deleteError } = await supabase
          .from('price_lists')
          .delete()
          .eq('id', list.id)

        setDeleting(false)

        if (deleteError) {
          setError(translateDbError(deleteError.message, 'No se pudo eliminar la lista de precios.'))
          return
        }

        onDeleted(list.id)
        onClose()
      },
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
        <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false}>
          <VisuallyHidden><DialogTitle>Editar lista de precios</DialogTitle></VisuallyHidden>
          <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
            <h2 className="text-base font-semibold text-heading">Editar lista de precios</h2>
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

            <div className="pt-1 flex items-center justify-between gap-2.5">
              <Button
                type="button"
                variant="destructive"
                className="h-9 px-5 rounded-lg text-sm"
                onClick={handleDelete}
                disabled={saving || deleting}
              >
                {deleting ? 'Eliminando...' : 'Eliminar lista'}
              </Button>

              <div className="flex items-center gap-2.5">
                <Button
                  type="button"
                  variant="cancel"
                  className="h-9 px-5 rounded-xl text-sm"
                  onClick={handleClose}
                  disabled={saving || deleting}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  className="h-9 px-5 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
                  disabled={saving || deleting}
                >
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null) }}
        onCancel={() => setPendingConfirm(null)}
      />
    </>
  )
}
