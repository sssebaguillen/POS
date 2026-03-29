'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { InventoryCategory } from '@/components/stock/types'

interface CategoryModalProps {
  open: boolean
  onClose: () => void
  businessId: string
  operatorId: string | null
  stockWriteAllowed: boolean
  initialCategories: InventoryCategory[]
  onCategoriesChanged: (categories: InventoryCategory[]) => void
}

const DEFAULT_ICON = '📦'

export default function CategoryModal({
  open,
  onClose,
  businessId,
  operatorId,
  stockWriteAllowed,
  initialCategories,
  onCategoriesChanged,
}: CategoryModalProps) {
  const [categories, setCategories] = useState<InventoryCategory[]>(initialCategories)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  async function refreshCategories() {
    const { data, error: fetchError } = await supabase
      .from('categories')
      .select('id, name, icon')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('position')

    if (fetchError || !data) {
      setError(fetchError?.message ?? 'Error al actualizar categorías')
      return
    }

    const updatedCategories = data.map(category => ({
      id: category.id,
      name: category.name,
      icon: category.icon || DEFAULT_ICON,
    }))

    setCategories(updatedCategories)
    onCategoriesChanged(updatedCategories)
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()

    if (!stockWriteAllowed) {
      setError('Acceso denegado: Permisos de inventario insuficientes')
      return
    }

    if (!name.trim()) {
      setError('El nombre es obligatorio')
      return
    }

    setCreating(true)
    setError(null)

    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_category_guarded', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_name: name.trim(),
      p_icon: icon.trim() || DEFAULT_ICON,
    })

    const result = rpcResult as { success: boolean; error?: string } | null

    if (rpcError || !result?.success) {
      setError(result?.error ?? rpcError?.message ?? 'Error al crear la categoría')
      setCreating(false)
      return
    }

    setName('')
    setIcon(DEFAULT_ICON)
    await refreshCategories()
    setCreating(false)
  }

  async function handleDelete(categoryId: string) {
    setDeletingId(categoryId)
    setError(null)

    const { error: deleteError } = await supabase
      .from('categories')
      .delete()
      .eq('id', categoryId)
      .eq('business_id', businessId)

    if (deleteError) {
      setError(deleteError.message)
      setDeletingId(null)
      return
    }

    await refreshCategories()
    setDeletingId(null)
  }

  function handleClose() {
    setError(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        <div className="modal-header px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Categorías</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
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

          <div className="rounded-xl border border-edge/70 bg-surface overflow-hidden">
            <div className="max-h-60 overflow-y-auto divide-y divide-edge/50">
              {categories.length === 0 ? (
                <div className="px-3 py-4 text-sm text-hint text-center">No hay categorías creadas.</div>
              ) : (
                categories.map(category => (
                  <div key={category.id} className="px-3 py-2.5 flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-surface-alt border border-edge flex items-center justify-center text-base">
                      {category.icon || DEFAULT_ICON}
                    </span>
                    <span className="text-sm font-medium text-heading flex-1">{category.name}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(category.id)}
                      disabled={creating || deletingId !== null || !stockWriteAllowed}
                    >
                      {deletingId === category.id ? 'Eliminando...' : 'Eliminar'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <form onSubmit={handleCreate} className="rounded-xl border border-edge/70 bg-surface-alt p-3.5">
            <p className="text-label text-subtle mb-2.5">Nueva categoría</p>
            {!stockWriteAllowed && (
              <p className="mb-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                Sin permiso de inventario
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-2.5">
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
                  placeholder="Ej: Panificados"
                  className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-label text-subtle">Icono</label>
                <Input
                  value={icon}
                  onChange={event => {
                    setIcon(event.target.value)
                    setError(null)
                  }}
                  placeholder={DEFAULT_ICON}
                  className="h-9 rounded-xl text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                />
              </div>
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
                disabled={creating || deletingId !== null || !stockWriteAllowed}
              >
                {creating ? 'Creando...' : 'Crear categoría'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
