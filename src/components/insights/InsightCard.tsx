'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, Lightbulb, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUpdateInsightStatus } from '@/components/insights/useInsights'
import type { AiInsight, InsightSeverity } from '@/components/insights/types'

// Severidad dentro de la paleta cálida del sistema (sin colores genéricos sky/emerald/amber):
// oportunidad → espresso (primary), atención → ember red (destructive), nota → neutral (secondary).
const SEVERITY: Record<InsightSeverity, { chip: string; label: string; Icon: typeof Lightbulb }> = {
  anomaly: { chip: 'bg-destructive/10 text-destructive border-destructive/20', label: 'Atención', Icon: AlertTriangle },
  opportunity: { chip: 'bg-primary/10 text-primary border-primary/20', label: 'Oportunidad', Icon: TrendingUp },
  info: { chip: 'bg-secondary text-body border-border', label: 'Nota', Icon: Lightbulb },
}

interface InsightCardProps {
  insight: AiInsight
  // Acción opcional al marcar "hecho" (ej. navegar a la entidad). Se llama antes de mutar.
  onActed?: (insight: AiInsight) => void
  // Si el insight apunta a una entidad abrible (ej. producto), abre su detalle. Cuando se provee,
  // reemplaza "Marcar como hecho" por el botón de apertura (la acción principal pasa a ser ir a la entidad).
  onOpenEntity?: (insight: AiInsight) => void
  openLabel?: string
  className?: string
}

// Un insight dentro del popover del InsightAnchor. La severidad la lleva el chip (sin barra lateral).
export default function InsightCard({ insight, onActed, onOpenEntity, openLabel = 'Ver', className }: InsightCardProps) {
  const update = useUpdateInsightStatus()
  const [showWhy, setShowWhy] = useState(false)
  const { chip, label, Icon } = SEVERITY[insight.severity]
  const busy = update.isPending
  const hasWhy = insight.rationale.length > 0

  return (
    <div className={cn('px-3.5 py-3', className)}>
      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', chip)}>
        <Icon size={12} className="shrink-0" />
        {label}
      </span>

      <h3 className="mt-2 text-sm font-semibold text-heading">{insight.title}</h3>
      <p className="mt-0.5 text-[13px] leading-relaxed text-body">{insight.body}</p>

      {hasWhy && (
        <>
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            aria-expanded={showWhy}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-hint transition-colors hover:text-body"
          >
            Por qué
            <ChevronDown
              size={13}
              className={cn('transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]', showWhy && 'rotate-180')}
            />
          </button>
          {showWhy && (
            <ul className="mt-1.5 space-y-1">
              {insight.rationale.map((reason, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-hint">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => update.mutate({ id: insight.id, status: 'dismissed' })}
          disabled={busy}
          className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-hint transition-colors hover:bg-muted hover:text-heading disabled:opacity-50"
        >
          Descartar
        </button>
        {onOpenEntity ? (
          <button
            type="button"
            onClick={() => onOpenEntity(insight)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 active:scale-[0.97] disabled:opacity-50"
          >
            <ArrowUpRight size={13} />
            {openLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onActed?.(insight)
              update.mutate({ id: insight.id, status: 'acted' })
            }}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 active:scale-[0.97] disabled:opacity-50"
          >
            <Check size={13} />
            Marcar como hecho
          </button>
        )}
      </div>
    </div>
  )
}
