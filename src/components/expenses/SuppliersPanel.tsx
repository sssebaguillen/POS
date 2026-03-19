'use client'

import { useState, useMemo } from 'react'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Supplier } from './types'

interface Props {
  suppliers: Supplier[]
  businessId: string
  supabaseClient: SupabaseClient
  onSuppliersChange: (suppliers: Supplier[]) => void
}

interface NewSupplierForm {
  name: string
  contact_name: string
  phone: string
  email: string
  address: string
  notes: string
}

const emptyForm: NewSupplierForm = { name: '', contact_name: '', phone: '', email: '', address: '', notes: '' }

export default function SuppliersPanel({ suppliers, businessId, supabaseClient, onSuppliersChange }: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NewSupplierForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<NewSupplierForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  function updateForm(key: keyof NewSupplierForm, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setFormError(null)
  }

  async function handleCreate() {
    if (!form.name.trim()) { setFormError('El nombre es obligatorio'); return }
    setSaving(true)
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        business_id: businessId,
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        is_active: true,
      })
      .select('id, business_id, name, contact_name, phone, email, address, notes, is_active, created_at')
      .single()
    setSaving(false)
    if (error || !data) { setFormError(error?.message ?? 'No se pudo crear el proveedor'); return }
    onSuppliersChange([...suppliers, data as Supplier].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(emptyForm)
    setShowForm(false)
  }

  async function handleSaveEdit(id: string) {
    if (!editForm.name.trim()) return
    setSaving(true)
    const { error } = await supabase
      .from('suppliers')
      .update({
        name: editForm.name.trim(),
        contact_name: editForm.contact_name.trim() || null,
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
        address: editForm.address.trim() || null,
        notes: editForm.notes.trim() || null,
      })
      .eq('id', id)
      .eq('business_id', businessId)
    setSaving(false)
    if (error) return
    onSuppliersChange(
      suppliers
        .map(s => s.id === id ? { ...s, ...editForm } : s)
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    setEditingId(null)
  }

  async function handleDeactivate(id: string) {
    setDeletingId(id)
    const { error } = await supabase
      .from('suppliers')
      .update({ is_active: false })
      .eq('id', id)
      .eq('business_id', businessId)
    setDeletingId(null)
    if (error) return
    onSuppliersChange(suppliers.filter(s => s.id !== id))
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id)
    setEditForm({
      name: supplier.name,
      contact_name: supplier.contact_name ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-heading">Proveedores ({suppliers.length})</p>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowForm(prev => !prev)}>
          <Plus size={14} />
          Nuevo proveedor
        </Button>
      </div>

      {showForm && (
        <div className="surface-card p-5 space-y-3">
          <p className="font-medium text-body text-sm">Nuevo proveedor</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-hint">Nombre <span className="text-destructive">*</span></label>
              <Input value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="Nombre" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-hint">Contacto</label>
              <Input value={form.contact_name} onChange={e => updateForm('contact_name', e.target.value)} placeholder="Nombre de contacto" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-hint">Teléfono</label>
              <Input value={form.phone} onChange={e => updateForm('phone', e.target.value)} placeholder="Teléfono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-hint">Email</label>
              <Input type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="Email" />
            </div>
          </div>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="btn-primary-gradient" onClick={handleCreate} disabled={saving}>
              {saving ? 'Guardando...' : 'Crear proveedor'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setForm(emptyForm); setFormError(null) }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="surface-card px-6 py-12 flex flex-col items-center gap-2">
          <p className="text-body font-medium">Sin proveedores</p>
          <p className="text-sm text-hint">Agregá tu primer proveedor</p>
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-edge/60">
              <tr className="text-xs text-hint font-medium">
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Contacto</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Email</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(supplier => (
                <tr key={supplier.id} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                  {editingId === supplier.id ? (
                    <>
                      <td className="px-4 py-2" colSpan={4}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            className="h-8 text-sm w-40"
                            value={editForm.name}
                            onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Nombre"
                          />
                          <Input
                            className="h-8 text-sm w-36"
                            value={editForm.phone}
                            onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                            placeholder="Teléfono"
                          />
                          <Input
                            className="h-8 text-sm w-44"
                            value={editForm.email}
                            onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                            placeholder="Email"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(supplier.id)}
                            disabled={saving}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded-lg text-hint hover:bg-hover-bg transition-colors"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium text-heading">{supplier.name}</td>
                      <td className="px-4 py-3 text-body hidden md:table-cell">{supplier.contact_name ?? '—'}</td>
                      <td className="px-4 py-3 text-hint hidden lg:table-cell">{supplier.email ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(supplier)}
                            className="p-1.5 rounded-lg text-hint hover:text-heading hover:bg-hover-bg transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeactivate(supplier.id)}
                            disabled={deletingId === supplier.id}
                            className="p-1.5 rounded-lg text-hint hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
