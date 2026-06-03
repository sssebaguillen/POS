'use client'

import InsightAnchor from '@/components/insights/InsightAnchor'
import { useActiveInsights } from '@/components/insights/useInsights'
import type { AiInsight, InsightSurface } from '@/components/insights/types'

interface InsightSurfaceAnchorProps {
  surfaces: InsightSurface[]
  size?: 'sm' | 'md'
  align?: 'start' | 'center' | 'end'
  label?: string
  onActed?: (insight: AiInsight) => void
  onOpenEntity?: (insight: AiInsight) => void
  openLabel?: string
}

/**
 * Glyph ambiente de IA para un header de página: junta los insights activos cuyas superficies
 * matchean y los muestra en el popover del InsightAnchor. Cero footprint si no hay nada.
 */
export default function InsightSurfaceAnchor({
  surfaces,
  size = 'md',
  align,
  label,
  onActed,
  onOpenEntity,
  openLabel,
}: InsightSurfaceAnchorProps) {
  const { data } = useActiveInsights()
  const items = (data ?? []).filter((i) => surfaces.includes(i.surface))
  return (
    <InsightAnchor
      insights={items}
      size={size}
      align={align}
      label={label}
      onActed={onActed}
      onOpenEntity={onOpenEntity}
      openLabel={openLabel}
    />
  )
}
