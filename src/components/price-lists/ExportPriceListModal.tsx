'use client'

import { useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { usePillIndicator } from '@/hooks/usePillIndicator'

type ExportScope = 'all' | 'brands' | 'categories' | 'products'

interface ExportScopeOption {
  value: ExportScope
  label: string
}

interface ExportOption {
  value: string
  label: string
  subtitle?: string
  count?: number
}

export interface PriceListExportItem {
  productId: string
  productName: string
  brandId: string | null
  brandName: string | null
  categoryId: string | null
  categoryName: string | null
  cost: number
  basePrice: number
  listPrice: number
  marginPercent: number | null
  multiplier: number
  hasOverride: boolean
}

interface ExportPriceListModalProps {
  open: boolean
  onClose: () => void
  priceListName: string
  items: PriceListExportItem[]
}

const NO_BRAND_KEY = '__no_brand__'
const NO_CATEGORY_KEY = '__no_category__'

const scopeOptions: ExportScopeOption[] = [
  { value: 'all', label: 'Toda la lista' },
  { value: 'brands', label: 'Por marcas' },
  { value: 'categories', label: 'Por categorías' },
  { value: 'products', label: 'Por productos' },
]

function sortByLabel(options: ExportOption[]): ExportOption[] {
  return [...options].sort((a, b) =>
    a.label.localeCompare(b.label, 'es', { sensitivity: 'base' })
  )
}

function getListSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'lista-precios'
}

function toggleArrayValue(values: string[], value: string): string[] {
  if (values.includes(value)) {
    return values.filter(item => item !== value)
  }

  return [...values, value]
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values))
}

