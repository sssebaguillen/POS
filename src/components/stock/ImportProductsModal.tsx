'use client'

import { useMemo, useRef, useState } from 'react'
import * as XLSX from '@e965/xlsx'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { InventoryBrand, InventoryCategory, InventoryProduct } from '@/components/stock/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SystemField =
  | 'name'
  | 'sku'
  | 'barcode'
  | 'price'
  | 'cost'
  | 'stock'
  | 'min_stock'
  | 'category'
  | 'brand'
  | 'is_active'
  | 'ignore'

interface ColumnMapping {
  index: number        // column position in the file
  fileHeader: string   // display name from the header row (may be empty)
  systemField: SystemField
}

// Indexed by column position — immune to empty or duplicate header names
type ParsedRow = string[]

interface ResolvedRow {
  name: string
  sku: string | null
  barcode: string | null
  price: number
  cost: number
  stock: number
  min_stock: number
  category_name: string | null
  brand_name: string | null
  is_active: boolean
}

interface Props {
  businessId: string
  categories: InventoryCategory[]
  brands: InventoryBrand[]
  onImported: () => void
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Alias map — what file column names map to which system fields
// ---------------------------------------------------------------------------

const FIELD_ALIASES: Record<SystemField, string[]> = {
  name: ['nombre', 'producto', 'product', 'descripcion', 'description', 'item', 'articulo', 'name'],
  sku: ['sku', 'codigo', 'code', 'cod', 'codigo_interno', 'internal_code'],
  barcode: ['barcode', 'codigo_barra', 'codigo_barras', 'ean', 'upc', 'barra', 'gtin'],
  price: ['precio', 'price', 'pvp', 'precio_venta', 'venta', 'sale_price'],
  cost: ['costo', 'cost', 'precio_costo', 'costo_unitario', 'unit_cost'],
  stock: ['stock', 'cantidad', 'qty', 'quantity', 'unidades', 'existencia', 'existencias', 'inventario'],
  min_stock: ['stock_minimo', 'min_stock', 'minimo', 'minimum', 'stock_min', 'minstock'],
  category: ['categoria', 'category', 'cat', 'rubro', 'familia'],
  brand: ['marca', 'brand', 'fabricante', 'manufacturer', 'proveedor_marca'],
  is_active: ['activo', 'active', 'estado', 'status', 'habilitado', 'enabled'],
  ignore: [],
}

const FIELD_LABELS: Record<SystemField, string> = {
  name: 'Nombre',
  sku: 'SKU',
  barcode: 'Codigo de barras',
  price: 'Precio de venta',
  cost: 'Costo',
  stock: 'Stock',
  min_stock: 'Stock minimo',
  category: 'Categoria',
  brand: 'Marca',
  is_active: 'Activo',
  ignore: 'Ignorar columna',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeKey(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-_]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

/** Normalize a string for fuzzy brand/category matching */
function normalizeName(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-_]+/g, '')
}

function detectField(rawHeader: string): SystemField {
  const key = normalizeKey(rawHeader)
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [SystemField, string[]][]) {
    if (field === 'ignore') continue
    if (aliases.some(alias => normalizeKey(alias) === key)) return field
  }
  return 'ignore'
}

function parseBoolean(val: string): boolean {
  const v = val.trim().toLowerCase()
  return v === 'true' || v === 'si' || v === 'yes' || v === '1' || v === 'activo' || v === 'active'
}

function sanitizeText(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val).trim().slice(0, 500)
}

