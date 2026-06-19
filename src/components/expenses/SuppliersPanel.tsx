'use client'

import { useState, useMemo } from 'react'
import { Plus } from '@phosphor-icons/react/dist/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ConfirmModal from '@/components/shared/ConfirmModal'
import type { Supplier } from './types'
import EditSupplierModal from './EditSupplierModal'
import { FieldErrorMessage, ShakeOnError } from '@/components/shared/ShakeError'
import posthog from 'posthog-js'

interface Props {
  suppliers: Supplier[]
  businessId: string
  operatorId: string | null
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

export default function SuppliersPanel({ suppliers, businessId, operatorId, supabaseClient, onSuppliersChange, showForm = false, onShowFormChange }: Props) {
  const supabase = useMemo(() => supabaseClient, [supabaseClient])
  const setShowForm = (v: boolean) => onShowFormChange?.(v)
  const [form, setForm] = useState<SupplierForm>(emptyForm)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<Supplier | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formErrorNonce, setFormErrorNonce] = useState(0)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.contact_name?.toLowerCase().includes(q) ?? false) ||
      (s.phone?.toLowerCase().includes(q) ?? false) ||
      (s.email?.toLowerCase().includes(q) ?? false) ||
      (s.address?.toLowerCase().includes(q) ?? false) ||
      (s.notes?.toLowerCase().includes(q) ?? false)
    )
  }, [suppliers, search])

  function updateForm(key: keyof SupplierForm, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setFormError(null)
  }

  function flash(id: string) {
    setHighlightId(id)
    setTimeout(() => setHighlightId(null), 1500)
  }

  async function handleCreate() {
    if (!form.name.trim()) { setFormError('El nombre es obligatorio'); setFormErrorNonce(n => n + 1); return }
    setSaving(true)
    const { data: rpcResult, error } = await supabase.rpc('create_supplier', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_name: form.name.trim(),
      p_contact_name: form.contact_name.trim() || null,
      p_phone: form.phone.trim() || null,
      p_email: form.email.trim() || null,
      p_address: form.address.trim() || null,
      p_notes: form.notes.trim() || null,
    })
    setSaving(false)
    const result = rpcResult as { success: boolean; error?: string; supplier?: Supplier } | null
    if (error || !result?.success || !result.supplier) {
      setFormError(result?.error ?? error?.message ?? 'No se pudo crear el proveedor')
      setFormErrorNonce(n => n + 1)
      return
    }
    const newSupplier = result.supplier
    posthog.capture('supplier_created', { supplier_id: newSupplier.id, supplier_name: form.name.trim() })
    onSuppliersChange([...suppliers, newSupplier].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(emptyForm)
    setShowForm(false)
    flash(newSupplier.id)
  }

  async function handleDeactivate(id: string) {
    if (deletingId) return
    setDeletingId(id)
    setConfirmingDelete(null)
    const { data: rpcResult, error } = await supabase.rpc('deactivate_supplier', {
      p_operator_id: operatorId,
      p_business_id: businessId,
      p_supplier_id: id,
    })
    setDeletingId(null)
    const result = rpcResult as { success: boolean; error?: string } | null
    if (error || !result?.success) return
    onSuppliersChange(suppliers.filter(s => s.id !== id))
  }

  function startEdit(supplier: Supplier) {
    setConfirmingDelete(null)
    setEditingSupplier(supplier)
  }

  return (
    <div className="space-y-4">
      {showForm && (
        <div className="surface-card p-5 space-y-3">
          <p className="font-semibold text-heading text-foreground">Nuevo proveedor</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-hint">Nombre <span className="text-destructive">*</span></label>
              <ShakeOnError error={formError} nonce={formErrorNonce}>
                <Input value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="Nombre" maxLength={100} aria-invalid={formError ? true : undefined} />
              </ShakeOnError>
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
          <FieldErrorMessage error={formError} />
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

      {suppliers.length > 0 && (
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre o contacto..."
          className="h-9 max-w-xs rounded-lg text-sm"
        />
      )}

      {suppliers.length === 0 && !showForm ? (
        <div className="surface-card px-6 py-12 flex flex-col items-center gap-3">
          <p className="text-body font-medium">Sin proveedores</p>
          <p className="text-sm text-hint">Agrega tu primer proveedor para organizar tus compras</p>
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
          <table className="w-full text-sm min-w-[640px]">
            <thead className="border-b border-edge/60">
              <tr className="text-xs text-hint font-medium">
                <th className="text-foreground text-left px-4 py-3">Nombre</th>
                <th className="text-foreground text-left px-4 py-3 hidden md:table-cell">Contacto</th>
                <th className="text-foreground text-left px-4 py-3 hidden md:table-cell">Teléfono</th>
                <th className="text-foreground text-left px-4 py-3 hidden lg:table-cell">Email</th>
                <th className="text-foreground text-left px-4 py-3 hidden xl:table-cell">Dirección</th>
                <th className="text-foreground text-left px-4 py-3 hidden xl:table-cell">Notas</th>
                <th className="text-foreground text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.map(supplier => (
                <tr
                  key={supplier.id}
                  className={`border-b border-edge/40 last:border-0 transition-colors duration-300 ${
                    highlightId === supplier.id ? 'bg-primary/5' : 'hover:bg-hover-bg'
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-heading max-w-[200px]">
                    <span className="truncate block">{supplier.name}</span>
                  </td>
                  <td className="px-4 py-3 text-body hidden md:table-cell">{supplier.contact_name ?? '—'}</td>
                  <td className="px-4 py-3 text-body hidden md:table-cell tabular-nums">{supplier.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-hint hidden lg:table-cell">{supplier.email ?? '—'}</td>
                  <td className="px-4 py-3 text-hint hidden xl:table-cell max-w-[200px]">
                    <span className="truncate block">{supplier.address ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-hint hidden xl:table-cell max-w-[200px]">
                    <span className="truncate block">{supplier.notes ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-3 text-xs"
                        onClick={() => startEdit(supplier)}
                      >
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="h-8 px-3 text-xs"
                        onClick={() => setConfirmingDelete(supplier)}
                        disabled={deletingId === supplier.id}
                      >
                        {deletingId === supplier.id ? 'Eliminando...' : 'Eliminar'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={confirmingDelete !== null}
        title={confirmingDelete ? `Eliminar proveedor "${confirmingDelete.name}"` : ''}
        message="El proveedor será eliminado. Esta acción no se puede deshacer."
        onConfirm={() => { if (confirmingDelete) handleDeactivate(confirmingDelete.id) }}
        onCancel={() => setConfirmingDelete(null)}
      />

      {editingSupplier && (
        <EditSupplierModal
          supplier={editingSupplier}
          businessId={businessId}
          operatorId={operatorId}
          supabaseClient={supabase}
          onClose={() => setEditingSupplier(null)}
          onUpdated={updated => {
            onSuppliersChange(
              suppliers
                .map(s => s.id === updated.id ? updated : s)
                .sort((a, b) => a.name.localeCompare(b.name))
            )
            flash(updated.id)
          }}
        />
      )}
    </div>
  )
}
