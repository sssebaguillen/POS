'use client'

import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { cn } from '@/lib/utils'
import type { BulkData, ProductData } from '@/components/activity/payloads'
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

interface BulkProductStatusProps {
  oldData: BulkData | null
  newData: BulkData | null
}

export function BulkProductStatus({ oldData, newData }: BulkProductStatusProps) {
  const count = oldData?.count ?? oldData?.product_ids?.length ?? 0
  const isActive = newData?.is_active === true

  return (
    <p className="text-body">
      <span className="font-semibold text-heading">{count}</span>{' '}
      {count === 1 ? 'producto marcado como' : 'productos marcados como'}{' '}
      <span className="font-semibold text-heading">{isActive ? 'Activo' : 'Inactivo'}</span>
    </p>
  )
}

interface BulkProductCategoryProps {
  oldData: BulkData | null
  newData: BulkData | null
  lookups: ActivityLookups
}

export function BulkProductCategory({ oldData, newData, lookups }: BulkProductCategoryProps) {
  const count = oldData?.count ?? oldData?.product_ids?.length ?? 0
  const categoryName = newData?.category_id
    ? lookups.categoryMap[newData.category_id]?.name ?? 'Sin categoría'
    : 'Sin categoría'

  return (
    <p className="text-body">
      <span className="font-semibold text-heading">{count}</span>{' '}
      {count === 1 ? 'producto movido a' : 'productos movidos a'}{' '}
      <span className="font-semibold text-heading">{categoryName}</span>
    </p>
  )
}

interface BulkProductBrandProps {
  oldData: BulkData | null
  newData: BulkData | null
  lookups: ActivityLookups
}

export function BulkProductBrand({ oldData, newData, lookups }: BulkProductBrandProps) {
  const count = oldData?.count ?? oldData?.product_ids?.length ?? 0
  const brandName = newData?.brand_id ? lookups.brandMap[newData.brand_id] ?? 'Sin marca' : 'Sin marca'

  return (
    <p className="text-body">
      <span className="font-semibold text-heading">{count}</span>{' '}
      {count === 1 ? 'producto asignado a' : 'productos asignados a'}{' '}
      <span className="font-semibold text-heading">{brandName}</span>
    </p>
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