function parseNumber(val: string): number {
  const cleaned = val.replace(/[^0-9.,]/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : Math.max(0, n)
}

function parseInteger(val: string): number {
  const n = parseInt(val.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : Math.max(0, n)
}

async function insertInBatches<T extends object>(
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: T[],
  batchSize = 200,
): Promise<string | null> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)
    if (error) return error.message
  }
  return null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImportProductsModal({
  businessId,
  categories: initialCategories,
  brands: initialBrands,
  onImported,
  onClose,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // step: 'upload' | 'mapping' | 'preview'
  const [step, setStep] = useState<'upload' | 'mapping' | 'preview'>('upload')
  const [fileName, setFileName] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([])

  // Resolved preview data (computed at preview step)
  const [resolvedRows, setResolvedRows] = useState<ResolvedRow[]>([])
  const [newBrandNames, setNewBrandNames] = useState<string[]>([])
  const [newCategoryNames, setNewCategoryNames] = useState<string[]>([])

  function processFile(file: File) {
    setParseError(null)
    const allowed = ['.xlsx', '.xls', '.csv', '.ods']
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!allowed.includes(ext)) {
      setParseError(`Formato no soportado: ${ext}. Usa .xlsx, .xls, .csv u .ods`)
      return
    }

    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = e.target?.result
        const wb = XLSX.read(data, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

        if (!raw || raw.length < 2) {
          setParseError('El archivo no tiene datos suficientes (necesita al menos una fila de encabezado y una de datos).')
          return
        }

        // Find the row with the most non-empty cells among the first 5 rows —
        // that is the header row. Title rows and group headers typically have
        // far fewer filled cells than the actual column-name row.
        const scanLimit = Math.min(5, raw.length)
        let headerRowIndex = 0
        let maxNonEmpty = 0
        for (let i = 0; i < scanLimit; i++) {
          const nonEmpty = (raw[i] as unknown[])
            .map(h => sanitizeText(h))
            .filter(h => h.length > 0).length
          if (nonEmpty > maxNonEmpty) {
            maxNonEmpty = nonEmpty
            headerRowIndex = i
          }
        }

        if (maxNonEmpty === 0) {
          setParseError('El archivo no tiene encabezados reconocibles.')
          return
        }

        const headers = (raw[headerRowIndex] as unknown[]).map(h => sanitizeText(h))
        const dataRows = raw.slice(headerRowIndex + 1).filter(row =>
          (row as unknown[]).some(cell => sanitizeText(cell).length > 0)
        )

        if (dataRows.length === 0) {
          setParseError('El archivo no tiene filas de datos.')
          return
        }

        // Use index-based rows so empty/duplicate header names don't collapse data
        const rows: ParsedRow[] = dataRows.map(row =>
          headers.map((_, i) => sanitizeText((row as unknown[])[i]))
        )

        const mappings: ColumnMapping[] = headers.map((header, i) => ({
          index: i,
          fileHeader: header,
          systemField: detectField(header),
        }))

        setParsedRows(rows)
        setColumnMappings(mappings)

        // Check if name was auto-detected — if yes and all others are fine, skip to preview step
        const hasName = mappings.some(m => m.systemField === 'name')
        if (hasName) {
          buildResolvedRows(rows, mappings)
          setStep('preview')
        } else {
          setStep('mapping')
        }
      } catch {
        setParseError('No se pudo leer el archivo. Asegurate de que sea un archivo Excel o CSV valido.')
      }
    }
    reader.readAsBinaryString(file)
  }

  function buildResolvedRows(rows: ParsedRow[], mappings: ColumnMapping[]) {
    // Build index lookup: field -> first column index assigned to it
    const fieldToIndex: Partial<Record<SystemField, number>> = {}
    for (const m of mappings) {
      if (m.systemField === 'ignore') continue
      if (!(m.systemField in fieldToIndex)) {
        fieldToIndex[m.systemField] = m.index
      }
    }

    const resolved: ResolvedRow[] = []
    const uniqueBrandNames = new Set<string>()
    const uniqueCategoryNames = new Set<string>()

    for (const row of rows) {
      const get = (field: SystemField): string => {
        const idx = fieldToIndex[field]
        return idx !== undefined ? (row[idx] ?? '') : ''
      }

      const name = sanitizeText(get('name'))
      if (!name) continue

      const brandRaw = sanitizeText(get('brand'))
      const categoryRaw = sanitizeText(get('category'))
      const isActiveRaw = sanitizeText(get('is_active'))

      if (brandRaw) uniqueBrandNames.add(brandRaw)
      if (categoryRaw) uniqueCategoryNames.add(categoryRaw)

      resolved.push({
        name,
        sku: sanitizeText(get('sku')) || null,
        barcode: sanitizeText(get('barcode')) || null,
        price: parseNumber(get('price')),
        cost: parseNumber(get('cost')),
        stock: parseInteger(get('stock')),
        min_stock: parseInteger(get('min_stock')),
        category_name: categoryRaw || null,
        brand_name: brandRaw || null,
        is_active: isActiveRaw ? parseBoolean(isActiveRaw) : true,
      })
    }

    // Identify brand names that don't exist yet (fuzzy match)
    const genuinelyNewBrands = Array.from(uniqueBrandNames).filter(name => {
      const norm = normalizeName(name)
      return !initialBrands.some(b => normalizeName(b.name) === norm)
    })

    // Identify category names that don't exist yet (fuzzy match)
    const genuinelyNewCategories = Array.from(uniqueCategoryNames).filter(name => {
      const norm = normalizeName(name)
      return !initialCategories.some(c => normalizeName(c.name) === norm)
    })

    setResolvedRows(resolved)
    setNewBrandNames(genuinelyNewBrands)
    setNewCategoryNames(genuinelyNewCategories)
  }

  function handleMappingChange(columnIndex: number, systemField: SystemField) {
    setColumnMappings(prev =>
      prev.map(m => m.index === columnIndex ? { ...m, systemField } : m)
    )
  }

  function handleMappingConfirm() {
    const hasName = columnMappings.some(m => m.systemField === 'name')
    if (!hasName) {
      setParseError('Debes asignar al menos la columna "Nombre" para continuar.')
      return
    }
    buildResolvedRows(parsedRows, columnMappings)
    setStep('preview')
  }

  async function handleConfirmImport() {
    if (!businessId) return
    setImporting(true)
    setImportError(null)

    try {
      // 1. Create new brands
      const allBrands = [...initialBrands]
      if (newBrandNames.length > 0) {
        const toInsert = newBrandNames.map(name => ({ business_id: businessId, name }))
        const { data: createdBrands, error: brandError } = await supabase
          .from('brands')
          .insert(toInsert)
          .select('id, name')
        if (brandError) throw new Error(`Error al crear marcas: ${brandError.message}`)
        if (createdBrands) allBrands.push(...createdBrands)
      }

      // 2. Create new categories
      const allCategories = [...initialCategories]
      if (newCategoryNames.length > 0) {
        const { data: maxPosData } = await supabase
          .from('categories')
          .select('position')
          .eq('business_id', businessId)
          .order('position', { ascending: false })
          .limit(1)

        const maxPos = maxPosData?.[0]?.position ?? 0
        const toInsert = newCategoryNames.map((name, i) => ({
          business_id: businessId,
          name,
          icon: '📦',
          position: maxPos + i + 1,
          is_active: true,
        }))
        const { data: createdCats, error: catError } = await supabase
          .from('categories')
          .insert(toInsert)
          .select('id, name, icon')
        if (catError) throw new Error(`Error al crear categorias: ${catError.message}`)
        if (createdCats) allCategories.push(...createdCats)
      }

      // 3. Build product rows with resolved FKs
      const withSku: object[] = []
      const withBarcode: object[] = []
      const plain: object[] = []

      for (const row of resolvedRows) {
        const brandId = row.brand_name
          ? allBrands.find(b => normalizeName(b.name) === normalizeName(row.brand_name!))?.id ?? null
          : null
        const categoryId = row.category_name
          ? allCategories.find(c => normalizeName(c.name) === normalizeName(row.category_name!))?.id ?? null
          : null

        const productRow = {
          business_id: businessId,
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          price: row.price,
          cost: row.cost,
          stock: row.stock,
          min_stock: row.min_stock,
          is_active: row.is_active,
          brand_id: brandId,
          category_id: categoryId,
        }

        if (row.sku) {
          withSku.push(productRow)
        } else if (row.barcode) {
          withBarcode.push(productRow)
        } else {
          plain.push(productRow)
        }
      }

      // 4. Upsert rows with SKU
      if (withSku.length > 0) {
        for (let i = 0; i < withSku.length; i += 200) {
          const batch = withSku.slice(i, i + 200)
          const { error } = await supabase
            .from('products')
            .upsert(batch, {
              onConflict: 'business_id,sku',
              ignoreDuplicates: false,
            })
          if (error) throw new Error(`Error al importar productos (SKU): ${error.message}`)
        }
      }

      // 5. Upsert rows with barcode (no SKU)
      if (withBarcode.length > 0) {
        for (let i = 0; i < withBarcode.length; i += 200) {
          const batch = withBarcode.slice(i, i + 200)
          const { error } = await supabase
            .from('products')
            .upsert(batch, {
              onConflict: 'business_id,barcode',
              ignoreDuplicates: false,
            })
          if (error) throw new Error(`Error al importar productos (barcode): ${error.message}`)
        }
      }

      // 6. Insert rows with neither
      if (plain.length > 0) {
        const err = await insertInBatches(supabase, 'products', plain)
        if (err) throw new Error(`Error al importar productos: ${err}`)
      }

      onImported()
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Error desconocido al importar.')
    } finally {
      setImporting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const systemFieldOptions = (Object.keys(FIELD_LABELS) as SystemField[]).map(f => ({
    value: f,
    label: FIELD_LABELS[f],
  }))

  const previewRows = resolvedRows.slice(0, 10)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={!importing ? onClose : undefined} />

      <div className="relative surface-elevated rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-edge/60 shrink-0">
          <div>
            <h2 className="text-heading font-semibold">Importar productos</h2>
            <p className="text-caption text-hint mt-0.5">
              {step === 'upload' && 'Selecciona un archivo Excel o CSV'}
              {step === 'mapping' && 'Asigna las columnas de tu archivo a los campos del sistema'}
              {step === 'preview' && `${resolvedRows.length} productos listos para importar`}
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mr-6">
            {(['upload', 'mapping', 'preview'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold
                  ${step === s ? 'bg-primary text-primary-foreground' :
                    (['upload', 'mapping', 'preview'].indexOf(step) > i)
                      ? 'bg-emerald-500 text-white'
                      : 'bg-surface-alt text-hint'}`}
                >
                  {i + 1}
                </div>
                {i < 2 && <div className="w-4 h-px bg-edge" />}
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            disabled={importing}
            className="text-hint hover:text-body transition-colors disabled:opacity-50"
            aria-label="Cerrar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {/* ---------------------------------------------------------------- */}
          {/* STEP 1: UPLOAD                                                   */}
          {/* ---------------------------------------------------------------- */}
          {step === 'upload' && (
            <div className="p-6">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.ods"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) processFile(file)
                  e.target.value = ''
                }}
              />

              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setIsDragging(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) processFile(file)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed transition-colors cursor-pointer p-12 text-center
                  ${isDragging ? 'border-primary bg-primary/5' : 'border-edge/60 hover:border-primary/40 hover:bg-surface-alt/50'}`}
              >
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-surface-alt border border-edge flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-hint">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-body font-medium text-heading">
                      {fileName ?? 'Arrastra tu archivo aqui o hace clic para seleccionar'}
                    </p>
                    <p className="text-caption text-hint mt-1">
                      Formatos soportados: .xlsx, .xls, .csv, .ods
                    </p>
                  </div>
                  {!fileName && (
                    <Button variant="outline" size="sm" className="rounded-lg text-xs mt-1">
                      Seleccionar archivo
                    </Button>
                  )}
                </div>
              </div>

              {parseError && (
                <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {parseError}
                </p>
              )}

              <div className="mt-6 rounded-xl bg-surface-alt border border-edge/60 p-4">
                <p className="text-caption font-medium text-heading mb-2">Columnas reconocidas automaticamente</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {(Object.entries(FIELD_ALIASES) as [SystemField, string[]][])
                    .filter(([field]) => field !== 'ignore')
                    .map(([field, aliases]) => (
                      <div key={field} className="flex items-baseline gap-1.5">
                        <span className="text-caption font-medium text-body w-28 shrink-0">{FIELD_LABELS[field]}</span>
                        <span className="text-label text-hint truncate">{aliases.slice(0, 4).join(', ')}{aliases.length > 4 ? '...' : ''}</span>
                      </div>
                    ))}
                </div>
                <p className="text-label text-hint mt-3">El sistema tambien reconoce variantes con acentos, mayusculas, guiones y espacios.</p>
              </div>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* STEP 2: MAPPING                                                  */}
          {/* ---------------------------------------------------------------- */}
          {step === 'mapping' && (
            <div className="p-6">
              <p className="text-body-sm text-hint mb-4">
                Algunas columnas no fueron reconocidas automaticamente. Asignalas manualmente o marcalas como "Ignorar".
              </p>

              <div className="rounded-xl border border-edge/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-alt border-b border-edge/60">
                      <th className="text-left px-4 py-3 text-caption font-medium text-hint">Columna en el archivo</th>
                      <th className="text-left px-4 py-3 text-caption font-medium text-hint">Campo en el sistema</th>
                      <th className="text-left px-4 py-3 text-caption font-medium text-hint">Ejemplo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columnMappings.map(m => {
                      const example = parsedRows[0]?.[m.index] ?? ''
                      const displayHeader = m.fileHeader || `(Columna ${m.index + 1})`
                      return (
                        <tr key={m.index} className="border-b border-edge/40 last:border-0">
                          <td className="px-4 py-3 font-medium text-body">{displayHeader}</td>
                          <td className="px-4 py-3 w-52">
                            <SelectDropdown
                              value={m.systemField}
                              onChange={(val) => handleMappingChange(m.index, val as SystemField)}
                              options={systemFieldOptions}
                              className="h-8 text-xs"
                              usePortal
                            />
                          </td>
                          <td className="px-4 py-3 text-hint text-xs max-w-[160px] truncate">{example || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {parseError && (
                <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {parseError}
                </p>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* STEP 3: PREVIEW                                                  */}
          {/* ---------------------------------------------------------------- */}
          {step === 'preview' && (
            <div className="p-6">
              {/* Notices */}
              {newBrandNames.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  <span className="font-semibold">{newBrandNames.length} marca{newBrandNames.length > 1 ? 's' : ''} nueva{newBrandNames.length > 1 ? 's' : ''} seran creadas:</span>{' '}
                  {newBrandNames.join(', ')}
                </div>
              )}
              {newCategoryNames.length > 0 && (
                <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  <span className="font-semibold">{newCategoryNames.length} categoria{newCategoryNames.length > 1 ? 's' : ''} nueva{newCategoryNames.length > 1 ? 's' : ''} seran creadas:</span>{' '}
                  {newCategoryNames.join(', ')}
                </div>
              )}
              {resolvedRows.some(r => r.sku || r.barcode) && (
                <div className="mb-3 rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm text-blue-700 dark:text-blue-400">
                  Los productos con SKU o codigo de barras existente seran actualizados en lugar de duplicarse.
                </div>
              )}

              {/* Preview table */}
              <div className="rounded-xl border border-edge/60 overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead>
                    <tr className="bg-surface-alt border-b border-edge/60">
                      <th className="text-left px-3 py-2.5 font-medium text-hint">Nombre</th>
                      <th className="text-left px-3 py-2.5 font-medium text-hint">SKU</th>
                      <th className="text-right px-3 py-2.5 font-medium text-hint">Precio</th>
                      <th className="text-right px-3 py-2.5 font-medium text-hint">Costo</th>
                      <th className="text-right px-3 py-2.5 font-medium text-hint">Stock</th>
                      <th className="text-left px-3 py-2.5 font-medium text-hint">Categoria</th>
                      <th className="text-left px-3 py-2.5 font-medium text-hint">Marca</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b border-edge/40 last:border-0">
                        <td className="px-3 py-2 font-medium text-body max-w-[180px] truncate">{row.name}</td>
                        <td className="px-3 py-2 text-hint">{row.sku ?? '—'}</td>
                        <td className="px-3 py-2 text-right text-body">{row.price > 0 ? `$${row.price.toLocaleString('es-AR')}` : '—'}</td>
                        <td className="px-3 py-2 text-right text-hint">{row.cost > 0 ? `$${row.cost.toLocaleString('es-AR')}` : '—'}</td>
                        <td className="px-3 py-2 text-right text-body">{row.stock}</td>
                        <td className="px-3 py-2 text-hint max-w-[120px] truncate">{row.category_name ?? '—'}</td>
                        <td className="px-3 py-2 text-hint max-w-[120px] truncate">{row.brand_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {resolvedRows.length > 10 && (
                <p className="text-caption text-hint mt-2">
                  Mostrando 10 de {resolvedRows.length} filas.
                </p>
              )}

              {importError && (
                <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {importError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-edge/60 shrink-0 bg-surface">
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg text-xs"
            onClick={() => {
              if (step === 'mapping') setStep('upload')
              else if (step === 'preview') setStep(columnMappings.some(m => m.systemField === 'ignore' || parsedRows.length === 0) ? 'mapping' : 'upload')
              else onClose()
            }}
            disabled={importing}
          >
            {step === 'upload' ? 'Cancelar' : 'Atras'}
          </Button>

          {step === 'mapping' && (
            <Button
              size="sm"
              className="rounded-lg text-xs btn-primary-gradient"
              onClick={handleMappingConfirm}
            >
              Continuar
            </Button>
          )}

          {step === 'preview' && (
            <Button
              size="sm"
              className="rounded-lg text-xs btn-primary-gradient"
              onClick={handleConfirmImport}
              disabled={importing || resolvedRows.length === 0}
            >
              {importing ? 'Importando...' : `Importar ${resolvedRows.length} producto${resolvedRows.length !== 1 ? 's' : ''}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
