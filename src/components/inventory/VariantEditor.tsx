'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import { Plus, X, AlertTriangle } from 'lucide-react'
import type { AttributeType, ProductOption, ProductVariant } from '@/lib/types'
import { useCurrency } from '@/lib/context/CurrencyContext'
import { getCurrencySymbol } from '@/lib/format'

// ─── Draft types (UI-only) ────────────────────────────────────────────────────

export interface DraftOptionValue {
  id?: string
  value: string
  position: number
}

export interface DraftOption {
  id?: string
  attribute_type_id: string
  name: string
  position: number
  values: DraftOptionValue[]
}

export interface DraftVariantRow {
  id?: string
  combinationKey: string
  label: string
  optionValueIndices: [number, number][]
  optionValueIds?: string[]
  price: string
  cost: string
  stock: string
  sku: string
  is_active: boolean
}

// ─── Cartesian product helper ─────────────────────────────────────────────────

function buildVariantRows(
  options: DraftOption[],
  existing: DraftVariantRow[]
): DraftVariantRow[] {
  const validOptions = options.filter(o => o.values.length > 0)
  if (validOptions.length === 0) return []

  // Cartesian product
  const combos: [number, number][][] = [[]]
  for (let optIdx = 0; optIdx < validOptions.length; optIdx++) {
    const next: [number, number][][] = []
    for (const combo of combos) {
      for (let valIdx = 0; valIdx < validOptions[optIdx].values.length; valIdx++) {
        next.push([...combo, [optIdx, valIdx]])
      }
    }
    combos.length = 0
    combos.push(...next)
  }

  return combos.map(combo => {
    const label = combo
      .map(([oIdx, vIdx]) => validOptions[oIdx].values[vIdx].value)
      .join(' / ')
    const combinationKey = combo.map(([o, v]) => `${o}:${v}`).join('|')

    const preserved = existing.find(e => e.combinationKey === combinationKey)
    if (preserved) return { ...preserved, label }

    return {
      combinationKey,
      label,
      optionValueIndices: combo,
      price: '',
      cost: '',
      stock: '',
      sku: '',
      is_active: true,
    }
  })
}

// ─── Exported payload types ───────────────────────────────────────────────────

export interface VariantPayloadNew {
  options: {
    attribute_type_id: string
    name: string
    position: number
    values: { value: string; position: number }[]
  }[]
  variants: {
    sku: string | null
    price: number
    cost: number
    stock: number
    min_stock: number
    is_active: boolean
    option_value_indices: [number, number][]
  }[]
}

export interface VariantPayloadEdit {
  options: {
    id?: string
    attribute_type_id: string
    name: string
    position: number
    values: { id?: string; value: string; position: number }[]
  }[]
  variants: {
    id?: string
    sku: string | null
    price: number
    cost: number
    stock: number
    min_stock: number
    is_active: boolean
    option_value_ids?: string[]
  }[]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  mode: 'new' | 'edit'
  initialOptions?: ProductOption[]
  initialVariants?: ProductVariant[]
  hasSalesHistory?: boolean
  hasVariants: boolean
  onHasVariantsChange: (v: boolean) => void
  onPayloadChange: (payload: VariantPayloadNew | VariantPayloadEdit | null) => void
}

