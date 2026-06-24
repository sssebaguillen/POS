'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { AUDIT_TONE_CLASSES, getAuditActionLabel, getAuditActionTone } from '@/lib/audit'
import type { RecentActivityRow } from '@/components/dashboard/DashboardView'

interface Props {
  entries: RecentActivityRow[]
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
    <div className="surface-card p-6 h-full flex flex-col">
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
        <ul className="flex-1 flex flex-col justify-between gap-2.5 overflow-hidden">
          {entries.map(entry => {
            const tone = getAuditActionTone(entry.action)
            const saleTotal = extractSaleTotal(entry)
            const primary = entry.entity_label ?? (saleTotal !== null ? fmt(saleTotal) : null)
            return (
              <li key={entry.id} className="flex items-start gap-2.5">
                <span className={cn('shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', AUDIT_TONE_CLASSES[tone])}>
                  {getAuditActionLabel(entry.action)}
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
