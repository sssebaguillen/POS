'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { BrandData, CategoryData } from '@/components/activity/payloads'
import { DeletedBadge, DiffRow, Stat } from '@/components/activity/detail/shared'

const CATEGORY_FIELD_LABELS: Record<keyof CategoryData, string> = {
  name: 'Nombre',
  icon: 'Ícono',
  icon_color: 'Color',
}

interface CategorySummaryProps {
  data: CategoryData | null
  deleted?: boolean
}

export function CategorySummary({ data, deleted = false }: CategorySummaryProps) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && <DeletedBadge label="Eliminada" />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={data.name} />}
        {data.icon && (
          <div>
            <p className="text-label text-hint mb-0.5">Ícono</p>
            <p className="text-base text-body">{data.icon}</p>
          </div>
        )}
        {data.icon_color && (
          <div>
            <p className="text-label text-hint mb-0.5">Color</p>
            <div className="flex items-center gap-2">
              <span
                className="w-4 h-4 rounded-md border border-edge/60"
                style={{ backgroundColor: data.icon_color }}
              />
              <span className="text-sm text-body font-mono">{data.icon_color}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface CategoryDiffProps {
  oldData: CategoryData | null
  newData: CategoryData | null
}

export function CategoryDiff({ oldData, newData }: CategoryDiffProps) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const changes: { label: string; before: ReactNode; after: ReactNode }[] = []

  for (const key of Object.keys(CATEGORY_FIELD_LABELS) as (keyof CategoryData)[]) {
    if (!(key in newData)) continue
    const before = oldData[key]
    const after = newData[key]
    if (before === after) continue
    if (before == null && after == null) continue

    if (key === 'icon_color') {
      changes.push({
        label: CATEGORY_FIELD_LABELS[key],
        before: <ColorSwatch value={before} />,
        after: <ColorSwatch value={after} />,
      })
      continue
    }

    changes.push({
      label: CATEGORY_FIELD_LABELS[key],
      before: <span>{before ?? '—'}</span>,
      after: <span>{after ?? '—'}</span>,
    })
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

interface BrandSummaryProps {
  data: BrandData | null
  deleted?: boolean
}

export function BrandSummary({ data, deleted = false }: BrandSummaryProps) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && <DeletedBadge label="Eliminada" />}
      {data.name && <Stat label="Nombre" value={data.name} />}
    </div>
  )
}

interface BrandDiffProps {
  oldData: BrandData | null
  newData: BrandData | null
}

export function BrandDiff({ oldData, newData }: BrandDiffProps) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>
  if (oldData.name === newData.name) return <p className="text-sm text-hint">Sin cambios visibles.</p>

  return <DiffRow label="Nombre" before={oldData.name ?? '—'} after={newData.name ?? '—'} />
}

interface ColorSwatchProps {
  value: string | null | undefined
}

function ColorSwatch({ value }: ColorSwatchProps) {
  if (!value) return <span className="text-hint">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3.5 h-3.5 rounded-md border border-edge/60" style={{ backgroundColor: value }} />
      <span className="font-mono text-xs">{value}</span>
    </span>
  )
}
