'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import type { RecentActivityRow } from '@/components/dashboard/DashboardView'

interface Props {
  entries: RecentActivityRow[]
}

type ActionTone = 'created' | 'updated' | 'deleted' | 'bulk'

const ACTION_LABELS: Record<string, string> = {
  sale_created:           'Venta creada',
  sale_updated:           'Venta editada',
  sale_deleted:           'Venta eliminada',
  product_created:        'Producto creado',
  product_updated:        'Producto editado',
  product_deleted:        'Producto eliminado',
  product_bulk_deleted:   'Productos eliminados',
  product_bulk_status:    'Estado de productos',
  product_bulk_category:  'Categoría de productos',
  product_bulk_brand:     'Marca de productos',
  category_created:       'Categoría creada',
  category_updated:       'Categoría editada',
  category_deleted:       'Categoría eliminada',
  brand_created:          'Marca creada',
  brand_updated:          'Marca editada',
  brand_deleted:          'Marca eliminada',
}

const TONE_CLASSES: Record<ActionTone, string> = {
  created: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  updated: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  deleted: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  bulk:    'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
}

function getActionTone(action: string): ActionTone {
  if (action.includes('bulk')) return 'bulk'
  if (action.endsWith('_created')) return 'created'
  if (action.endsWith('_updated')) return 'updated'
  if (action.endsWith('_deleted')) return 'deleted'
  return 'updated'
}

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffSec = Math.round((now - then) / 1000)

  if (diffSec < 5) return 'ahora'
  if (diffSec < 60) return `hace ${diffSec} s`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const diffD = Math.round(diffH / 24)
  if (diffD < 7) return `hace ${diffD} d`
  const diffW = Math.round(diffD / 7)
  if (diffW < 5) return `hace ${diffW} sem`
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
}

function extractSaleTotal(row: RecentActivityRow): number | null {
  if (row.entity_type !== 'sale') return null
  const source = row.new_data ?? row.old_data
  if (!source) return null
  const raw = source.total
  const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  return Number.isFinite(num) ? num : null
}

export default function RecentActivityWidget({ entries }: Props) {
  const fmt = useFormatMoney()
  return (
    <div className="surface-card p-5 h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-semibold text-heading font-display">Actividad reciente</p>
          <p className="text-xs text-hint mt-0.5">Últimos eventos del negocio</p>
        </div>
        <Link href="/activity" className="text-xs text-primary font-medium hover:underline shrink-0">
          Ver detalle →
        </Link>
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-hint">Sin actividad reciente</p>
        </div>
      ) : (
        <ul className="flex-1 space-y-2.5 overflow-hidden">
          {entries.map(entry => {
            const tone = getActionTone(entry.action)
            const saleTotal = extractSaleTotal(entry)
            const primary = entry.entity_label ?? (saleTotal !== null ? fmt(saleTotal) : null)
            return (
              <li key={entry.id} className="flex items-start gap-2.5">
                <span className={cn('shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', TONE_CLASSES[tone])}>
                  {getActionLabel(entry.action)}
                </span>
                <div className="min-w-0 flex-1">
                  {primary && (
                    <p className="text-sm text-body truncate" title={primary}>
                      {primary}
                    </p>
                  )}
                  <p className="text-xs text-hint truncate">
                    {formatRelativeTime(entry.created_at)} · {entry.actor_name}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
