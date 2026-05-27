'use client'

import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import type { Supplier } from './types'

interface SupplierForm {
  name: string
  contact_name: string
  phone: string
  email: string
  address: string
  notes: string
}

interface Props {
  supplier: Supplier
  businessId: string
  operatorId: string | null
  supabaseClient: SupabaseClient
  onClose: () => void
  onUpdated: (supplier: Supplier) => void
}

export default function EditSupplierModal({
  supplier,
  businessId,
  operatorId,
  supabaseClient,
  onClose,
  onUpdated,
}: Props) {
  const [form, setForm] = useState<SupplierForm>({
    name: supplier.name,
    contact_name: supplier.contact_name ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    notes: supplier.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateForm(key: keyof SupplierForm, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setError(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }

    setSaving(true)
    const { data: rpcResult, error: rpcError } = await supabaseClient.rpc('update_supplier', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_supplier_id: supplier.id,
      p_name: form.name.trim(),
      p_contact_name: form.contact_name.trim() || null,
      p_phone: form.phone.trim() || null,
      p_email: form.email.trim() || null,
      p_address: form.address.trim() || null,
      p_notes: form.notes.trim() || null,
    })
    setSaving(false)

    const result = rpcResult as { success: boolean; error?: string } | null
    if (rpcError || !result?.success) {
      setError(result?.error ?? rpcError?.message ?? 'No se pudo guardar')
      return
    }

    onUpdated({
      ...supplier,
      name: form.name.trim(),
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={nextOpen => { if (!nextOpen) onClose() }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden bg-card flex flex-col" showCloseButton={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <h2 className="text-base font-semibold text-heading">Editar proveedor</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
          <div className="overflow-y-auto px-5 py-4 flex-1 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-hint">Nombre <span className="text-destructive">*</span></label>
                <Input value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="Nombre" maxLength={100} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-hint">Contacto</label>
                <Input value={form.contact_name} onChange={e => updateForm('contact_name', e.target.value)} placeholder="Nombre de contacto" maxLength={100} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-hint">Teléfono</label>
                <Input value={form.phone} onChange={e => updateForm('phone', e.target.value)} placeholder="+54 9 XXXX XXXXXX" maxLength={30} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-hint">Email</label>
                <Input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="Email" maxLength={100} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-hint">Dirección</label>
                <Input value={form.address} onChange={e => updateForm('address', e.target.value)} placeholder="Dirección" maxLength={200} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs text-hint">Notas</label>
                <Input value={form.notes} onChange={e => updateForm('notes', e.target.value)} placeholder="Notas internas" maxLength={500} />
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="border-t border-edge px-5 py-4 flex items-center justify-end gap-2.5 shrink-0">
            <Button type="button" variant="cancel" onClick={onClose} disabled={saving} className="h-9 rounded-lg text-sm">
              Cancelar
            </Button>
            <Button type="submit" disabled={saving} className="h-9 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground">
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
