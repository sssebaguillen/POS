'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import ConfirmModal from '@/components/shared/ConfirmModal'
import type { PriceList } from '@/lib/types'
import { normalizePriceList } from '@/lib/mappers'
import { translateDbError, ERR } from '@/lib/errors'

type ConfirmState = { title: string; message: string; onConfirm: () => void } | null

interface EditPriceListModalProps {
  open: boolean
  onClose: () => void
  list: PriceList
  businessId: string
  operatorId: string | null
  onSaved: (list: PriceList) => void
  onDeleted: (id: string) => void
}

export default function EditPriceListModal({
  open,
  onClose,
  list,
  businessId,
  operatorId,
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

  const supabase = useMemo(() => createClient(), [])

  function handleClose() {
    if (saving || deleting) return
    setError(null)
    onClose()
  }

  async function handleSave() {
    if (!name.trim()) {
      setError(ERR.PRL41)
      return
    }

    const parsedPercentage = Number(percentage)
    if (!percentage.trim() || !Number.isFinite(parsedPercentage) || parsedPercentage <= 0) {
      setError(ERR.PRL42)
      return
    }

    setSaving(true)
    setError(null)

    const newMultiplier = 1 + parsedPercentage / 100

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('update_price_list', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_price_list_id: list.id,
        p_name: name.trim(),
        p_description: description.trim() || null,
        p_multiplier: newMultiplier,
        p_overrides_upsert: null,
        p_overrides_delete_ids: null,
      })

      const result = rpcResult as { success: boolean; error?: string } | null

      if (rpcError || !result?.success) {
        setError(result?.error ?? ERR.PRL1)
        return
      }

      onSaved(
        normalizePriceList({
          id: list.id,
          business_id: list.business_id,
          name: name.trim(),
          description: description.trim() || null,
          multiplier: newMultiplier,
          created_at: list.created_at,
        })
      )
      onClose()
    } catch {
      setError(ERR.PRL1)
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    setPendingConfirm({
      title: `Eliminar lista "${list.name}"`,
      message: 'Esta acción no se puede deshacer.',
      onConfirm: async () => {
        setDeleting(true)
        setError(null)

        const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_price_list', {
          p_operator_id: operatorId,
          p_business_id: businessId,
          p_price_list_id: list.id,
        })

        setDeleting(false)

        const result = rpcResult as { success: boolean; error?: string } | null

        if (rpcError || !result?.success) {
          setError(result?.error ?? translateDbError(rpcError?.message ?? '', 'No se pudo eliminar la lista de precios.'))
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
              className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
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
                  }}
                  placeholder="Ej: 60"
                  className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring pr-8"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-hint pointer-events-none">%</span>
              </div>
              <p className="text-caption text-hint">10% = +10% sobre el costo · 60% = +60% sobre el costo</p>
            </div>

            <p className="rounded-lg border border-edge/70 bg-surface px-3 py-2 text-caption text-hint">
              El margen se aplica sobre el costo. Para precios distintos en productos puntuales, usá los ajustes por producto o marca en la tabla.
            </p>

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
