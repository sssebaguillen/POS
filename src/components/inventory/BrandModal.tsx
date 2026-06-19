'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, PencilSimple, Check } from '@phosphor-icons/react/dist/ssr'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import ConfirmModal from '@/components/shared/ConfirmModal'
import type { InventoryBrand } from '@/components/inventory/types'
import { translateDbError, ERR } from '@/lib/errors'

type ConfirmState = { title: string; message: string; onConfirm: () => void } | null

interface BrandModalProps {
  open: boolean
  onClose: () => void
  businessId: string
  operatorId: string | null
  stockWriteAllowed: boolean
  initialBrands: InventoryBrand[]
  onBrandsChanged: (brands: InventoryBrand[]) => void
}

export default function BrandModal({
  open,
  onClose,
  businessId,
  operatorId,
  stockWriteAllowed,
  initialBrands,
  onBrandsChanged,
}: BrandModalProps) {
  const [brands, setBrands] = useState<InventoryBrand[]>(initialBrands)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const filteredBrands = searchQuery.trim()
    ? brands.filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : brands

  async function refreshBrands() {
    const { data, error: fetchError } = await supabase
      .from('brands')
      .select('id, name')
      .eq('business_id', businessId)
      .order('name')

    if (fetchError || !data) {
      setError(ERR.INV6)
      return
    }

    setBrands(data)
    onBrandsChanged(data)
  }

  async function handleCreate() {
    if (!stockWriteAllowed) {
      setError(ERR.INV2)
      return
    }

    if (!name.trim()) {
      setError(ERR.INV41)
      return
    }

    setCreating(true)
    setError(null)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_brand_guarded', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_name: name.trim(),
      })

      const result = rpcResult as { success: boolean; error?: string } | null

      if (rpcError || !result?.success) {
        setError(result?.error ?? ERR.INV1)
        return
      }

      setName('')
      await refreshBrands()
    } catch {
      setError(ERR.INV1)
    } finally {
      setCreating(false)
    }
  }

  function startEdit(brand: InventoryBrand) {
    setEditingId(brand.id)
    setEditName(brand.name)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
  }

  async function handleUpdate(brandId: string) {
    if (!stockWriteAllowed) return

    if (!editName.trim()) {
      setError(ERR.INV41)
      return
    }

    setSaving(true)
    setError(null)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('update_brand', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_brand_id: brandId,
        p_name: editName.trim(),
      })

      const result = rpcResult as { success: boolean; error?: string } | null

      if (rpcError || !result?.success) {
        setError(result?.error ?? ERR.INV1)
        return
      }

      const updated = brands.map(b => b.id === brandId ? { ...b, name: editName.trim() } : b)
      setBrands(updated)
      onBrandsChanged(updated)
      setEditingId(null)
      setEditName('')
    } catch {
      setError(ERR.INV1)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(brand: InventoryBrand) {
    const { count, error: countError } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('brand_id', brand.id)

    const productCount = countError ? null : (count ?? 0)
    const impactLine = productCount === null
      ? 'No se pudo contar los productos afectados.'
      : productCount === 0
        ? 'No hay productos asignados a esta marca.'
        : productCount === 1
          ? '1 producto quedará sin marca.'
          : `${productCount} productos quedarán sin marca.`

    setPendingConfirm({
      title: `Eliminar marca "${brand.name}"`,
      message: `Esta acción es permanente y no se puede deshacer. ${impactLine} Las listas de precios asociadas también dejarán de aplicarse a esta marca.`,
      onConfirm: async () => {
        setDeletingId(brand.id)
        setError(null)

        try {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_brand', {
            p_operator_id: operatorId,
            p_business_id: businessId,
            p_brand_id: brand.id,
          })

          const result = rpcResult as { success: boolean; error?: string } | null

          if (rpcError || !result?.success) {
            setError(result?.error ?? translateDbError(rpcError?.message ?? '', ERR.INV1))
            return
          }

          await refreshBrands()
        } catch {
          setError(ERR.INV1)
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  function handleClose() {
    setError(null)
    setSearchQuery('')
    setEditingId(null)
    setEditName('')
    onClose()
  }

  return (
    <>
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false} aria-describedby={undefined}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <DialogTitle className="text-base font-semibold text-heading">Marcas</DialogTitle>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 flex flex-col gap-4">
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="rounded-xl border border-edge/70 overflow-hidden">
            <div className="px-3 py-2 border-b border-edge/50">
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar marca..."
                className="h-8 rounded-lg text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
              />
            </div>
            <div className="max-h-60 overflow-y-auto divide-y divide-edge/50">
              {filteredBrands.length === 0 ? (
                <div className="px-3 py-4 text-sm text-hint text-center">
                  {brands.length === 0 ? 'No hay marcas creadas.' : 'Sin resultados.'}
                </div>
              ) : (
                filteredBrands.map(brand => (
                  <div key={brand.id} className="px-3 py-2.5 flex items-center gap-2">
                    {editingId === brand.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={e => { setEditName(e.target.value); setError(null) }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void handleUpdate(brand.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          className="h-8 rounded-lg text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring flex-1"
                          autoFocus
                          disabled={saving}
                        />
                        <button
                          type="button"
                          onClick={() => void handleUpdate(brand.id)}
                          disabled={saving}
                          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-success disabled:opacity-50"
                          aria-label="Confirmar edición"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint disabled:opacity-50"
                          aria-label="Cancelar edición"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-medium text-heading flex-1">{brand.name}</span>
                        <button
                          type="button"
                          onClick={() => startEdit(brand)}
                          disabled={creating || deletingId !== null || !stockWriteAllowed || editingId !== null}
                          className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint disabled:opacity-30"
                          aria-label={`Editar ${brand.name}`}
                        >
                          <PencilSimple className="w-3.5 h-3.5" />
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDelete(brand)}
                          disabled={creating || deletingId !== null || !stockWriteAllowed || editingId !== null}
                        >
                          {deletingId === brand.id ? 'Eliminando...' : 'Eliminar'}
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge/70 p-3.5">
            <p className="text-label text-subtle mb-2.5">Nueva marca</p>
            {!stockWriteAllowed && (
              <p className="mb-2.5 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-sm text-warning">
                Sin permiso de inventario
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
                placeholder="Ej: Coca-Cola"
                required
              />
            </div>

            <div className="mt-3 flex items-center justify-end gap-2.5">
              <Button
                type="button"
                variant="cancel"
                size="lg"
                className="px-5"
                onClick={handleClose}
                disabled={creating || deletingId !== null}
              >
                Cerrar
              </Button>
              <Button
                type="button"
                size="lg"
                className="px-5"
                onClick={() => void handleCreate()}
                disabled={creating || deletingId !== null || !stockWriteAllowed}
              >
                {creating ? 'Creando...' : 'Crear marca'}
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
