'use client'

import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type {
  BulkData,
  ProductData,
  ProductOptionSnapshot,
  ProductVariantSnapshot,
  ProductVariantsData,
} from '@/components/activity/payloads'
import type { ActivityLookups } from '@/components/activity/types'
import { DeletedBadge, DiffRow, Stat, toNumber } from '@/components/activity/detail/shared'

const PRODUCT_FIELD_LABELS: Record<keyof ProductData, string> = {
  name: 'Nombre',
  price: 'Precio',
  cost: 'Costo',
  stock: 'Stock',
  min_stock: 'Stock mínimo',
  is_active: 'Estado',
  category_id: 'Categoría',
  brand_id: 'Marca',
}

const PRODUCT_FIELD_ORDER: (keyof ProductData)[] = [
  'name',
  'price',
  'cost',
  'stock',
  'min_stock',
  'is_active',
  'category_id',
  'brand_id',
]

interface ProductSummaryProps {
  data: ProductData | null
  lookups: ActivityLookups
  deleted?: boolean
}

export function ProductSummary({ data, lookups, deleted = false }: ProductSummaryProps) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const categoryName = data.category_id ? lookups.categoryMap[data.category_id]?.name ?? null : null
  const brandName = data.brand_id ? lookups.brandMap[data.brand_id] ?? null : null

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && <DeletedBadge label="Eliminado" />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={data.name} />}
        {data.price !== undefined && <Stat label="Precio" value={formatMoney(toNumber(data.price))} />}
        {data.cost !== undefined && <Stat label="Costo" value={formatMoney(toNumber(data.cost))} />}
        {data.stock !== undefined && <Stat label="Stock" value={String(toNumber(data.stock))} />}
        {categoryName !== null && <Stat label="Categoría" value={categoryName} />}
        {brandName !== null && <Stat label="Marca" value={brandName} />}
      </div>
    </div>
  )
}

interface ProductDiffProps {
  oldData: ProductData | null
  newData: ProductData | null
  lookups: ActivityLookups
}

