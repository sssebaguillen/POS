'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'

function FieldGroup({ label, required, error, hint, children }: {
  label: string
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold text-subtle uppercase tracking-wide">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[11px] text-emerald-600 font-medium">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  )
}

interface Category {
  id: string
  name: string
  icon: string
}

interface NewProduct {
  id: string
  name: string
  price: number
  cost: number
  stock: number
  min_stock: number
  is_active: boolean
  category_id: string | null
  sku: string | null
  barcode: string | null
  categories?: { name: string; icon: string } | null
}

interface Props {
  open: boolean
  onClose: () => void
  categories: Category[]
  onCreated: (product: NewProduct) => void
}

const EMPTY_FORM = {
  name: '',
  sku: '',
  barcode: '',
  category_id: '',
  price: '',
  cost: '',
  stock: '',
  min_stock: '',
  is_active: true,
}

export default function NewProductModal({ open, onClose, categories, onCreated }: Props) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const supabase = createClient()

  function set(field: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [field]: value }))
    setErrors(prev => ({ ...prev, [field]: '' }))
  }

  function validate() {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'El nombre es obligatorio'
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 0) e.price = 'Precio inválido'
    if (form.cost && (isNaN(Number(form.cost)) || Number(form.cost) < 0)) e.cost = 'Costo inválido'
    if (form.stock && (isNaN(Number(form.stock)) || Number(form.stock) < 0)) e.stock = 'Stock inválido'
    if (form.min_stock && (isNaN(Number(form.min_stock)) || Number(form.min_stock) < 0)) e.min_stock = 'Mínimo inválido'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    setLoading(true)
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      category_id: form.category_id || null,
      price: Number(form.price),
      cost: Number(form.cost) || 0,
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      is_active: form.is_active,
    }

    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select('id, name, price, cost, stock, min_stock, is_active, category_id, sku, barcode, categories(name, icon)')
      .single()

    setLoading(false)
    if (error || !data) {
      setErrors({ _global: error?.message ?? 'Error al crear el producto' })
      return
    }

    const created: NewProduct = {
      ...data,
      price: Number(data.price),
      cost: Number(data.cost),
      categories: Array.isArray(data.categories)
        ? (data.categories[0] ?? null)
        : (data.categories ?? null),
    }

    onCreated(created)
    setForm(EMPTY_FORM)
    setErrors({})
    onClose()
  }

  function handleClose() {
    setForm(EMPTY_FORM)
    setErrors({})
    onClose()
  }

  const margin = form.price && form.cost && Number(form.price) > 0
    ? Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100)
    : null

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg" showCloseButton={false}>
        {/* Header */}
        <div className="bg-emerald-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Nuevo producto</h2>
          <button
            onClick={handleClose}
            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
          >
            <span className="text-white text-sm">✕</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-5 flex flex-col gap-5 max-h-[calc(100vh-220px)] overflow-y-auto">

            {errors._global && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">{errors._global}</p>
            )}

            {/* Nombre */}
            <FieldGroup label="Nombre" required error={errors.name}>
              <Input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Ej: Pan sin TACC x500g"
                className={`h-10 rounded-xl text-sm ${errors.name ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-emerald-200 focus-visible:border-emerald-400'}`}
                autoFocus
              />
            </FieldGroup>

            {/* Categoría */}
            <FieldGroup label="Categoría">
              <select
                value={form.category_id}
                onChange={e => set('category_id', e.target.value)}
                className="h-10 w-full rounded-xl border border-edge px-3 text-sm bg-surface text-body focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 transition-colors appearance-none cursor-pointer"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
              >
                <option value="">Sin categoría</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
                ))}
              </select>
            </FieldGroup>

            {/* Divider */}
            <div className="h-px bg-edge-soft" />

            {/* Precio y Costo */}
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="Precio venta" required error={errors.price}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={e => set('price', e.target.value)}
                    placeholder="0"
                    className={`h-10 rounded-xl text-sm pl-7 ${errors.price ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-emerald-200 focus-visible:border-emerald-400'}`}
                  />
                </div>
              </FieldGroup>
              <FieldGroup label="Costo" error={errors.cost} hint={margin !== null ? `${margin}% margen` : undefined}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-hint">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.cost}
                    onChange={e => set('cost', e.target.value)}
                    placeholder="0"
                    className={`h-10 rounded-xl text-sm pl-7 ${errors.cost ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-emerald-200 focus-visible:border-emerald-400'}`}
                  />
                </div>
              </FieldGroup>
            </div>

            {/* Stock */}
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="Stock inicial" error={errors.stock}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.stock}
                  onChange={e => set('stock', e.target.value)}
                  placeholder="0"
                  className={`h-10 rounded-xl text-sm ${errors.stock ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-emerald-200 focus-visible:border-emerald-400'}`}
                />
              </FieldGroup>
              <FieldGroup label="Stock mínimo" error={errors.min_stock}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={form.min_stock}
                  onChange={e => set('min_stock', e.target.value)}
                  placeholder="0"
                  className={`h-10 rounded-xl text-sm ${errors.min_stock ? 'border-red-400 focus-visible:ring-red-200' : 'border-edge focus-visible:ring-emerald-200 focus-visible:border-emerald-400'}`}
                />
              </FieldGroup>
            </div>

            {/* Divider */}
            <div className="h-px bg-edge-soft" />

            {/* SKU y Código de barras */}
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="SKU">
                <Input
                  value={form.sku}
                  onChange={e => set('sku', e.target.value)}
                  placeholder="Ej: PSTACC-500"
                  className="h-10 rounded-xl text-sm border-edge focus-visible:ring-emerald-200 focus-visible:border-emerald-400"
                />
              </FieldGroup>
              <FieldGroup label="Código de barras">
                <Input
                  value={form.barcode}
                  onChange={e => set('barcode', e.target.value)}
                  placeholder="Ej: 7790001234567"
                  className="h-10 rounded-xl text-sm border-edge focus-visible:ring-emerald-200 focus-visible:border-emerald-400"
                />
              </FieldGroup>
            </div>

            {/* Toggle activo */}
            <label className="flex items-center justify-between cursor-pointer select-none bg-surface-alt rounded-xl px-4 py-3">
              <span className="text-sm font-medium text-body">Producto activo</span>
              <div
                onClick={() => set('is_active', !form.is_active)}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${form.is_active ? 'bg-emerald-600' : 'bg-muted-foreground'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow-sm transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </div>
            </label>
          </div>

          {/* Footer */}
          <div className="border-t border-edge-soft bg-surface-alt/80 px-6 py-4 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="h-9 px-5 rounded-xl text-sm"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="h-9 px-5 rounded-xl text-sm bg-emerald-700 hover:bg-emerald-800 text-white"
            >
              {loading ? 'Guardando…' : 'Crear producto'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
