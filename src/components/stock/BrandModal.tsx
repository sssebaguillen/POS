'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { InventoryBrand } from '@/components/stock/types'

interface BrandModalProps {
  open: boolean
  onClose: () => void
  businessId: string
  initialBrands: InventoryBrand[]
  onBrandsChanged: (brands: InventoryBrand[]) => void
}

export default function BrandModal({
  open,
  onClose,
  businessId,
  initialBrands,
  onBrandsChanged,
}: BrandModalProps) {
  const [brands, setBrands] = useState<InventoryBrand[]>(initialBrands)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) return
    setBrands(initialBrands)
    setName('')
    setError(null)
  }, [open, initialBrands])

  async function refreshBrands() {
    const { data, error: fetchError } = await supabase
      .from('brands')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name')

    if (fetchError || !data) {
      setError(fetchError?.message ?? 'Error al actualizar marcas')
      return
    }

    setBrands(data)
    onBrandsChanged(data)
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()

    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }

    setCreating(true)
    setError(null)

    const { error: insertError } = await supabase
      .from('brands')
      .insert({
        business_id: businessId,
        name: name.trim(),
      })

    if (insertError) {
      setError(insertError.message)
      setCreating(false)
      return
    }

    setName('')
    await refreshBrands()
    setCreating(false)
  }

  async function handleDelete(brand: InventoryBrand) {
    const confirmed = window.confirm('Esto quitara la marca de todos los productos y listas de precios asociadas.')
    if (!confirmed) return

    setDeletingId(brand.id)
    setError(null)

    const { error: deleteError } = await supabase
      .from('brands')
      .delete()
      .eq('id', brand.id)
      .eq('business_id', businessId)

    if (deleteError) {
      setError(deleteError.message)
      setDeletingId(null)
      return
    }

    await refreshBrands()
    setDeletingId(null)
  }

  function handleClose() {
    setError(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="bg-primary px-6 py-3.5 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Marcas</h2>
          <button
            type="button"
            onClick={handleClose}
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            aria-label="Cerrar modal"
          >
            <span className="text-white text-sm">X</span>
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4">
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="rounded-xl border border-edge/70 bg-surface overflow-hidden">
            <div className="max-h-60 overflow-y-auto divide-y divide-edge/50">
              {brands.length === 0 ? (
                <div className="px-3 py-4 text-sm text-hint text-center">No hay marcas creadas.</div>
              ) : (
                brands.map(brand => (
                  <div key={brand.id} className="px-3 py-2.5 flex items-center gap-3">
                    <span className="text-sm font-medium text-heading flex-1">{brand.name}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(brand)}
                      disabled={creating || deletingId !== null}
                    >
                      {deletingId === brand.id ? 'Eliminando...' : 'Eliminar'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <form onSubmit={handleCreate} className="rounded-xl border border-edge/70 bg-surface-alt p-3.5">
            <p className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-2.5">Nueva marca</p>
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
                placeholder="Ej: Coca-Cola"
                className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                required
              />
            </div>

            <div className="mt-3 flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="cancel"
                size="sm"
                className="rounded-lg text-xs"
                onClick={handleClose}
                disabled={creating || deletingId !== null}
              >
                Cerrar
              </Button>
              <Button
                type="submit"
                size="sm"
                className="rounded-lg text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={creating || deletingId !== null}
              >
                {creating ? 'Creando...' : 'Crear marca'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
