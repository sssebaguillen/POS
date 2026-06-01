'use client'

import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import SelectDropdown from '@/components/ui/SelectDropdown'
import { Plus, X, AlertTriangle, ImageIcon, Upload } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { AttributeType, ProductOption, ProductVariant } from '@/lib/types'
import { useCurrency } from '@/lib/context/CurrencyContext'
import { getCurrencySymbol } from '@/lib/format'
import { validateImageUrl } from '@/lib/validation'

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
  barcode: string
  image_url: string | null
  image_source: 'upload' | 'url' | null
  is_active: boolean
}

// ─── Cartesian product helper ─────────────────────────────────────────────────

// Build a stable combination key using DB IDs when available, falling back to
// the option name + value string. Positional indices are deliberately avoided
// so that removing a value from the middle of an array does not shift the keys
// of unrelated variants and invalidate the preserved-data lookup.
function buildCombinationKey(combo: [number, number][], validOptions: DraftOption[]): string {
  return combo
    .map(([oIdx, vIdx]) => {
      const opt = validOptions[oIdx]
      const val = opt.values[vIdx]
      const optKey = opt.id ?? `attr:${opt.attribute_type_id}:${opt.name}`
      const valKey = val.id ?? `val:${val.value}`
      return `${optKey}~${valKey}`
    })
    .join('|')
}

function buildVariantRows(
  options: DraftOption[],
  existing: DraftVariantRow[]
): DraftVariantRow[] {
  const validOptions = options.filter(o => o.values.length > 0)
  if (validOptions.length === 0) return []

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
    const combinationKey = buildCombinationKey(combo, validOptions)

    const preserved = existing.find(e => e.combinationKey === combinationKey)
    // Always update optionValueIndices to the current combo positions so that
    // filter-pill lookups remain correct after index shifts caused by removals.
    if (preserved) return { ...preserved, label, optionValueIndices: combo, combinationKey }

    // For new rows in edit mode, collect known DB IDs so the RPC can link the
    // new variant to its option values (works when all values already have IDs).
    const knownIds = combo.map(([oIdx, vIdx]) => validOptions[oIdx].values[vIdx].id ?? '')
    const allHaveIds = knownIds.every(id => id !== '')

    return {
      combinationKey,
      label,
      optionValueIndices: combo,
      optionValueIds: allHaveIds ? (knownIds as string[]) : undefined,
      price: '',
      cost: '',
      stock: '',
      barcode: '',
      image_url: null,
      image_source: null,
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
    barcode: string | null
    price: number
    cost: number
    stock: number
    min_stock: number
    image_url: string | null
    image_source: 'upload' | 'url' | null
    is_active: boolean
    is_default?: boolean
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
    barcode: string | null
    price: number
    cost: number
    stock: number
    min_stock: number
    image_url: string | null
    image_source: 'upload' | 'url' | null
    is_active: boolean
    is_default?: boolean
    option_value_ids?: string[]
  }[]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  businessId: string | null
  mode: 'new' | 'edit'
  initialOptions?: ProductOption[]
  initialVariants?: ProductVariant[]
  initialDefaultVariantId?: string
  hasSalesHistory?: boolean
  hasVariants: boolean
  onHasVariantsChange: (v: boolean) => void
  onPayloadChange: (payload: VariantPayloadNew | VariantPayloadEdit | null) => void
  /** When true, render only the variants body; the caller renders the toggle elsewhere. */
  hideToggle?: boolean
}

