'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { InventoryBrand, InventoryProduct } from '@/components/inventory/types'
import { translateDbError } from '@/lib/errors'

interface QuickEditBrandModalProps {
  open: boolean
  product: InventoryProduct | null
  brands: InventoryBrand[]
  businessId: string
  operatorId: string | null
  onSaved: (productId: string, brandId: string | null, newBrand?: InventoryBrand) => void
  onClose: () => void
}

export default function QuickEditBrandModal({ open, product, brands, businessId, operatorId, onSaved, onClose }: QuickEditBrandModalProps) {
  const [selectedId, setSelectedId] = useState<string>(product?.brand_id ?? '')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])

  async function handleSave() {
    if (!product) return
    setSaving(true)
    setError(null)

    if (creating) {
      if (!newName.trim()) { setError('El nombre es obligatorio'); setSaving(false); return }
      const { data: rpcResult, error: rpcError } = await supabase.rpc('create_brand_guarded', {
        p_operator_id: operatorId,
        p_business_id: businessId,
        p_name: newName.trim(),
      })
      const result = rpcResult as { success: boolean; error?: string } | null
      if (rpcError || !result?.success) {
        setError(result?.error ?? translateDbError(rpcError?.message ?? '', 'Error al crear la marca'))
        setSaving(false)
        return
      }
      const { data: fetched, error: fetchError } = await supabase
        .from('brands')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('name', newName.trim())
        .limit(1)
        .single()
      if (fetchError || !fetched) { setError(translateDbError(fetchError?.message ?? '', 'Error al obtener la marca creada')); setSaving(false); return }
      const { error: updateError } = await supabase
        .from('products')
        .update({ brand_id: fetched.id })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(translateDbError(updateError.message, 'No se pudo guardar el cambio.')); setSaving(false); return }
      onSaved(product.id, fetched.id, { id: fetched.id, name: fetched.name })
    } else {
      const brandId = selectedId === '' ? null : selectedId
      const { error: updateError } = await supabase
        .from('products')
        .update({ brand_id: brandId })
        .eq('id', product.id)
        .eq('business_id', businessId)
      if (updateError) { setError(translateDbError(updateError.message, 'No se pudo guardar el cambio.')); setSaving(false); return }
      onSaved(product.id, brandId)
    }

    setSaving(false)
    onClose()
  }

  const brandOptions = [
    { value: '', label: 'Sin marca' },
    ...brands.map(b => ({ value: b.id, label: b.name })),
  ]

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }} modal={false}>
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-sm" />
      </DialogPortal>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 p-0 overflow-hidden rounded-2xl">
        <DialogTitle className="sr-only">Cambiar marca</DialogTitle>
        <div className="px-5 pt-4 pb-3 border-b border-edge/60">
          <p className="font-semibold text-heading text-sm">Cambiar marca</p>
          <p className="text-xs text-subtle truncate mt-0.5">{product?.name}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {!creating ? (
            <>
              <SelectDropdown
                value={selectedId}
                onChange={setSelectedId}
                options={brandOptions}
                placeholder="Sin marca"
                usePortal
              />
              <button type="button" onClick={() => setCreating(true)} className="text-xs text-primary hover:underline">
                + Crear nueva marca
              </button>
            </>
          ) : (
            <>
              <Input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Nombre de la marca"
                className="h-9 text-sm rounded-lg"
                autoFocus
              />
              <button type="button" onClick={() => { setCreating(false); setNewName('') }} className="text-xs text-subtle hover:text-body transition-colors">
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
      </DialogContent>
    </Dialog>
  )
}
