'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from '@phosphor-icons/react/dist/ssr'
import { Dialog, DialogContent, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import RoundingField from '@/components/price-lists/RoundingField'
import { normalizePriceList } from '@/lib/mappers'
import type { PriceList } from '@/lib/types'
import { ERR } from '@/lib/errors'

interface NewPriceListModalProps {
  open: boolean
  onClose: () => void
  businessId: string
  operatorId: string | null
  onCreated: (list: PriceList) => void
}

export default function NewPriceListModal({
  open,
  onClose,
  businessId,
  operatorId,
  onCreated,
}: NewPriceListModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [percentage, setPercentage] = useState('0')
  const [roundingStep, setRoundingStep] = useState<number | null>(null)
  const [roundingUp, setRoundingUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  function resetForm() {
    setName('')
    setDescription('')
    setPercentage('0')
    setRoundingStep(null)
    setRoundingUp(false)
    setError(null)
  }

  function handleClose() {
    if (saving) return
    resetForm()
    onClose()
  }

  async function handleSubmit() {
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
      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_price_list', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_name: name.trim(),
        p_description: description.trim() || null,
        p_multiplier: newMultiplier,
        p_overrides: null,
        p_round_step: roundingStep,
        p_round_up: roundingUp,
      })

      type CreateResult = {
        success: boolean
        error?: string
        list?: {
          id: string
          business_id: string
          name: string
          description: string | null
          multiplier: number | string
          created_at: string
          rounding_step: number | string | null
          rounding_up: boolean | null
        }
      }

      const result = rpcResult as CreateResult | null

      if (rpcError || !result?.success || !result.list) {
        setError(result?.error ?? ERR.PRL1)
        return
      }

      onCreated(normalizePriceList(result.list))

      resetForm()
      onClose()
    } catch {
      setError(ERR.PRL1)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()} modal={false}>
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-foreground/40 dark:bg-black/60 backdrop-blur-sm" />
      </DialogPortal>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false}>
        <VisuallyHidden><DialogTitle>Nueva lista de precios</DialogTitle></VisuallyHidden>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h2 className="text-base font-semibold text-heading">Nueva lista de precios</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-hint hover:text-body transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-95 p-0.5"
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
              Nombre<span className="text-destructive ml-0.5">*</span>
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
              Margen de ganancia<span className="text-destructive ml-0.5">*</span>
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

          <RoundingField
            step={roundingStep}
            up={roundingUp}
            onChange={(step, up) => { setRoundingStep(step); setRoundingUp(up) }}
          />

          <p className="rounded-lg border border-edge/70 bg-surface px-3 py-2 text-caption text-hint">
            Esta lista calcula precios desde el costo y <span className="text-body font-medium">no cambia el precio base</span> de tus productos. Se aplica al elegirla en el POS o al exportarla. Después podés ajustar productos puntuales desde la tabla.
          </p>

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
