'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import ActivityDetail from '@/components/activity/ActivityDetail'
import EntityGlyph from '@/components/activity/EntityGlyph'
import { SaleSummaryInline } from '@/components/activity/detail/sale'
import { ENTITY_TYPE_LABELS } from '@/components/activity/config'
import { formatFullTimestamp, formatRelativeTime } from '@/components/activity/utils'
import { AUDIT_TONE_CLASSES, getAuditActionLabel } from '@/lib/audit'
import { cn } from '@/lib/utils'
import type { ActivityActionTone, ActivityLogRow, ActivityLookups } from '@/components/activity/types'

interface ActivityRowProps {
  row: ActivityLogRow
  isOpen: boolean
  tone: ActivityActionTone
  lookups: ActivityLookups
  onToggle: () => void
}

export default function ActivityRow({
  row,
  isOpen,
  tone,
  lookups,
  onToggle,
}: ActivityRowProps) {
  return (
    <>
      <tr
        className="border-b border-edge/40 hover:bg-hover-bg/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-hover-bg/60"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Cerrar detalle' : 'Abrir detalle'}
      >
        <td className="px-4 py-3 align-middle">
          <span
            className="inline-flex items-center justify-center w-6 h-6 text-hint"
            aria-hidden="true"
          >
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <span title={formatFullTimestamp(row.created_at)} className="text-body cursor-default">
            {formatRelativeTime(row.created_at)}
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', AUDIT_TONE_CLASSES[tone])}>
            {getAuditActionLabel(row.action)}
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 shrink-0" aria-hidden="true">
              <EntityGlyph row={row} lookups={lookups} />
            </span>
            <span>
              <span className="text-hint">{ENTITY_TYPE_LABELS[row.entity_type]}</span>
              {row.entity_label && (
                <>
                  <span className="text-hint mx-1.5">·</span>
                  <span className="text-heading font-medium">{row.entity_label}</span>
                </>
              )}
              {row.entity_type === 'sale' && (
                <SaleSummaryInline row={row} customerMap={lookups.customerMap} />
              )}
            </span>
          </span>
        </td>
        <td className="px-4 py-3 align-middle text-body">{row.actor_name}</td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-alt/40 border-b border-edge/40">
          <td colSpan={5} className="px-4 py-4">
            <ActivityDetail row={row} lookups={lookups} />
          </td>
        </tr>
      )}
    </>
  )
}
