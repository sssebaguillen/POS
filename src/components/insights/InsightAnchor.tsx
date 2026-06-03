'use client'

import { useEffect, useState } from 'react'
import { Sparkles, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import InsightCard from '@/components/insights/InsightCard'
import { useMarkInsightsSeen } from '@/components/insights/useInsights'
import { isInsightSoundOn, setInsightSoundOn } from '@/components/insights/sound'
import type { AiInsight } from '@/components/insights/types'

interface InsightAnchorProps {
  insights: AiInsight[]
  onActed?: (insight: AiInsight) => void
  onOpenEntity?: (insight: AiInsight) => void
  openLabel?: string
  size?: 'sm' | 'md'
  align?: 'start' | 'center' | 'end'
  className?: string
  label?: string
}

/**
 * Indicador ambiente de IA (P12, principio 3): glyph anclado a un elemento existente.
 * Click → popover con las sugerencias. Si no hay insights, no renderiza nada (cero footprint).
 * El glyph va en --primary (regla de un solo acento del sistema), no tinte por severidad.
 * Pulsa SOLO cuando hay sugerencias sin ver (status 'new'); al abrir el popover se marcan
 * 'seen' y el glyph se aquieta.
 */
export default function InsightAnchor({ insights, onActed, onOpenEntity, openLabel, size = 'md', align = 'end', className, label }: InsightAnchorProps) {
  const [open, setOpen] = useState(false)
  const [soundOn, setSoundOn] = useState(false)
  // Pop the glyph+count in (notification-badge transition) on appearance.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const markSeen = useMarkInsightsSeen()

  if (insights.length === 0) return null

  const dim = size === 'md' ? 'h-8 w-8' : 'h-7 w-7'
  const icon = size === 'md' ? 16 : 14
  const count = insights.length
  const newIds = insights.filter((i) => i.status === 'new').map((i) => i.id)
  const hasNew = newIds.length > 0

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      setSoundOn(isInsightSoundOn())
      if (newIds.length > 0) markSeen.mutate(newIds)
    }
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    setInsightSoundOn(next)
  }

  // Abrir la entidad (ej. producto) cierra el popover antes de montar el modal/destino.
  const handleOpenEntity = onOpenEntity
    ? (insight: AiInsight) => {
        setOpen(false)
        onOpenEntity(insight)
      }
    : undefined

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? `${count} sugerencia${count > 1 ? 's' : ''} de IA`}
          title={label ?? 'Sugerencias de IA'}
          className={cn(
            'relative inline-flex items-center justify-center rounded-full text-primary transition-transform active:scale-95',
            dim,
            className,
          )}
        >
          {/* Pulso lento en primary, sólo si hay sugerencias sin ver (keyframe en globals.css) */}
          {hasNew && <span className="absolute inset-0 rounded-full bg-primary animate-insight-pulse" aria-hidden />}
          {/* Halo estático tenue: el glyph tiene cuerpo aun sin pulso (reduced-motion / ya vistas) */}
          <span className="absolute inset-0 rounded-full bg-primary/10" aria-hidden />
          {/* Glyph + número entran con la transición notification-badge (slide-in + pop) */}
          <span className="t-badge" data-open={shown ? 'true' : 'false'}>
            <span className="t-badge-dot relative inline-flex! items-center justify-center">
              <Sparkles size={icon} className="relative" />
              {count > 1 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {count}
                </span>
              )}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-96 overflow-hidden p-0">
        <div className="flex items-center gap-1.5 border-b border-edge px-3.5 pb-2 pt-3">
          <Sparkles size={13} className="text-primary" />
          <span className="text-sm font-semibold text-heading">Sugerencias</span>
          <span className="ml-auto text-xs text-hint">{count}</span>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundOn}
            title={soundOn ? 'Silenciar aviso sonoro' : 'Activar aviso sonoro'}
            className="rounded-md p-1 text-hint transition-colors hover:bg-muted hover:text-heading"
          >
            {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
        </div>
        <div className="max-h-[60vh] divide-y divide-edge overflow-y-auto">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onActed={onActed}
              onOpenEntity={handleOpenEntity}
              openLabel={openLabel}
            />
          ))}
        </div>
        <p className="border-t border-edge px-3.5 py-2 text-[11px] text-hint">
          Análisis de los últimos 30 días vs. los 30 previos.
        </p>
      </PopoverContent>
    </Popover>
  )
}
