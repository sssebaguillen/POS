'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Pencil, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { InventoryCategory } from '@/components/inventory/types'
import { translateDbError } from '@/lib/errors'

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editIcon, setEditIcon] = useState(DEFAULT_ICON)
  const [saving, setSaving] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const filteredCategories = searchQuery.trim()
    ? categories.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : categories

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

  async function handleCreate() {
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

  function startEdit(category: InventoryCategory) {
    setEditingId(category.id)
    setEditName(category.name)
    setEditIcon(category.icon || DEFAULT_ICON)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
    setEditIcon(DEFAULT_ICON)
  }

  async function handleUpdate(categoryId: string) {
    if (!stockWriteAllowed) return

    if (!editName.trim()) {
      setError('El nombre es obligatorio')
      return
    }

    setSaving(true)
    setError(null)

    const { data: rpcResult, error: rpcError } = await supabase.rpc('update_category', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_category_id: categoryId,
      p_name: editName.trim(),
      p_icon: editIcon.trim() || DEFAULT_ICON,
    })

    const result = rpcResult as { success: boolean; error?: string } | null

    if (rpcError || !result?.success) {
      setError(result?.error ?? rpcError?.message ?? 'Error al actualizar la categoría')
      setSaving(false)
      return
    }

    const updated = categories.map(c =>
      c.id === categoryId ? { ...c, name: editName.trim(), icon: editIcon.trim() || DEFAULT_ICON } : c
    )
    setCategories(updated)
    onCategoriesChanged(updated)
    setEditingId(null)
    setEditName('')
    setEditIcon(DEFAULT_ICON)
    setSaving(false)
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
      setError(translateDbError(deleteError.message, 'No se pudo eliminar la categoría.'))
      setDeletingId(null)
      return
    }

    await refreshCategories()
    setDeletingId(null)
  }

  function handleClose() {
    setError(null)
    setSearchQuery('')
    setEditingId(null)
    setEditName('')
    setEditIcon(DEFAULT_ICON)
    onClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 gap-0 overflow-hidden bg-card" showCloseButton={false} aria-describedby={undefined}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <DialogTitle className="text-base font-semibold text-heading">Categorías</DialogTitle>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
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
                placeholder="Buscar categoría..."
                className="h-8 rounded-lg text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
              />
            </div>
            <div className="max-h-60 overflow-y-auto divide-y divide-edge/50">
              {filteredCategories.length === 0 ? (
                <div className="px-3 py-4 text-sm text-hint text-center">
                  {categories.length === 0 ? 'No hay categorías creadas.' : 'Sin resultados.'}
                </div>
              ) : (
                filteredCategories.map(category => (
                  <div key={category.id} className="px-3 py-2.5 flex items-center gap-2">
                    {editingId === category.id ? (
                      <>
                        <Input
                          value={editIcon}
                          onChange={e => setEditIcon(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void handleUpdate(category.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          className="h-8 w-14 rounded-lg text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring text-center shrink-0"
                          disabled={saving}
                          aria-label="Icono"
                        />
                        <Input
                          value={editName}
                          onChange={e => { setEditName(e.target.value); setError(null) }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void handleUpdate(category.id)
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          className="h-8 rounded-lg text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring flex-1"
                          autoFocus
                          disabled={saving}
                        />
                        <button
                          type="button"
                          onClick={() => void handleUpdate(category.id)}
                          disabled={saving}
                          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-emerald-600 disabled:opacity-50"
                          aria-label="Confirmar edición"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint disabled:opacity-50"
                          aria-label="Cancelar edición"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="w-8 h-8 rounded-lg bg-surface-alt border border-edge flex items-center justify-center text-base shrink-0">
                          {category.icon || DEFAULT_ICON}
                        </span>
                        <span className="text-sm font-medium text-heading flex-1">{category.name}</span>
                        <button
                          type="button"
                          onClick={() => startEdit(category)}
                          disabled={creating || deletingId !== null || !stockWriteAllowed || editingId !== null}
                          className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint disabled:opacity-30"
                          aria-label={`Editar ${category.name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => setConfirmDeleteId(category.id)}
                          disabled={creating || deletingId !== null || !stockWriteAllowed || editingId !== null}
                        >
                          {deletingId === category.id ? 'Eliminando...' : 'Eliminar'}
                        </Button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge/70 p-3.5">
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
                className="h-9 px-5 rounded-xl text-sm"
                onClick={handleClose}
                disabled={creating || deletingId !== null}
              >
                Cerrar
              </Button>
              <Button
                type="button"
                className="h-9 px-5 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={() => void handleCreate()}
                disabled={creating || deletingId !== null || !stockWriteAllowed}
              >
                {creating ? 'Creando...' : 'Crear categoría'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={confirmDeleteId !== null} onOpenChange={open => { if (!open) setConfirmDeleteId(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar categoría?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción eliminará la categoría permanentemente y no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (confirmDeleteId) void handleDelete(confirmDeleteId) }}>
            Eliminar categoría
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
