'use client'

import { useState, useMemo } from 'react'
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Supplier } from './types'
import posthog from 'posthog-js'

interface Props {
  suppliers: Supplier[]
  businessId: string
  supabaseClient: SupabaseClient
  onSuppliersChange: (suppliers: Supplier[]) => void
  showForm?: boolean
  onShowFormChange?: (show: boolean) => void
}

interface SupplierForm {
  name: string
  contact_name: string
  phone: string
  email: string
  address: string
  notes: string
}

const emptyForm: SupplierForm = { name: '', contact_name: '', phone: '', email: '', address: '', notes: '' }

export default function SuppliersPanel({ suppliers, businessId, supabaseClient, onSuppliersChange, showForm = false, onShowFormChange }: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const setShowForm = (v: boolean) => onShowFormChange?.(v)
  const [form, setForm] = useState<SupplierForm>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<SupplierForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  function updateForm(key: keyof SupplierForm, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setFormError(null)
  }

  function flash(id: string) {
    setHighlightId(id)
    setTimeout(() => setHighlightId(null), 1500)
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
    const newSupplier = data as Supplier
    posthog.capture('supplier_created', { supplier_id: newSupplier.id, supplier_name: form.name.trim() })
    onSuppliersChange([...suppliers, newSupplier].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(emptyForm)
    setShowForm(false)
    flash(newSupplier.id)
  }

  async function handleSaveEdit(id: string) {
    if (!editForm.name.trim()) return
    setSaving(true)
    setEditError(null)
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
    if (error) { setEditError(error.message ?? 'No se pudo guardar'); return }
    onSuppliersChange(
      suppliers
        .map(s => s.id === id ? { ...s, ...editForm } : s)
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    setEditingId(null)
    flash(id)
  }

  async function handleDeactivate(id: string) {
    if (deletingId) return
    setDeletingId(id)
    setConfirmingDeleteId(null)
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
    setEditError(null)
    setConfirmingDeleteId(null)
    setEditForm({
      name: supplier.name,
      contact_name: supplier.contact_name ?? '',
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      notes: supplier.notes ?? '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  return (
    <div className="space-y-4">
      {showForm && (
        <div className="surface-card p-5 space-y-3">
          <p className="font-semibold text-heading text-foreground">Nuevo proveedor</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-hint">Nombre <span className="text-destructive">*</span></label>
              <Input value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="Nombre" maxLength={100} />
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
          </div>
          {formError && <p className="text-xs text-destructive">{formError}</p>}
          <div className="flex gap-2 pt-1">
            <Button className="h-9 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleCreate} disabled={saving}>
              {saving ? 'Guardando...' : 'Crear proveedor'}
            </Button>
            <Button variant="ghost" className="h-9 rounded-lg text-sm" onClick={() => { setShowForm(false); setForm(emptyForm); setFormError(null) }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {suppliers.length === 0 && !showForm ? (
        <div className="surface-card px-6 py-12 flex flex-col items-center gap-3">
          <p className="text-body font-medium">Sin proveedores</p>
          <p className="text-sm text-hint">Agregá tu primer proveedor para organizar tus compras</p>
          <Button
            className="h-9 rounded-lg text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-2 mt-1"
            onClick={() => setShowForm(true)}
          >
            <Plus size={15} />
            Nuevo proveedor
          </Button>
        </div>
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-edge/60">
              <tr className="text-xs text-hint font-medium">
                <th className="text-foreground text-left px-4 py-3">Nombre</th>
                <th className="text-foreground text-left px-4 py-3 hidden md:table-cell">Contacto</th>
                <th className="text-foreground text-left px-4 py-3 hidden lg:table-cell">Email</th>
                <th className="text-foreground text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(supplier => (
                <tr
                  key={supplier.id}
                  className={`border-b border-edge/40 transition-colors duration-300 ${
                    highlightId === supplier.id ? 'bg-primary/5' : 'hover:bg-hover-bg'
                  }`}
                >
                  {editingId === supplier.id ? (
                    <td className="px-4 py-3" colSpan={4}>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            className="h-8 text-sm w-36 min-w-0"
                            value={editForm.name}
                            onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Nombre"
                            maxLength={100}
                          />
                          <Input
                            className="h-8 text-sm w-36 min-w-0"
                            value={editForm.contact_name}
                            onChange={e => setEditForm(prev => ({ ...prev, contact_name: e.target.value }))}
                            placeholder="Contacto"
                            maxLength={100}
                          />
                          <Input
                            className="h-8 text-sm w-32 min-w-0"
                            value={editForm.phone}
                            onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                            placeholder="Teléfono"
                            maxLength={30}
                          />
                          <Input
                            className="h-8 text-sm w-44 min-w-0"
                            value={editForm.email}
                            onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                            placeholder="Email"
                            maxLength={100}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(supplier.id)}
                            disabled={saving}
                            className="p-1.5 rounded-lg text-primary hover:bg-primary/5 transition-colors disabled:opacity-40"
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="p-1.5 rounded-lg text-hint hover:bg-hover-bg transition-colors"
                          >
                            <X size={15} />
                          </button>
                        </div>
                        {editError && <p className="text-xs text-destructive">{editError}</p>}
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium text-heading max-w-[180px]">
                        <span className="truncate block">{supplier.name}</span>
                      </td>
                      <td className="px-4 py-3 text-body hidden md:table-cell">{supplier.contact_name ?? '—'}</td>
                      <td className="px-4 py-3 text-hint hidden lg:table-cell">{supplier.email ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {confirmingDeleteId === supplier.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-xs text-destructive mr-1">¿Borrar?</span>
                            <button
                              type="button"
                              onClick={() => handleDeactivate(supplier.id)}
                              disabled={deletingId === supplier.id}
                              className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                            >
                              {deletingId === supplier.id ? <span className="text-xs">...</span> : <Trash2 size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              className="p-1.5 rounded-lg text-hint hover:bg-hover-bg transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
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
                              onClick={() => setConfirmingDeleteId(supplier.id)}
                              disabled={deletingId === supplier.id}
                              className="p-1.5 rounded-lg text-hint hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
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
