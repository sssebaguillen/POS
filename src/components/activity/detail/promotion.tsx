'use client'

import { cn } from '@/lib/utils'
import type { PromotionData } from '@/components/activity/payloads'
import type { ActivityLookups } from '@/components/activity/types'
import { DeletedBadge, DiffRow, Stat, toNumber } from '@/components/activity/detail/shared'

function kindText(data: PromotionData): string {
  if (data.kind === 'percent') return `${toNumber(data.percent)}% de descuento`
  if (data.kind === 'offer_price') return `Precio de oferta $${toNumber(data.offer_price)}`
  if (data.kind === 'quantity') {
    const n = toNumber(data.group_size)
    const k = toNumber(data.affected_units)
    const p = toNumber(data.pay_percent)
    if (p === 0) return `Lleva ${n}, paga ${n - k}`
    if (n === 2 && k === 1) return `2da unidad al ${p}%`
    return `Cada ${n} unidades, ${k} al ${p}%`
  }
  return '—'
}

function scopeText(data: PromotionData, lookups: ActivityLookups): string {
  if (data.product_id) return lookups.productMap[data.product_id] ?? 'Producto'
  if (data.category_id) return `Categoría: ${lookups.categoryMap[data.category_id]?.name ?? '—'}`
  if (data.brand_id) return `Marca: ${lookups.brandMap[data.brand_id] ?? '—'}`
  return '—'
}

function dateShort(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function vigenciaText(data: PromotionData): string {
  if (!data.starts_at && !data.ends_at) return 'Sin límite'
  if (data.starts_at && data.ends_at) return `${dateShort(data.starts_at)} – ${dateShort(data.ends_at)}`
  if (data.starts_at) return `Desde ${dateShort(data.starts_at)}`
  return `Hasta ${dateShort(data.ends_at)}`
}

interface PromotionSummaryProps {
  data: PromotionData | null
  lookups: ActivityLookups
  archived?: boolean
}

export function PromotionSummary({ data, lookups, archived = false }: PromotionSummaryProps) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  return (
    <div className={cn('space-y-3', archived && 'opacity-90')}>
      {archived && <DeletedBadge label="Archivada" />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={String(data.name)} />}
        <Stat label="Promo" value={kindText(data)} emphasis />
        <Stat label="Alcance" value={scopeText(data, lookups)} />
        <Stat label="Vigencia" value={vigenciaText(data)} />
        {data.show_in_catalog !== undefined && (
          <Stat label="Catálogo" value={data.show_in_catalog ? 'Destacada en Ofertas' : 'No destacada'} />
        )}
        {data.is_active !== undefined && (
          <Stat label="Activa" value={data.is_active ? 'Sí' : 'No'} />
        )}
      </div>
    </div>
  )
}

interface PromotionDiffProps {
  oldData: PromotionData | null
  newData: PromotionData | null
  lookups: ActivityLookups
}

export function PromotionDiff({ oldData, newData, lookups }: PromotionDiffProps) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []
  if (oldData.name !== newData.name) {
    rows.push({ label: 'Nombre', before: String(oldData.name ?? '—'), after: String(newData.name ?? '—') })
  }
  const oldKind = kindText(oldData)
  const newKind = kindText(newData)
  if (oldKind !== newKind) {
    rows.push({ label: 'Promo', before: oldKind, after: newKind })
  }
  const oldScope = scopeText(oldData, lookups)
  const newScope = scopeText(newData, lookups)
  if (oldScope !== newScope) {
    rows.push({ label: 'Alcance', before: oldScope, after: newScope })
  }
  const oldVig = vigenciaText(oldData)
  const newVig = vigenciaText(newData)
  if (oldVig !== newVig) {
    rows.push({ label: 'Vigencia', before: oldVig, after: newVig })
  }
  if (oldData.show_in_catalog !== newData.show_in_catalog) {
    rows.push({
      label: 'Catálogo',
      before: oldData.show_in_catalog ? 'Destacada' : 'No destacada',
      after: newData.show_in_catalog ? 'Destacada' : 'No destacada',
    })
  }
  if (oldData.is_active !== newData.is_active) {
    rows.push({
      label: 'Estado',
      before: oldData.is_active ? 'Activa' : 'Pausada',
      after: newData.is_active ? 'Activa' : 'Pausada',
    })
  }

  if (rows.length === 0) {
    return <p className="text-sm text-hint">Sin cambios visibles.</p>
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <DiffRow key={index} label={row.label} before={row.before} after={row.after} />
      ))}
    </div>
  )
}
