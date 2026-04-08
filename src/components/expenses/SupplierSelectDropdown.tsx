'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, Check, Plus, X } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Supplier } from './types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  value: string | null
  onChange: (supplierId: string | null) => void
  businessId: string
  supabaseClient: SupabaseClient
  placeholder?: string
}

export default function SupplierSelectDropdown({ value, onChange, businessId, supabaseClient, placeholder = 'Seleccionar proveedor' }: Props) {
  const [open, setOpen] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const [showInlineCreate, setShowInlineCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const supabase = useMemo(() => supabaseClient, [supabaseClient])

  const selected = useMemo(() => suppliers.find(s => s.id === value) ?? null, [suppliers, value])

  useEffect(() => {
    supabase
      .from('suppliers')
      .select('id, business_id, name, contact_name, phone, email, address, notes, is_active, created_at')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => { if (data) setSuppliers(data as Supplier[]) })
  }, [supabase, businessId])

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  const filtered = useMemo(() =>
    search.trim()
      ? suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
      : suppliers,
    [suppliers, search]
  )

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    const { data, error } = await supabase
      .from('suppliers')
      .insert({ business_id: businessId, name: newName.trim(), is_active: true })
      .select('id, business_id, name, contact_name, phone, email, address, notes, is_active, created_at')
      .single()
    if (error || !data) {
      setCreateError(error?.message ?? 'No se pudo crear el proveedor')
      setCreating(false)
      return
    }
    const newSupplier = data as Supplier
    setSuppliers(prev => [...prev, newSupplier].sort((a, b) => a.name.localeCompare(b.name)))
    onChange(newSupplier.id)
    setNewName('')
    setShowInlineCreate(false)
    setOpen(false)
    setCreating(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between h-9 px-3 rounded-lg border border-input bg-card text-sm text-body hover:bg-surface-alt transition-colors dark:bg-input/30"
      >
        <span className={selected ? 'text-heading' : 'text-hint'}>
          {selected ? selected.name : placeholder}
        </span>
        <div className="flex items-center gap-1">
          {value && (
            <span
              role="button"
              onClick={e => { e.stopPropagation(); onChange(null) }}
              className="p-0.5 rounded hover:bg-surface-alt transition-colors text-hint"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown size={14} className="text-hint" />
        </div>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 surface-elevated overflow-hidden">
          <div className="p-2 border-b border-edge/60">
            <Input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar proveedor..."
              className="h-8 text-sm"
            />
          </div>

          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && !showInlineCreate && (
              <p className="text-sm text-hint px-3 py-2">Sin resultados</p>
            )}
            {filtered.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onChange(s.id); setOpen(false); setSearch('') }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-body hover:bg-hover-bg transition-colors"
              >
                {s.name}
                {s.id === value && <Check size={14} className="text-primary" />}
              </button>
            ))}
          </div>

          <div className="border-t border-edge/60 p-2">
            {!showInlineCreate ? (
              <button
                type="button"
                onClick={() => setShowInlineCreate(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-primary hover:bg-primary/5 rounded-lg transition-colors"
              >
                <Plus size={14} />
                Nuevo proveedor
              </button>
            ) : (
              <div className="space-y-2">
                <Input
                  autoFocus
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setCreateError(null) }}
                  placeholder="Nombre del proveedor"
                  className="h-8 text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
                />
                {createError && <p className="text-xs text-destructive">{createError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleCreate} disabled={creating || !newName.trim()}>
                    {creating ? 'Creando...' : 'Crear'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => { setShowInlineCreate(false); setNewName(''); setCreateError(null) }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
