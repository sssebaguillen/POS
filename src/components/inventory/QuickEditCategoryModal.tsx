'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { InventoryCategory, InventoryProduct } from '@/components/inventory/types'
import { translateDbError } from '@/lib/errors'
import CategoryIconPreview from '@/components/inventory/CategoryIconPreview'
import IconPickerPanel, { CATEGORY_ICONS } from '@/components/inventory/IconPickerPanel'

interface QuickEditCategoryModalProps {
  open: boolean
  product: InventoryProduct | null
  categories: InventoryCategory[]
  businessId: string
  operatorId: string | null
  onSaved: (productId: string, categoryId: string | null, newCategory?: InventoryCategory) => void
  onClose: () => void
}

type QuickModalView = 'main' | 'picker'

export default function QuickEditCategoryModal({ open, product, categories, businessId, operatorId, onSaved, onClose }: QuickEditCategoryModalProps) {
  const [view, setView] = useState<QuickModalView>('main')
  const [selectedId, setSelectedId] = useState<string>(product?.category_id ?? '')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('Tag')
  const [newIconColor, setNewIconColor] = useState('#7a3e10')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!open) setView('main')
  }, [open])

  async function handleSave() {
    if (!product) return
    setSaving(true)
    setError(null)

    if (creating) {
      if (!newName.trim()) { setError('El nombre es obligatorio'); setSaving(false); return }
      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_category_guarded', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_name: newName.trim(),
        p_icon: newIcon.trim() || 'Tag',
        p_icon_color: newIconColor,
      })
      const result = rpcResult as { success: boolean; id?: string; error?: string } | null
      if (rpcError || !result?.success) {
        setError(result?.error ?? translateDbError(rpcError?.message ?? '', 'Error al crear la categoría'))
        setSaving(false)
        return
      }
      const { data: fetched, error: fetchError } = await supabase
        .from('categories')
        .select('id, name, icon, icon_color')
        .eq('business_id', businessId)
        .eq('name', newName.trim())
        .limit(1)
        .single()
      if (fetchError || !fetched) { setError(translateDbError(fetchError?.message ?? '', 'Error al obtener la categoría creada')); setSaving(false); return }

      const { error: updateError } = await supabase
        .from('products')
        .update({ category_id: fetched.id })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(translateDbError(updateError.message, 'No se pudo guardar el cambio.')); setSaving(false); return }
      onSaved(product.id, fetched.id, {
        id: fetched.id,
        name: fetched.name,
        icon: fetched.icon,
        icon_color: newIconColor,
      })
    } else {
      const categoryId = selectedId === '' ? null : selectedId
      const { error: updateError } = await supabase
        .from('products')
        .update({ category_id: categoryId })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(translateDbError(updateError.message, 'No se pudo guardar el cambio.')); setSaving(false); return }
      onSaved(product.id, categoryId)
    }

    setSaving(false)
    onClose()
  }

  const categoryOptions = [
    { value: '', label: 'Sin categoría' },
    ...categories.map(c => ({ value: c.id, label: `${c.icon} ${c.name}` })),
  ]

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }} modal={false}>
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-sm" />
      </DialogPortal>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Cambiar categoría</DialogTitle>

        <div className="px-5 pt-4 pb-3 border-b border-edge/60">
          <p className="font-semibold text-heading text-sm">
            {view === 'picker' ? 'Elegir icono' : 'Cambiar categoría'}
          </p>
          <p className="text-xs text-subtle truncate mt-0.5">{product?.name}</p>
        </div>

        {view === 'picker' ? (
          <IconPickerPanel
            selectedIcon={newIcon}
            selectedColor={newIconColor}
            onConfirm={(icon, color) => {
              setNewIcon(icon)
              setNewIconColor(color)
              setView('main')
            }}
            onCancel={() => setView('main')}
          />
        ) : (
          <>
            <div className="px-5 py-4 space-y-3">
              {!creating ? (
                <>
                  <SelectDropdown
                    value={selectedId}
                    onChange={setSelectedId}
                    options={categoryOptions}
                    placeholder="Sin categoría"
                    usePortal
                  />
                  <button type="button" onClick={() => setCreating(true)} className="text-xs text-primary hover:underline">
                    + Crear nueva categoría
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-label text-subtle text-xs">Icono</label>
                      <button
                        type="button"
                        onClick={() => setView('picker')}
                        className="flex items-center gap-2 w-full px-3 py-2 border border-input rounded-md
                                   bg-background hover:bg-accent transition-colors text-sm h-9"
                      >
                        <CategoryIconPreview icon={newIcon} color={newIconColor} size={18} />
                        <span className="flex-1 text-left truncate text-body">
                          {CATEGORY_ICONS.find(i => i.name === newIcon)?.label ?? newIcon}
                        </span>
                        <span className="text-hint text-xs shrink-0">Cambiar →</span>
                      </button>
                    </div>
                    <Input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="Nombre de la categoría"
                      className="h-9 text-sm rounded-lg flex-1"
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setView('main'); setNewName(''); setNewIcon('Tag'); setNewIconColor('#7a3e10') }}
                    className="text-xs text-subtle hover:text-body transition-colors"
                  >
                    ← Volver a seleccionar
                  </button>
                </>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>

            <div className="px-5 py-3 flex justify-end gap-2 border-t border-edge">
              <Button variant="cancel" className="h-9 px-5 rounded-lg text-sm" onClick={onClose} disabled={saving}>Cancelar</Button>
              <Button className="h-9 px-5 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleSave} disabled={saving || (creating && !newName.trim())}>
                {saving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
