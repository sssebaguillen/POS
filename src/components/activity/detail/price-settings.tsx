'use client'

import { cn } from '@/lib/utils'
import type {
  PriceListData,
  SettingsData,
} from '@/components/activity/payloads'
import { DeletedBadge, DiffRow, Stat, toNumber } from '@/components/activity/detail/shared'

const SETTINGS_FIELD_LABELS: Record<string, string> = {
  primary_color: 'Color principal',
  currency: 'Moneda',
  free_line_enabled: 'Producto libre',
}

interface PriceListSummaryProps {
  data: PriceListData | null
  deleted?: boolean
}

export function PriceListSummary({ data, deleted = false }: PriceListSummaryProps) {
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  return (
    <div className={cn('space-y-3', deleted && 'opacity-90')}>
      {deleted && <DeletedBadge label="Eliminada" />}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={String(data.name)} />}
        {data.multiplier !== undefined && <Stat label="Margen" value={multiplierToMarginText(data.multiplier)} />}
        {data.is_default !== undefined && <Stat label="Predeterminada" value={data.is_default ? 'Sí' : 'No'} />}
        {data.description && <Stat label="Descripción" value={String(data.description)} />}
      </div>
    </div>
  )
}

interface PriceListDiffProps {
  oldData: PriceListData | null
  newData: PriceListData | null
}

export function PriceListDiff({ oldData, newData }: PriceListDiffProps) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []
  if (oldData.name !== newData.name) {
    rows.push({ label: 'Nombre', before: String(oldData.name ?? '—'), after: String(newData.name ?? '—') })
  }
  if (oldData.description !== newData.description) {
    rows.push({ label: 'Descripción', before: String(oldData.description ?? '—'), after: String(newData.description ?? '—') })
  }
  if (toNumber(oldData.multiplier) !== toNumber(newData.multiplier)) {
    rows.push({
      label: 'Margen',
      before: multiplierToMarginText(oldData.multiplier),
      after: multiplierToMarginText(newData.multiplier),
    })
  }

  if (rows.length === 0) {
    return <p className="text-sm text-hint">Sin cambios visibles en la lista. (Pueden haberse modificado overrides por producto.)</p>
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <DiffRow key={index} label={row.label} before={row.before} after={row.after} />
      ))}
    </div>
  )
}

interface PriceListDefaultChangedProps {
  label: string | null
}

export function PriceListDefaultChanged({ label }: PriceListDefaultChangedProps) {
  return (
    <p className="text-body">
      Lista predeterminada cambiada a{' '}
      <span className="font-semibold text-heading">{label ?? 'una lista nueva'}</span>.
    </p>
  )
}

interface SettingsDiffProps {
  oldData: SettingsData | null
  newData: SettingsData | null
}

export function SettingsDiff({ oldData, newData }: SettingsDiffProps) {
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []
  if (oldData.name !== newData.name) {
    rows.push({ label: 'Nombre', before: String(oldData.name ?? '—'), after: String(newData.name ?? '—') })
  }
  if (oldData.description !== newData.description) {
    rows.push({ label: 'Descripción', before: String(oldData.description ?? '—'), after: String(newData.description ?? '—') })
  }
  if (oldData.whatsapp !== newData.whatsapp) {
    rows.push({ label: 'WhatsApp', before: String(oldData.whatsapp ?? '—'), after: String(newData.whatsapp ?? '—') })
  }
  if (oldData.logo_url !== newData.logo_url) {
    rows.push({
      label: 'Logo',
      before: oldData.logo_url ? 'Configurado' : '—',
      after: newData.logo_url ? 'Configurado' : '—',
    })
  }

  const oldSettings = oldData.settings ?? {}
  const newSettings = newData.settings ?? {}
  const settingsKeys = new Set([...Object.keys(oldSettings), ...Object.keys(newSettings)])

  for (const key of settingsKeys) {
    const before = oldSettings[key]
    const after = newSettings[key]
    if (before === after) continue
    rows.push({
      label: SETTINGS_FIELD_LABELS[key] ?? key,
      before: formatSettingsValue(key, before),
      after: formatSettingsValue(key, after),
    })
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>

  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <DiffRow key={index} label={row.label} before={row.before} after={row.after} />
      ))}
    </div>
  )
}

interface SettingsSlugDiffProps {
  oldData: { slug?: string } | null
  newData: { slug?: string } | null
}

export function SettingsSlugDiff({ oldData, newData }: SettingsSlugDiffProps) {
  return (
    <DiffRow
      label="URL del catálogo"
      before={oldData?.slug ?? '—'}
      after={newData?.slug ?? '—'}
    />
  )
}

function multiplierToMarginText(value: unknown): string {
  const number = toNumber(value)
  if (!Number.isFinite(number) || number <= 0) return '—'
  const percentage = (number - 1) * 100
  return `${percentage.toFixed(0)}% (×${number})`
}

function formatSettingsValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean' || key === 'free_line_enabled') {
    return value === true || value === 'true' ? 'Habilitado' : 'Deshabilitado'
  }
  return String(value)
}
