'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useActiveInsights } from '@/components/insights/useInsights'
import { isInsightSoundOn, playInsightChime } from '@/components/insights/sound'

// Solo en el home (no en /pos: cobrar no se interrumpe). El aviso visual es el propio glyph.
const ACTIVE_ROUTES = ['/dashboard']
const SESSION_KEY = 'ai-insights-chimed'

/**
 * P12 (paso 6) — aviso sonoro opt-in de sugerencias nuevas. Suena UNA vez por sesión cuando hay
 * insights sin ver y el dueño activó el sonido (toggle del popover). No renderiza nada.
 * Nota: por políticas de autoplay, el chime es best-effort hasta que haya una interacción previa.
 */
export default function NewInsightNotifier() {
  const pathname = usePathname()
  const isActiveRoute = ACTIVE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
  const { data } = useActiveInsights(isActiveRoute)
  const firedRef = useRef(false)

  const hasNew = (data ?? []).some((i) => i.status === 'new')

  useEffect(() => {
    if (!isActiveRoute || !hasNew || firedRef.current) return
    if (typeof window === 'undefined') return
    if (window.sessionStorage.getItem(SESSION_KEY) === 'true') return
    if (!isInsightSoundOn()) return

    firedRef.current = true
    window.sessionStorage.setItem(SESSION_KEY, 'true')
    playInsightChime()
  }, [isActiveRoute, hasNew])

  return null
}
