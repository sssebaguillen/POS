'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceList } from '@/components/price-lists/types'

interface EditPriceListModalProps {
  open: boolean
  onClose: () => void
  list: PriceList
  onSaved: (list: PriceList) => void
  onDeleted: (id: string) => void
}

export default function EditPriceListModal({
  open,
  onClose,
  list,
  onSaved,
  onDeleted,
}: EditPriceListModalProps) {
  const [name, setName] = useState(list.name)
  const [description, setDescription] = useState(list.description ?? '')
  const [percentage, setPercentage] = useState(((list.multiplier - 1) * 100).toFixed(2))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) return
    setName(list.name)
    setDescription(list.description ?? '')
    setPercentage(((list.multiplier - 1) * 100).toFixed(2))
    setError(null)
  }, [open, list])

  function handleClose() {
    if (saving || deleting) return
    setError(null)
    onClose()
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()

    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }

    const parsedPercentage = Number(percentage)
    if (!percentage.trim() || !Number.isFinite(parsedPercentage) || parsedPercentage <= 0) {
      setError('El margen debe ser un numero mayor a 0')
      return
    }

    setSaving(true)
    setError(null)

    const { data, error: updateError } = await supabase
      .from('price_lists')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        multiplier: 1 + parsedPercentage / 100,
      })
      .eq('id', list.id)
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .single()

    setSaving(false)

    if (updateError || !data) {
      setError(updateError?.message ?? 'Error al guardar la lista')
      return
    }

    onSaved({
      id: data.id,
      business_id: data.business_id,
      name: data.name,
      description: data.description,
      multiplier: Number(data.multiplier),
      is_default: data.is_default,
      created_at: data.created_at,
    })

    onClose()
  }

  async function handleDelete() {
    const confirmed = window.confirm(`Eliminar lista \"${list.name}\"? Esta accion no se puede deshacer.`)
    if (!confirmed) return

    setDeleting(true)
    setError(null)

    const { error: deleteError } = await supabase
      .from('price_lists')
      .delete()
      .eq('id', list.id)

    setDeleting(false)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    onDeleted(list.id)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="modal-header px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Editar lista de precios</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="px-6 py-4 flex flex-col gap-3.5">
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
            <label className="text-label text-subtle">Descripcion</label>
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

          <div className="pt-1 flex items-center justify-between gap-2.5">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-lg text-xs"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {deleting ? 'Eliminando...' : 'Eliminar lista'}
            </Button>

            <div className="flex items-center gap-2.5">
              <Button
                type="button"
                variant="cancel"
                size="sm"
                className="rounded-lg text-xs"
                onClick={handleClose}
                disabled={saving || deleting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={saving || deleting}
              >
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