export default function ExportPriceListModal({
  open,
  onClose,
  priceListName,
  items,
}: ExportPriceListModalProps) {
  const [scope, setScope] = useState<ExportScope>('all')
  const [search, setSearch] = useState('')
  const [selectedBrandKeys, setSelectedBrandKeys] = useState<string[]>([])
  const [selectedCategoryKeys, setSelectedCategoryKeys] = useState<string[]>([])
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const { setRef, indicator } = usePillIndicator(scope)

  const brandOptions = useMemo(() => {
    const grouped = new Map<string, ExportOption>()

    for (const item of items) {
      const key = item.brandId ?? NO_BRAND_KEY
      const existing = grouped.get(key)

      if (existing) {
        grouped.set(key, { ...existing, count: (existing.count ?? 0) + 1 })
        continue
      }

      grouped.set(key, {
        value: key,
        label: item.brandName ?? 'Sin marca',
        count: 1,
      })
    }

    return sortByLabel(Array.from(grouped.values()))
  }, [items])

  const categoryOptions = useMemo(() => {
    const grouped = new Map<string, ExportOption>()

    for (const item of items) {
      const key = item.categoryId ?? NO_CATEGORY_KEY
      const existing = grouped.get(key)

      if (existing) {
        grouped.set(key, { ...existing, count: (existing.count ?? 0) + 1 })
        continue
      }

      grouped.set(key, {
        value: key,
        label: item.categoryName ?? 'Sin categoría',
        count: 1,
      })
    }

    return sortByLabel(Array.from(grouped.values()))
  }, [items])

  const productOptions = useMemo(() => {
    const options = items.map(item => ({
      value: item.productId,
      label: item.productName,
      subtitle: `${item.brandName ?? 'Sin marca'} · ${item.categoryName ?? 'Sin categoría'}`,
    }))

    return sortByLabel(options)
  }, [items])

  const activeOptions = useMemo(() => {
    switch (scope) {
      case 'brands':
        return brandOptions
      case 'categories':
        return categoryOptions
      case 'products':
        return productOptions
      default:
        return []
    }
  }, [scope, brandOptions, categoryOptions, productOptions])

  const filteredOptions = useMemo(() => {
    if (scope === 'all') return []

    const query = search.trim().toLowerCase()
    if (!query) return activeOptions

    return activeOptions.filter(option => {
      return (
        option.label.toLowerCase().includes(query) ||
        (option.subtitle ?? '').toLowerCase().includes(query)
      )
    })
  }, [scope, search, activeOptions])

  const selectedValues = useMemo(() => {
    switch (scope) {
      case 'brands':
        return selectedBrandKeys
      case 'categories':
        return selectedCategoryKeys
      case 'products':
        return selectedProductIds
      default:
        return []
    }
  }, [scope, selectedBrandKeys, selectedCategoryKeys, selectedProductIds])

  const selectedValueSet = useMemo(() => new Set(selectedValues), [selectedValues])

  const exportItems = useMemo(() => {
    switch (scope) {
      case 'brands': {
        if (selectedBrandKeys.length === 0) return []
        const selected = new Set(selectedBrandKeys)

        return items.filter(item => selected.has(item.brandId ?? NO_BRAND_KEY))
      }
      case 'categories': {
        if (selectedCategoryKeys.length === 0) return []
        const selected = new Set(selectedCategoryKeys)

        return items.filter(item => selected.has(item.categoryId ?? NO_CATEGORY_KEY))
      }
      case 'products': {
        if (selectedProductIds.length === 0) return []
        const selected = new Set(selectedProductIds)

        return items.filter(item => selected.has(item.productId))
      }
      default:
        return items
    }
  }, [scope, selectedBrandKeys, selectedCategoryKeys, selectedProductIds, items])

  const csvData = useMemo(() => {
    return exportItems.map(item => ({
      lista: priceListName,
      producto: item.productName,
      marca: item.brandName ?? 'Sin marca',
      categoria: item.categoryName ?? 'Sin categoría',
      costo: item.cost.toFixed(2),
      precio_base: item.basePrice.toFixed(2),
      precio_lista: item.listPrice.toFixed(2),
      margen_porcentaje: item.marginPercent === null ? '' : String(item.marginPercent),
      multiplicador: item.multiplier.toFixed(4),
      override: item.hasOverride ? 'si' : 'no',
    }))
  }, [exportItems, priceListName])

  const filename = useMemo(() => {
    const date = new Date().toISOString().slice(0, 10)
    return `${getListSlug(priceListName)}-${date}`
  }, [priceListName])

  function handleClose() {
    onClose()
  }

  function toggleCurrentOption(value: string) {
    switch (scope) {
      case 'brands':
        setSelectedBrandKeys(prev => toggleArrayValue(prev, value))
        return
      case 'categories':
        setSelectedCategoryKeys(prev => toggleArrayValue(prev, value))
        return
      case 'products':
        setSelectedProductIds(prev => toggleArrayValue(prev, value))
        return
      default:
        return
    }
  }

  function selectVisibleOptions() {
    const values = filteredOptions.map(option => option.value)

    switch (scope) {
      case 'brands':
        setSelectedBrandKeys(prev => uniqueValues([...prev, ...values]))
        return
      case 'categories':
        setSelectedCategoryKeys(prev => uniqueValues([...prev, ...values]))
        return
      case 'products':
        setSelectedProductIds(prev => uniqueValues([...prev, ...values]))
        return
      default:
        return
    }
  }

  function clearCurrentSelection() {
    switch (scope) {
      case 'brands':
        setSelectedBrandKeys([])
        return
      case 'categories':
        setSelectedCategoryKeys([])
        return
      case 'products':
        setSelectedProductIds([])
        return
      default:
        return
    }
  }

  const exportLabel =
    exportItems.length === 0
      ? 'Exportar CSV'
      : `Exportar ${exportItems.length} producto${exportItems.length === 1 ? '' : 's'}`

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[760px] p-0 gap-0 rounded-2xl overflow-hidden bg-app-bg max-h-[88vh] flex flex-col" showCloseButton={false}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-heading">Exportar lista de precios</h2>
            <p className="text-xs text-subtle truncate">{priceListName}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-hint hover:text-body transition-colors p-0.5"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex-1 overflow-y-auto flex flex-col gap-4">
          <div className="pill-tabs flex-nowrap overflow-x-auto no-scrollbar">
            {indicator && (
              <span
                className="pill-tab-indicator"
                style={{
                  transform: `translateX(${indicator.left}px)`,
                  width: indicator.width,
                }}
              />
            )}
            {scopeOptions.map(option => (
              <button
                key={option.value}
                type="button"
                ref={setRef(option.value)}
                onClick={() => {
                  setScope(option.value)
                  setSearch('')
                }}
                className={`pill-tab${scope === option.value ? ' pill-tab-active' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {scope === 'all' ? (
            <div className="rounded-xl border border-edge bg-surface-alt px-3 py-3 text-sm text-body">
              Se exportarán todos los productos de esta lista de precios ({items.length} en total).
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-hint pointer-events-none" />
                  <Input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Buscar para filtrar la selección..."
                    className="h-9 rounded-xl pl-8 text-sm bg-surface border-edge focus-visible:ring-ring/50 focus-visible:border-ring"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-subtle">
                    Seleccionados: {selectedValues.length} · Resultados: {filteredOptions.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-lg text-xs"
                      onClick={selectVisibleOptions}
                      disabled={filteredOptions.length === 0}
                    >
                      Seleccionar visibles
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-lg text-xs"
                      onClick={clearCurrentSelection}
                      disabled={selectedValues.length === 0}
                    >
                      Limpiar
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-edge bg-surface-alt overflow-hidden">
                <div className="max-h-72 overflow-y-auto divide-y divide-edge/60">
                  {filteredOptions.length === 0 ? (
                    <p className="px-3 py-6 text-sm text-hint text-center">
                      No hay coincidencias con la búsqueda actual.
                    </p>
                  ) : (
                    filteredOptions.map(option => (
                      <label
                        key={option.value}
                        className="flex items-start gap-3 px-3 py-2 text-sm text-body hover:bg-hover-bg transition-colors cursor-pointer"
                      >
                        <span className="relative mt-0.5 shrink-0">
                          <input
                            type="checkbox"
                            checked={selectedValueSet.has(option.value)}
                            onChange={() => toggleCurrentOption(option.value)}
                            className="peer sr-only"
                          />
                          <span className="flex h-4 w-4 items-center justify-center rounded border border-edge bg-surface transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50">
                            <Check size={11} className="text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-heading truncate">{option.label}</span>
                          {(option.subtitle ?? option.count) && (
                            <span className="block text-xs text-hint truncate">
                              {option.subtitle ?? `${option.count} producto${option.count === 1 ? '' : 's'}`}
                            </span>
                          )}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-edge flex items-center justify-between gap-3">
          <p className="text-xs text-subtle">
            Se exportarán {exportItems.length} producto{exportItems.length === 1 ? '' : 's'}.
          </p>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="cancel"
              size="sm"
              className="rounded-lg text-xs"
              onClick={handleClose}
            >
              Cerrar
            </Button>
            <ExportCSVButton
              data={csvData}
              filename={filename}
              label={exportLabel}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
