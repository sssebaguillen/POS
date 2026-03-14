'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { PriceList } from '@/components/price-lists/types'

interface NewPriceListModalProps {
  open: boolean
  onClose: () => void
  businessId: string
  onCreated: (list: PriceList) => void
}

export default function NewPriceListModal({
  open,
  onClose,
  businessId,
  onCreated,
}: NewPriceListModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [multiplier, setMultiplier] = useState('1.00')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  function resetForm() {
    setName('')
    setDescription('')
    setMultiplier('1.00')
    setError(null)
  }

  function handleClose() {
    if (saving) return
    resetForm()
    onClose()
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }

    const parsedMultiplier = Number(multiplier)
    if (!multiplier.trim() || !Number.isFinite(parsedMultiplier) || parsedMultiplier <= 0) {
      setError('El multiplicador global debe ser un numero mayor a 0')
      return
    }

    setSaving(true)
    setError(null)

    const { data, error: insertError } = await supabase
      .from('price_lists')
      .insert({
        business_id: businessId,
        name: name.trim(),
        description: description.trim() || null,
        multiplier: parsedMultiplier,
      })
      .select('id, business_id, name, description, multiplier, is_default, created_at')
      .single()

    setSaving(false)

    if (insertError || !data) {
      setError(insertError?.message ?? 'Error al crear la lista de precios')
      return
    }

    onCreated({
      id: data.id,
      business_id: data.business_id,
      name: data.name,
      description: data.description,
      multiplier: Number(data.multiplier),
      is_default: data.is_default,
      created_at: data.created_at,
    })

    resetForm()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="bg-primary px-6 py-3.5 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Nueva lista de precios</h2>
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

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-subtle uppercase tracking-wide">
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
            <label className="text-[11px] font-semibold text-subtle uppercase tracking-wide">Descripcion</label>
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
            <label className="text-[11px] font-semibold text-subtle uppercase tracking-wide">
              Multiplicador global<span className="text-red-400 ml-0.5">*</span>
            </label>
            <Input
              type="number"
              min="0.0001"
              step="0.0001"
              value={multiplier}
              onChange={event => {
                setMultiplier(event.target.value)
                setError(null)
              }}
              className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
              required
            />
            <p className="text-[11px] text-hint">1.00 = precio base · 0.85 = -15% · 1.20 = +20%</p>
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
              {saving ? 'Creando...' : 'Crear lista'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