export default function VariantEditor({
  businessId,
  mode,
  initialOptions,
  initialVariants,
  initialDefaultVariantId,
  hasSalesHistory,
  hasVariants,
  onHasVariantsChange,
  onPayloadChange,
  hideToggle = false,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const currency = useCurrency()
  const currencySymbol = getCurrencySymbol(currency)

  const [attributeTypes, setAttributeTypes] = useState<AttributeType[]>([])
  const [options, setOptions] = useState<DraftOption[]>([])
  const [variants, setVariants] = useState<DraftVariantRow[]>([])
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({})
  const [filterPillValue, setFilterPillValue] = useState<string | null>(null)
  const [defaultVariantKey, setDefaultVariantKey] = useState<string | null>(null)
  const [openPopoverKey, setOpenPopoverKey] = useState<string | null>(null)
  const [variantImageTabs, setVariantImageTabs] = useState<Record<string, 'upload' | 'url'>>({})
  const [variantExternalUrlInputs, setVariantExternalUrlInputs] = useState<Record<string, string>>({})
  const [variantUrlErrors, setVariantUrlErrors] = useState<Record<string, string>>({})
  const [variantImageErrors, setVariantImageErrors] = useState<Record<string, string>>({})
  const [uploadingVariantKey, setUploadingVariantKey] = useState<string | null>(null)
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

    const draftOptions: DraftOption[] = initialOptions.map(opt => ({
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
      // Use the same stable key function so that subsequent regeneration passes
      // can find and preserve these rows correctly.
      const combinationKey = buildCombinationKey(combo, draftOptions)

      return {
        id: v.id,
        combinationKey,
        label,
        optionValueIndices: combo,
        price: String(v.price),
        cost: String(v.cost),
        stock: String(v.stock),
        barcode: v.barcode ?? '',
        image_url: v.image_url ?? null,
        image_source: v.image_source ?? null,
        is_active: v.is_active,
      }
    })

    const urlInputs = draftVariants.reduce<Record<string, string>>((acc, variant) => {
      if (variant.image_source === 'url' && variant.image_url) {
        acc[variant.combinationKey] = variant.image_url
      }
      return acc
    }, {})

    // Set default variant key from initialDefaultVariantId
    if (initialDefaultVariantId) {
      const defaultDraft = draftVariants.find(dv => dv.id === initialDefaultVariantId)
      if (defaultDraft) {
        startTransition(() => {
          setDefaultVariantKey(defaultDraft.combinationKey)
        })
      }
    }

    startTransition(() => {
      setOptions(draftOptions)
      setVariants(draftVariants)
      setVariantExternalUrlInputs(urlInputs)
    })
  }, [mode, initialOptions, initialVariants, initialDefaultVariantId])

  // Regenerate variants whenever options change (both new and edit mode).
  // Guard: skip when options is still the empty initial state. In edit mode the
  // init effect sets options + variants atomically, but the regeneration effect
  // runs in the same flush with the stale options=[] closure — executing
  // buildVariantRows([], draftVariants) would return [] and wipe the just-loaded
  // data. Skipping when options is empty is safe because a variant product always
  // has at least one option with at least one value after initialization.
  useEffect(() => {
    if (options.length === 0) return
    startTransition(() => {
      setVariants(prev => buildVariantRows(options, prev))
    })
  }, [options])

  // Auto-select first variant as default when defaultVariantKey is null or no longer valid
  useEffect(() => {
    if (variants.length === 0) return
    const keys = variants.map(v => v.combinationKey)
    if (!defaultVariantKey || !keys.includes(defaultVariantKey)) {
      startTransition(() => {
        setDefaultVariantKey(keys[0] ?? null)
      })
    }
  }, [variants, defaultVariantKey])

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
          barcode: v.barcode.trim() || null,
          price: Number(v.price) || 0,
          cost: Number(v.cost) || 0,
          stock: Math.trunc(Number(v.stock) || 0),
          min_stock: 0,
          image_url: v.image_url ?? null,
          image_source: v.image_source ?? null,
          is_active: v.is_active,
          is_default: v.combinationKey === defaultVariantKey,
          option_value_indices: v.optionValueIndices,
        })),
      }
      onPayloadChange(payload)
    } else {
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
          barcode: v.barcode.trim() || null,
          price: Number(v.price) || 0,
          cost: Number(v.cost) || 0,
          stock: Math.trunc(Number(v.stock) || 0),
          min_stock: 0,
          image_url: v.image_url ?? null,
          image_source: v.image_source ?? null,
          is_active: v.is_active,
          is_default: v.combinationKey === defaultVariantKey,
          ...(v.id ? {} : { option_value_ids: v.optionValueIds ?? [] }),
        })),
      }
      onPayloadChange(payload)
    }
  }, [hasVariants, options, variants, mode, onPayloadChange, defaultVariantKey])

  function addOption() {
    if (attributeTypes.length === 0) return
    const used = new Set(options.map(o => o.attribute_type_id))
    const nextType =
      attributeTypes.find(t => t.id !== 'custom' && !used.has(t.id)) ??
      attributeTypes.find(t => t.id === 'custom') ??
      attributeTypes[0]
    setOptions(prev => [
      ...prev,
      {
        attribute_type_id: nextType.id,
        name: nextType.label,
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

  function updateVariant<K extends keyof DraftVariantRow>(
    varIdx: number,
    field: K,
    value: DraftVariantRow[K]
  ) {
    setVariants(prev => prev.map((v, i) =>
      i === varIdx ? { ...v, [field]: value } : v
    ))
  }

  function updateVariantByKey(
    combinationKey: string,
    patch: Partial<Pick<DraftVariantRow, 'image_url' | 'image_source'>>
  ) {
    setVariants(prev => prev.map(variant =>
      variant.combinationKey === combinationKey
        ? { ...variant, ...patch }
        : variant
    ))
  }

  async function handleVariantFileUpload(combinationKey: string, file: File) {
    if (!businessId) {
      setVariantImageErrors(prev => ({
        ...prev,
        [combinationKey]: 'No se encontró el negocio activo.',
      }))
      return
    }

    setUploadingVariantKey(combinationKey)
    setVariantImageErrors(prev => ({ ...prev, [combinationKey]: '' }))

    const ext = file.name.split('.').pop() ?? 'jpg'
    const filename = `${businessId}/variants/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(filename, file, { upsert: true })

    if (uploadError) {
      setVariantImageErrors(prev => ({
        ...prev,
        [combinationKey]: `Error al subir imagen: ${uploadError.message}`,
      }))
      setUploadingVariantKey(null)
      return
    }

    const { data: urlData } = supabase.storage
      .from('product-images')
      .getPublicUrl(filename)

    updateVariantByKey(combinationKey, {
      image_url: urlData.publicUrl,
      image_source: 'upload',
    })
    setVariantImageErrors(prev => ({ ...prev, [combinationKey]: '' }))
    setUploadingVariantKey(null)
  }

  const showTable = variants.length > 0

  // ─── Filter pills derived state ───────────────────────────────────────────
  // Only available when there are ≥2 options (multi-attribute products).
  // Filters the table by the first option's value to reduce visible rows.
  const validOptions = options.filter(o => o.values.length > 0)
  const firstOption = validOptions.length >= 2 ? validOptions[0] : null
  const firstOptionValues = firstOption?.values ?? []

  // Resolve activeFilterPill: if stored value no longer exists, fall back to first available
  const activeFilterPill =
    firstOptionValues.find(v => v.value === filterPillValue)?.value ??
    firstOptionValues[0]?.value ??
    null

  const displayedVariants = showTable && firstOption && activeFilterPill
    ? variants.filter(v => {
        const firstCombo = v.optionValueIndices[0]
        if (!firstCombo) return true
        const [, valIdx] = firstCombo
        return firstOption.values[valIdx]?.value === activeFilterPill
      })
    : variants

  // ─── SelectDropdown options ───────────────────────────────────────────────
  // Build per-row available types: exclude types already used by OTHER options,
  // but always keep 'custom' (multiple custom attributes allowed) and the row's
  // own current type (so the SelectDropdown value still resolves to a label).
  function getAvailableTypesForOption(optIdx: number): AttributeType[] {
    const currentTypeId = options[optIdx]?.attribute_type_id
    const usedByOthers = new Set(
      options
        .filter((_, i) => i !== optIdx)
        .map(o => o.attribute_type_id)
    )
    return attributeTypes.filter(
      at => at.id === 'custom' || at.id === currentTypeId || !usedByOthers.has(at.id)
    )
  }

  return (
    <div className="space-y-3.5">
      {!hideToggle && (
        <>
          <div className="border-t border-edge" />
          <div className="flex items-center justify-between">
            <p className="text-label text-subtle">Variantes</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-subtle">Este producto tiene variantes</span>
              <button
                type="button"
                role="switch"
                aria-checked={hasVariants}
                onClick={() => onHasVariantsChange(!hasVariants)}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0 ${hasVariants ? 'bg-primary' : 'bg-input'}`}
                aria-label="Activar variantes"
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${hasVariants ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </>
      )}

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
            {options.map((option, optIdx) => {
              const isLocked = mode === 'edit' && !!option.id
              return (
                <div key={optIdx} className="rounded-xl border border-edge bg-surface p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    {isLocked ? (
                      // Locked existing option: show as static text
                      <span className="h-8 flex-1 flex items-center px-2 rounded-lg border border-edge bg-surface-alt text-sm text-subtle truncate">
                        {option.name}
                      </span>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <SelectDropdown
                          value={option.attribute_type_id}
                          onChange={typeId => updateOptionType(optIdx, typeId)}
                          options={getAvailableTypesForOption(optIdx).map(t => ({ value: t.id, label: t.label }))}
                        />
                      </div>
                    )}
                    {option.attribute_type_id === 'custom' && (
                      <Input
                        value={option.name}
                        onChange={e => updateOptionName(optIdx, e.target.value)}
                        placeholder="Nombre del atributo"
                        disabled={isLocked}
                        className="flex-1 min-w-0 disabled:opacity-60"
                      />
                    )}
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => removeOption(optIdx)}
                        className="shrink-0 p-1.5 rounded-lg text-hint hover:text-destructive hover:bg-destructive/10 transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-90"
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
                          className="text-hint hover:text-destructive transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-90 ml-0.5"
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
                        className="h-7 w-7 rounded-full border border-dashed border-edge bg-surface text-hint hover:text-primary hover:border-primary flex items-center justify-center transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-90"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {mode === 'new' && (
            <button
              type="button"
              onClick={addOption}
              className="flex items-center gap-1.5 text-xs text-primary/80 hover:text-primary transition-[transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar atributo
            </button>
          )}

          {/* Variants table */}
          {showTable && (
            <div className="space-y-2">
              {/* Filter pills — shown only when ≥2 attributes are defined */}
              {firstOption && firstOptionValues.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold text-subtle uppercase tracking-wider shrink-0">
                    {firstOption.name}:
                  </span>
                  <div className="flex gap-1.5 flex-wrap">
                    {firstOptionValues.map(val => (
                      <button
                        key={val.value}
                        type="button"
                        onClick={() => setFilterPillValue(val.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] ${
                          activeFilterPill === val.value
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-surface-alt border border-edge text-body hover:border-primary/50'
                        }`}
                      >
                        {val.value}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-edge">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-edge bg-surface-alt">
                        <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Default</th>
                        <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Variante</th>
                        <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Costo ({currencySymbol})</th>
                        <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Precio ({currencySymbol})</th>
                        <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Stock inicial</th>
                        <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Cód. de barras</th>
                        <th className="text-left px-3 py-2 font-medium text-subtle whitespace-nowrap">Imagen</th>
                        <th className="text-left px-3 py-2 font-medium text-subtle">Activo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge">
                      {displayedVariants.map((variant) => {
                        const varIdx = variants.indexOf(variant)
                        const isDefault = variant.combinationKey === defaultVariantKey

                        return (
                          <tr
                            key={variant.combinationKey}
                            className={!variant.is_active ? 'opacity-50 bg-surface' : 'bg-surface'}
                          >
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setDefaultVariantKey(variant.combinationKey)}
                                aria-label={`Marcar ${variant.label} como variante por defecto`}
                                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors ${isDefault ? 'border-primary bg-primary' : 'border-edge bg-surface hover:border-primary/60'}`}
                              >
                                {isDefault && (
                                  <span className="w-2 h-2 rounded-full bg-primary-foreground" />
                                )}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-body font-medium whitespace-nowrap">
                              {variant.label}
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
                                value={variant.barcode}
                                onChange={e => updateVariant(varIdx, 'barcode', e.target.value)}
                                placeholder="Ej: 7790001234567"
                                className="w-28 h-7 rounded-lg border border-edge bg-surface px-2 text-xs text-body tabular-nums focus:outline-none focus:border-primary"
                              />
                            </td>
                            <td className="px-3 py-2">
                              {(() => {
                                const key = variant.combinationKey
                                const imageTab = variantImageTabs[key] ?? (variant.image_source === 'url' ? 'url' : 'upload')
                                const urlInput = variantExternalUrlInputs[key] ?? (variant.image_source === 'url' ? variant.image_url ?? '' : '')
                                const urlError = variantUrlErrors[key] ?? ''
                                const imageError = variantImageErrors[key] ?? ''
                                return (
                                  <Popover
                                    open={openPopoverKey === key}
                                    onOpenChange={open => setOpenPopoverKey(open ? key : null)}
                                  >
                                    <PopoverTrigger asChild>
                                      <button
                                        type="button"
                                        className={[
                                          'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-[transform,background-color,border-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.97]',
                                          openPopoverKey === key
                                            ? 'border-primary bg-primary/10 text-primary'
                                            : 'border-edge bg-surface hover:border-primary/50 text-body',
                                        ].join(' ')}
                                      >
                                        <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-sm shrink-0">
                                          {variant.image_url ? (
                                            <img
                                              src={variant.image_url}
                                              alt={`Imagen de ${variant.label}`}
                                              className="h-full w-full object-cover rounded-sm"
                                            />
                                          ) : (
                                            <ImageIcon className="h-3.5 w-3.5 text-hint" />
                                          )}
                                        </span>
                                        Imagen
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-72 p-3 space-y-3" align="end" side="bottom" sideOffset={4}>
                                      {/* Header */}
                                      <div>
                                        <p className="text-[10px] font-semibold text-subtle uppercase tracking-widest">Imagen de variante</p>
                                        <p className="mt-1 text-sm font-medium text-body">{variant.label}</p>
                                        <p className="mt-0.5 text-xs text-hint">Si no cargas imagen, se usa la foto del producto base.</p>
                                      </div>

                                      {/* Preview */}
                                      <div className="overflow-hidden rounded-xl border border-edge bg-surface-alt">
                                        {variant.image_url ? (
                                          <img
                                            src={variant.image_url}
                                            alt={`Vista previa de ${variant.label}`}
                                            className="max-h-[120px] w-full object-contain"
                                          />
                                        ) : (
                                          <div className="flex h-[120px] w-full flex-col items-center justify-center gap-2 text-hint">
                                            <ImageIcon className="h-6 w-6" />
                                            <p className="text-xs">Sin imagen propia</p>
                                          </div>
                                        )}
                                      </div>

                                      {/* Tabs */}
                                      <div className="rounded-xl border border-edge overflow-hidden">
                                        <div className="flex border-b border-edge">
                                          <button
                                            type="button"
                                            onClick={() => setVariantImageTabs(prev => ({ ...prev, [key]: 'upload' }))}
                                            className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${imageTab === 'upload' ? 'bg-surface text-body border-b-2 border-primary' : 'bg-surface-alt text-hint hover:text-subtle'}`}
                                          >
                                            Subir archivo
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setVariantImageTabs(prev => ({ ...prev, [key]: 'url' }))}
                                            className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${imageTab === 'url' ? 'bg-surface text-body border-b-2 border-primary' : 'bg-surface-alt text-hint hover:text-subtle'}`}
                                          >
                                            URL externa
                                          </button>
                                        </div>
                                        <div className="p-3">
                                          {imageTab === 'upload' && (
                                            <label className="flex flex-col items-center gap-2 cursor-pointer rounded-xl border border-dashed border-edge bg-surface px-4 py-4 hover:border-primary/40 transition-colors">
                                              <Upload className="h-5 w-5 text-hint" />
                                              <span className="text-xs text-hint text-center">
                                                {uploadingVariantKey === key ? 'Subiendo...' : 'Arrastra o haz clic para seleccionar'}
                                              </span>
                                              <span className="text-[10px] text-hint">PNG, JPG, WebP · máx. 2 MB</span>
                                              <input
                                                type="file"
                                                accept="image/*"
                                                className="sr-only"
                                                disabled={uploadingVariantKey === key}
                                                onChange={e => {
                                                  const file = e.target.files?.[0]
                                                  if (file) void handleVariantFileUpload(key, file)
                                                }}
                                              />
                                            </label>
                                          )}
                                          {imageTab === 'upload' && imageError && (
                                            <p className="mt-1 text-caption text-destructive">{imageError}</p>
                                          )}
                                          {imageTab === 'url' && (
                                            <div className="flex flex-col gap-2">
                                              <div className="flex gap-2">
                                                <Input
                                                  value={urlInput}
                                                  onChange={e => {
                                                    setVariantExternalUrlInputs(prev => ({ ...prev, [key]: e.target.value }))
                                                    setVariantUrlErrors(prev => ({ ...prev, [key]: '' }))
                                                  }}
                                                  placeholder="https://..."
                                                  aria-invalid={!!urlError}
                                                />
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const error = validateImageUrl(urlInput)
                                                    setVariantUrlErrors(prev => ({ ...prev, [key]: error }))
                                                    if (!error && urlInput) {
                                                      updateVariantByKey(key, { image_url: urlInput, image_source: 'url' })
                                                    }
                                                  }}
                                                  className="h-9 shrink-0 rounded-lg bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                                                >
                                                  OK
                                                </button>
                                              </div>
                                              {urlError && <p className="text-caption text-destructive">{urlError}</p>}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* Remove */}
                                      {variant.image_url && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            updateVariantByKey(key, { image_url: null, image_source: null })
                                            setVariantExternalUrlInputs(prev => ({ ...prev, [key]: '' }))
                                            setVariantUrlErrors(prev => ({ ...prev, [key]: '' }))
                                            setVariantImageErrors(prev => ({ ...prev, [key]: '' }))
                                          }}
                                          className="text-left text-xs text-destructive hover:text-destructive/80"
                                        >
                                          Quitar imagen
                                        </button>
                                      )}
                                    </PopoverContent>
                                  </Popover>
                                )
                              })()}
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
                        )
                      })}
                    </tbody>
                  </table>
                </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