export default function VariantEditor({
  mode,
  initialOptions,
  initialVariants,
  hasSalesHistory,
  hasVariants,
  onHasVariantsChange,
  onPayloadChange,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const currency = useCurrency()
  const currencySymbol = getCurrencySymbol(currency)

  const [attributeTypes, setAttributeTypes] = useState<AttributeType[]>([])
  const [options, setOptions] = useState<DraftOption[]>([])
  const [variants, setVariants] = useState<DraftVariantRow[]>([])
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({})
  const initialized = useRef(false)

  // Load attribute types
  useEffect(() => {
    supabase.rpc('get_attribute_types').then(({ data }) => {
      if (data) setAttributeTypes(data as AttributeType[])
    })
  }, [supabase])

  // Initialize from existing data in edit mode
  useEffect(() => {
    if (mode !== 'edit' || initialized.current) return
    if (!initialOptions || !initialVariants) return
    initialized.current = true

    const draftOptions: DraftOption[] = initialOptions.map((opt, oIdx) => ({
      id: opt.id,
      attribute_type_id: opt.attribute_type_id,
      name: opt.name,
      position: opt.position,
      values: opt.values.map((v, vIdx) => ({
        id: v.id,
        value: v.value,
        position: vIdx,
      })),
    }))

    const draftVariants: DraftVariantRow[] = initialVariants.map(v => {
      const combo = v.option_values.map(ov => {
        const oIdx = draftOptions.findIndex(o =>
          o.values.some(val => val.id === ov.option_value_id)
        )
        const vIdx = oIdx >= 0
          ? draftOptions[oIdx].values.findIndex(val => val.id === ov.option_value_id)
          : -1
        return [oIdx, vIdx] as [number, number]
      })
      const label = v.option_values.map(ov => ov.value).join(' / ')
      const combinationKey = combo.map(([o, v]) => `${o}:${v}`).join('|')

      return {
        id: v.id,
        combinationKey,
        label,
        optionValueIndices: combo,
        price: String(v.price),
        cost: String(v.cost),
        stock: String(v.stock),
        sku: v.sku ?? '',
        is_active: v.is_active,
      }
    })

    setOptions(draftOptions)
    setVariants(draftVariants)
  }, [mode, initialOptions, initialVariants])

  // Regenerate variants when options change (new mode only)
  useEffect(() => {
    if (mode !== 'new') return
    setVariants(prev => buildVariantRows(options, prev))
  }, [options, mode])

  // Emit payload on change
  useEffect(() => {
    if (!hasVariants) {
      onPayloadChange(null)
      return
    }

    if (mode === 'new') {
      const validOptions = options.filter(o => o.values.length > 0)
      if (validOptions.length === 0 || variants.length === 0) {
        onPayloadChange(null)
        return
      }

      const payload: VariantPayloadNew = {
        options: validOptions.map((o, oIdx) => ({
          attribute_type_id: o.attribute_type_id,
          name: o.name,
          position: oIdx,
          values: o.values.map((v, vIdx) => ({ value: v.value, position: vIdx })),
        })),
        variants: variants.map(v => ({
          sku: v.sku.trim() || null,
          price: Number(v.price) || 0,
          cost: Number(v.cost) || 0,
          stock: Math.trunc(Number(v.stock) || 0),
          min_stock: 0,
          is_active: v.is_active,
          option_value_indices: v.optionValueIndices,
        })),
      }
      onPayloadChange(payload)
    } else {
      // Edit mode: emit existing options + variants
      const payload: VariantPayloadEdit = {
        options: options.map((o, oIdx) => ({
          id: o.id,
          attribute_type_id: o.attribute_type_id,
          name: o.name,
          position: oIdx,
          values: o.values.map((v, vIdx) => ({
            id: v.id,
            value: v.value,
            position: vIdx,
          })),
        })),
        variants: variants.map(v => ({
          id: v.id,
          sku: v.sku.trim() || null,
          price: Number(v.price) || 0,
          cost: Number(v.cost) || 0,
          stock: Math.trunc(Number(v.stock) || 0),
          min_stock: 0,
          is_active: v.is_active,
          ...(v.id ? {} : { option_value_ids: v.optionValueIds ?? [] }),
        })),
      }
      onPayloadChange(payload)
    }
  }, [hasVariants, options, variants, mode, onPayloadChange])

  function addOption() {
    const defaultType = attributeTypes[0]
    if (!defaultType) return
    setOptions(prev => [
      ...prev,
      {
        attribute_type_id: defaultType.id,
        name: defaultType.label,
        position: prev.length,
        values: [],
      },
    ])
  }

  function removeOption(optIdx: number) {
    setOptions(prev => prev.filter((_, i) => i !== optIdx))
  }

  function updateOptionType(optIdx: number, typeId: string) {
    const attrType = attributeTypes.find(t => t.id === typeId)
    setOptions(prev => prev.map((o, i) =>
      i === optIdx
        ? { ...o, attribute_type_id: typeId, name: attrType?.label ?? typeId }
        : o
    ))
  }

  function updateOptionName(optIdx: number, name: string) {
    setOptions(prev => prev.map((o, i) => i === optIdx ? { ...o, name } : o))
  }

  function addValue(optIdx: number) {
    const raw = (valueInputs[optIdx] ?? '').trim()
    if (!raw) return
    setOptions(prev => prev.map((o, i) =>
      i === optIdx
        ? { ...o, values: [...o.values, { value: raw, position: o.values.length }] }
        : o
    ))
    setValueInputs(prev => ({ ...prev, [optIdx]: '' }))
  }

  function removeValue(optIdx: number, valIdx: number) {
    setOptions(prev => prev.map((o, i) =>
      i === optIdx
        ? { ...o, values: o.values.filter((_, vi) => vi !== valIdx) }
        : o
    ))
  }

  function updateVariant(varIdx: number, field: keyof DraftVariantRow, value: string | boolean) {
    setVariants(prev => prev.map((v, i) =>
      i === varIdx ? { ...v, [field]: value } : v
    ))
  }

  const showTable = variants.length > 0

  return (
    <div className="sm:col-span-2 space-y-3.5">
      <div className="border-t border-edge" />

      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-subtle uppercase tracking-widest">Variantes</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-subtle">Este producto tiene variantes</span>
          <button
            type="button"
            onClick={() => onHasVariantsChange(!hasVariants)}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${hasVariants ? 'bg-primary' : 'bg-muted-foreground'}`}
            aria-label="Activar variantes"
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${hasVariants ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {hasVariants && (
        <div className="space-y-3">
          {hasSalesHistory && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Este producto tiene ventas registradas. Las ventas anteriores quedarán vinculadas al producto base sin variante específica.
              </p>
            </div>
          )}

          {/* Options */}
          <div className="space-y-2.5">
            {options.map((option, optIdx) => (
              <div key={optIdx} className="rounded-xl border border-edge bg-surface p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  {/* Attribute type selector */}
                  <select
                    value={option.attribute_type_id}
                    onChange={e => updateOptionType(optIdx, e.target.value)}
                    disabled={mode === 'edit' && !!option.id}
                    className="h-8 rounded-lg border border-edge bg-surface text-sm text-body px-2 focus:outline-none focus:border-ring flex-1 min-w-0 disabled:opacity-60"
                  >
                    {attributeTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                  {option.attribute_type_id === 'custom' && (
                    <Input
                      value={option.name}
                      onChange={e => updateOptionName(optIdx, e.target.value)}
                      placeholder="Nombre del atributo"
                      disabled={mode === 'edit' && !!option.id}
                      className="h-8 rounded-lg text-sm bg-surface border-edge flex-1 min-w-0 disabled:opacity-60"
                    />
                  )}
                  {(mode === 'new' || !option.id) && (
                    <button
                      type="button"
                      onClick={() => removeOption(optIdx)}
                      className="shrink-0 p-1.5 rounded-lg text-hint hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Values */}
                <div className="flex flex-wrap gap-1.5">
                  {option.values.map((val, valIdx) => (
                    <span
                      key={valIdx}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-surface-alt border border-edge text-body"
                    >
                      {val.value}
                      <button
                        type="button"
                        onClick={() => removeValue(optIdx, valIdx)}
                        className="text-hint hover:text-red-500 transition-colors ml-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={valueInputs[optIdx] ?? ''}
                      onChange={e => setValueInputs(prev => ({ ...prev, [optIdx]: e.target.value }))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); addValue(optIdx) }
                      }}
                      placeholder="Agregar valor…"
                      className="h-7 rounded-full border border-dashed border-edge bg-surface text-xs px-3 text-body placeholder:text-hint focus:outline-none focus:border-primary min-w-0 w-28"
                    />
                    <button
                      type="button"
                      onClick={() => addValue(optIdx)}
                      className="h-7 w-7 rounded-full border border-dashed border-edge bg-surface text-hint hover:text-primary hover:border-primary flex items-center justify-center transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {mode === 'new' && (
            <button
              type="button"
              onClick={addOption}
              className="flex items-center gap-1.5 text-xs text-primary/80 hover:text-primary transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar atributo
            </button>
          )}

          {/* Variants table */}
          {showTable && (
            <div className="overflow-x-auto rounded-xl border border-edge">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-edge bg-surface-alt">
                    <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Variante</th>
                    <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Precio ({currencySymbol})</th>
                    <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Costo ({currencySymbol})</th>
                    <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Stock inicial</th>
                    <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">SKU</th>
                    <th className="text-left px-3 py-2 font-medium text-subtle">Activo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {variants.map((variant, varIdx) => (
                    <tr key={variant.combinationKey} className={`bg-surface ${!variant.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2 text-body font-medium whitespace-nowrap">
                        {variant.label}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={variant.price}
                          onChange={e => updateVariant(varIdx, 'price', e.target.value)}
                          placeholder="0"
                          className="w-20 h-7 rounded-lg border border-edge bg-surface px-2 text-xs text-body tabular-nums focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={variant.cost}
                          onChange={e => updateVariant(varIdx, 'cost', e.target.value)}
                          placeholder="0"
                          className="w-20 h-7 rounded-lg border border-edge bg-surface px-2 text-xs text-body tabular-nums focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={variant.stock}
                          onChange={e => updateVariant(varIdx, 'stock', e.target.value)}
                          placeholder="0"
                          className="w-20 h-7 rounded-lg border border-edge bg-surface px-2 text-xs text-body tabular-nums focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={variant.sku}
                          onChange={e => updateVariant(varIdx, 'sku', e.target.value)}
                          placeholder="Opcional"
                          className="w-24 h-7 rounded-lg border border-edge bg-surface px-2 text-xs text-body focus:outline-none focus:border-primary"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => updateVariant(varIdx, 'is_active', !variant.is_active)}
                          className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${variant.is_active ? 'bg-primary' : 'bg-muted-foreground'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${variant.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