export function ProductDiff({ oldData, newData, lookups }: ProductDiffProps) {
  const formatMoney = useFormatMoney()
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const changes: { label: string; before: string; after: string }[] = []

  for (const key of PRODUCT_FIELD_ORDER) {
    // new_data es parcial (= p_changes de update_product, solo los campos enviados),
    // mientras que old_data es el snapshot completo del producto. Sin este guard,
    // todos los campos del snapshot pre-cambio aparecerían como "→ —".
    if (!(key in newData)) continue
    const before = oldData[key]
    const after = newData[key]
    if (before === after) continue
    if (before === undefined && after === undefined) continue

    const formatted = formatProductField(key, before, after, lookups, formatMoney)
    if (formatted) {
      changes.push({
        label: PRODUCT_FIELD_LABELS[key],
        before: formatted.before,
        after: formatted.after,
      })
    }
  }

  if (changes.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>

  return (
    <div className="space-y-1.5">
      {changes.map((change, index) => (
        <DiffRow key={index} label={change.label} before={change.before} after={change.after} />
      ))}
    </div>
  )
}

interface BulkProductDeletedProps {
  data: BulkData | null
}

export function BulkProductDeleted({ data }: BulkProductDeletedProps) {
  const count = data?.count ?? data?.product_ids?.length ?? 0
  const ids = data?.product_ids ?? []

  return (
    <div className="space-y-2">
      <p className="text-body">
        <span className="font-semibold text-heading">{count}</span>{' '}
        {count === 1 ? 'producto eliminado' : 'productos eliminados'}
      </p>
      {ids.length > 0 && (
        <details className="text-xs text-hint">
          <summary className="cursor-pointer select-none hover:text-body">Ver IDs</summary>
          <ul className="mt-1.5 space-y-0.5 font-mono">
            {ids.map(id => (
              <li key={id}>#{id.slice(0, 8)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

interface BulkProductListProps {
  data: BulkData | null
}

// Lista solo desde el snapshot inmutable `products` (nombre al momento del evento).
// Entradas viejas sin snapshot NO muestran lista: no guardaron el set real de
// productos modificados, así que product_ids puede no coincidir con `count`
// (incoherencia UI). Preferimos omitir antes que mostrar datos no confiables.
function BulkProductList({ data }: BulkProductListProps) {
  const snapshot = data?.products
  if (!snapshot || snapshot.length === 0) return null
  return (
    <details className="text-xs text-hint">
      <summary className="cursor-pointer select-none hover:text-body">Ver productos</summary>
      <ul className="mt-1.5 space-y-0.5">
        {snapshot.map(p => (
          <li key={p.id} className="text-body">{p.name}</li>
        ))}
      </ul>
    </details>
  )
}

interface BulkProductStatusProps {
  oldData: BulkData | null
  newData: BulkData | null
  lookups: ActivityLookups
}

export function BulkProductStatus({ oldData, newData, lookups }: BulkProductStatusProps) {
  const data = oldData ?? newData
  const count = data?.count ?? data?.products?.length ?? data?.product_ids?.length ?? 0
  const isActive = newData?.is_active === true

  return (
    <div className="space-y-2">
      <p className="text-body">
        <span className="font-semibold text-heading">{count}</span>{' '}
        {count === 1 ? 'producto marcado como' : 'productos marcados como'}{' '}
        <span className="font-semibold text-heading">{isActive ? 'Activo' : 'Inactivo'}</span>
      </p>
      <BulkProductList data={data} />
    </div>
  )
}

interface BulkProductCategoryProps {
  oldData: BulkData | null
  newData: BulkData | null
  lookups: ActivityLookups
}

export function BulkProductCategory({ oldData, newData, lookups }: BulkProductCategoryProps) {
  const data = oldData ?? newData
  const count = data?.count ?? data?.products?.length ?? data?.product_ids?.length ?? 0
  const categoryName = newData?.category_id
    ? lookups.categoryMap[newData.category_id]?.name ?? 'Sin categoría'
    : 'Sin categoría'

  return (
    <div className="space-y-2">
      <p className="text-body">
        <span className="font-semibold text-heading">{count}</span>{' '}
        {count === 1 ? 'producto movido a' : 'productos movidos a'}{' '}
        <span className="font-semibold text-heading">{categoryName}</span>
      </p>
      <BulkProductList data={data} />
    </div>
  )
}

interface BulkProductBrandProps {
  oldData: BulkData | null
  newData: BulkData | null
  lookups: ActivityLookups
}

export function BulkProductBrand({ oldData, newData, lookups }: BulkProductBrandProps) {
  const data = oldData ?? newData
  const count = data?.count ?? data?.products?.length ?? data?.product_ids?.length ?? 0
  const brandName = newData?.brand_id ? lookups.brandMap[newData.brand_id] ?? 'Sin marca' : 'Sin marca'

  return (
    <div className="space-y-2">
      <p className="text-body">
        <span className="font-semibold text-heading">{count}</span>{' '}
        {count === 1 ? 'producto asignado a' : 'productos asignados a'}{' '}
        <span className="font-semibold text-heading">{brandName}</span>
      </p>
      <BulkProductList data={data} />
    </div>
  )
}

function formatProductField(
  key: keyof ProductData,
  before: ProductData[keyof ProductData],
  after: ProductData[keyof ProductData],
  lookups: ActivityLookups,
  formatMoney: (value: number) => string,
) {
  if (key === 'is_active') {
    return {
      before: before === true ? 'Activo' : before === false ? 'Inactivo' : '—',
      after: after === true ? 'Activo' : after === false ? 'Inactivo' : '—',
    }
  }

  if (key === 'price' || key === 'cost') {
    return {
      before: before == null ? '—' : formatMoney(toNumber(before)),
      after: after == null ? '—' : formatMoney(toNumber(after)),
    }
  }

  if (key === 'stock' || key === 'min_stock') {
    return {
      before: before == null ? '—' : String(toNumber(before)),
      after: after == null ? '—' : String(toNumber(after)),
    }
  }

  if (key === 'category_id') {
    return {
      before: typeof before === 'string' ? lookups.categoryMap[before]?.name ?? 'Sin categoría' : 'Sin categoría',
      after: typeof after === 'string' ? lookups.categoryMap[after]?.name ?? 'Sin categoría' : 'Sin categoría',
    }
  }

  if (key === 'brand_id') {
    return {
      before: typeof before === 'string' ? lookups.brandMap[before] ?? 'Sin marca' : 'Sin marca',
      after: typeof after === 'string' ? lookups.brandMap[after] ?? 'Sin marca' : 'Sin marca',
    }
  }

  return {
    before: String(before ?? '—'),
    after: String(after ?? '—'),
  }
}

// ─── Variants snapshot rendering ─────────────────────────────────────────────

function getVariantLabel(variant: ProductVariantSnapshot): string {
  const parts = (variant.option_values ?? [])
    .map(ov => ov.value)
    .filter((v): v is string => Boolean(v))
  return parts.length > 0 ? parts.join(' / ') : '—'
}

function indexById<T extends { id?: string }>(items: T[] | undefined): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items ?? []) {
    if (item.id) map.set(item.id, item)
  }
  return map
}

interface ProductVariantsCreatedProps {
  data: ProductVariantsData | null
}

export function ProductVariantsCreated({ data }: ProductVariantsCreatedProps) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const variants = (data.variants ?? []).filter(v => v.is_active !== false)
  const options = data.options ?? []
  const activeCount = variants.length

  return (
    <div className="space-y-3">
      <p className="text-body">
        <span className="font-semibold text-heading">{activeCount}</span>{' '}
        {activeCount === 1 ? 'variante creada' : 'variantes creadas'}
        {options.length > 0 && (
          <>
            {' · '}
            <span className="text-hint">
              {options.length === 1 ? 'Atributo' : 'Atributos'}: {options.map(o => o.name ?? '—').join(', ')}
            </span>
          </>
        )}
      </p>
      {variants.length > 0 && (
        <ul className="space-y-1.5 border border-edge/60 rounded-lg divide-y divide-edge/60">
          {variants.map(variant => {
            const label = getVariantLabel(variant)
            const price = toNumber(variant.price)
            const cost = toNumber(variant.cost)
            const stock = toNumber(variant.stock)
            return (
              <li key={variant.id ?? label} className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-heading">{label}</span>
                <span className="text-hint">·</span>
                <span className="text-body tabular-nums">Precio {formatMoney(price)}</span>
                {cost > 0 && (
                  <>
                    <span className="text-hint">·</span>
                    <span className="text-body tabular-nums">Costo {formatMoney(cost)}</span>
                  </>
                )}
                <span className="text-hint">·</span>
                <span className="text-body tabular-nums">Stock {stock}</span>
                {variant.sku && (
                  <>
                    <span className="text-hint">·</span>
                    <span className="text-hint font-mono text-xs">{variant.sku}</span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

interface ProductVariantsDiffProps {
  oldData: ProductVariantsData | null
  newData: ProductVariantsData | null
}

interface VariantFieldChange {
  label: string
  before: string
  after: string
}

export function ProductVariantsDiff({ oldData, newData }: ProductVariantsDiffProps) {
  const formatMoney = useFormatMoney()
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const oldIndex = indexById(oldData.variants)
  const newIndex = indexById(newData.variants)

  const added: ProductVariantSnapshot[] = []
  const deactivated: ProductVariantSnapshot[] = []
  const reactivated: ProductVariantSnapshot[] = []
  const modified: { variant: ProductVariantSnapshot; changes: VariantFieldChange[] }[] = []

  for (const [id, next] of newIndex) {
    const prev = oldIndex.get(id)
    if (!prev) {
      if (next.is_active !== false) added.push(next)
      continue
    }
    if (prev.is_active !== false && next.is_active === false) {
      deactivated.push(next)
      continue
    }
    if (prev.is_active === false && next.is_active !== false) {
      reactivated.push(next)
      continue
    }
    const changes = diffVariantFields(prev, next, formatMoney)
    if (changes.length > 0) {
      modified.push({ variant: next, changes })
    }
  }

  // Variantes que estaban en old pero ya no aparecen en new — caso raro (update_product_variants
  // no las elimina, las desactiva). Pero por completitud, las contamos como desactivadas.
  for (const [id, prev] of oldIndex) {
    if (!newIndex.has(id) && prev.is_active !== false) {
      deactivated.push(prev)
    }
  }

  const optionChanges = diffOptions(oldData.options, newData.options)

  if (
    added.length === 0 &&
    deactivated.length === 0 &&
    reactivated.length === 0 &&
    modified.length === 0 &&
    optionChanges.length === 0
  ) {
    return <p className="text-sm text-hint">Sin cambios visibles.</p>
  }

  return (
    <div className="space-y-3">
      {optionChanges.length > 0 && (
        <section className="space-y-1">
          <p className="text-label text-hint uppercase tracking-wide">Atributos</p>
          <ul className="space-y-0.5">
            {optionChanges.map((change, i) => (
              <li key={i} className="text-sm text-body">{change}</li>
            ))}
          </ul>
        </section>
      )}

      {added.length > 0 && (
        <VariantGroup title="Agregadas" tone="created" variants={added} formatMoney={formatMoney} />
      )}

      {reactivated.length > 0 && (
        <VariantGroup title="Reactivadas" tone="created" variants={reactivated} formatMoney={formatMoney} />
      )}

      {deactivated.length > 0 && (
        <VariantGroup title="Desactivadas" tone="deleted" variants={deactivated} formatMoney={formatMoney} />
      )}

      {modified.length > 0 && (
        <section className="space-y-2">
          <p className="text-label text-hint uppercase tracking-wide">Editadas</p>
          <ul className="space-y-2">
            {modified.map(({ variant, changes }) => (
              <li key={variant.id} className="border border-edge/60 rounded-lg px-3 py-2 space-y-1">
                <p className="text-sm font-medium text-heading">{getVariantLabel(variant)}</p>
                <div className="space-y-1">
                  {changes.map((change, i) => (
                    <DiffRow key={i} label={change.label} before={change.before} after={change.after} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

interface VariantGroupProps {
  title: string
  tone: 'created' | 'deleted'
  variants: ProductVariantSnapshot[]
  formatMoney: (value: number) => string
}

function VariantGroup({ title, tone, variants, formatMoney }: VariantGroupProps) {
  const toneClass = tone === 'created'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'

  return (
    <section className="space-y-1.5">
      <p className="text-label text-hint uppercase tracking-wide flex items-center gap-2">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', toneClass)}>
          {title}
        </span>
        <span>({variants.length})</span>
      </p>
      <ul className="space-y-0.5">
        {variants.map(variant => {
          const label = getVariantLabel(variant)
          const price = toNumber(variant.price)
          return (
            <li key={variant.id ?? label} className="text-sm text-body flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-heading">{label}</span>
              {price > 0 && <span className="text-hint tabular-nums">· {formatMoney(price)}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function diffVariantFields(
  prev: ProductVariantSnapshot,
  next: ProductVariantSnapshot,
  formatMoney: (value: number) => string,
): VariantFieldChange[] {
  const changes: VariantFieldChange[] = []

  const moneyFields: { key: 'price' | 'cost'; label: string }[] = [
    { key: 'price', label: 'Precio' },
    { key: 'cost', label: 'Costo' },
  ]
  for (const { key, label } of moneyFields) {
    const before = toNumber(prev[key])
    const after = toNumber(next[key])
    if (before !== after) {
      changes.push({ label, before: formatMoney(before), after: formatMoney(after) })
    }
  }

  const intFields: { key: 'stock' | 'min_stock'; label: string }[] = [
    { key: 'stock', label: 'Stock' },
    { key: 'min_stock', label: 'Stock mínimo' },
  ]
  for (const { key, label } of intFields) {
    const before = toNumber(prev[key])
    const after = toNumber(next[key])
    if (before !== after) {
      changes.push({ label, before: String(before), after: String(after) })
    }
  }

  const stringFields: { key: 'sku' | 'barcode'; label: string }[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Código de barras' },
  ]
  for (const { key, label } of stringFields) {
    const before = prev[key] ?? null
    const after = next[key] ?? null
    if (before !== after) {
      changes.push({ label, before: before ?? '—', after: after ?? '—' })
    }
  }

  return changes
}

function diffOptions(
  oldOptions: ProductOptionSnapshot[] | undefined,
  newOptions: ProductOptionSnapshot[] | undefined,
): string[] {
  const messages: string[] = []
  const oldMap = indexById(oldOptions)
  const newMap = indexById(newOptions)

  for (const [id, next] of newMap) {
    const prev = oldMap.get(id)
    if (!prev) {
      messages.push(`Atributo agregado: ${next.name ?? '—'}`)
      continue
    }
    if (prev.name !== next.name) {
      messages.push(`Atributo renombrado: ${prev.name ?? '—'} → ${next.name ?? '—'}`)
    }
    // Valores agregados
    const prevValueIds = new Set((prev.values ?? []).map(v => v.id).filter(Boolean))
    const addedValues = (next.values ?? []).filter(v => v.id && !prevValueIds.has(v.id))
    for (const v of addedValues) {
      messages.push(`Valor agregado a "${next.name ?? '—'}": ${v.value ?? '—'}`)
    }
  }

  for (const [id, prev] of oldMap) {
    if (!newMap.has(id)) {
      messages.push(`Atributo removido: ${prev.name ?? '—'}`)
    }
  }

  return messages
}
