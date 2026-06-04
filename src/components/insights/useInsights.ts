'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import {
  ACTIVE_INSIGHT_STATUSES,
  type AiInsight,
  type InsightStatus,
  type InsightSurface,
} from '@/components/insights/types'

const INSIGHTS_QUERY_KEY = ['ai_insights', 'active'] as const
const INSIGHTS_ENABLED_QUERY_KEY = ['ai_insights', 'enabled'] as const

const SELECT_COLS =
  'id, created_at, status, severity, target_entity_type, target_entity_id, surface, title, body, rationale, source_model'

/**
 * Opt-in `businesses.settings.ai_insights_enabled` del negocio del usuario. Gobierna si la IA
 * proactiva está activa: si el dueño la apaga en /settings, la UI deja de mostrar sugerencias
 * (aunque queden filas en ai_insights de antes). staleTime 0 + refetch al montar → el cambio
 * del toggle se refleja apenas se navega.
 */
export function useAiInsightsEnabled() {
  const supabase = useMemo(() => createClient(), [])

  return useQuery({
    queryKey: INSIGHTS_ENABLED_QUERY_KEY,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.from('businesses').select('settings').limit(1).maybeSingle()
      if (error) throw error
      const settings = (data?.settings ?? null) as { ai_insights_enabled?: boolean } | null
      return settings?.ai_insights_enabled === true
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/**
 * Lee el flag `analysis` del operario activo desde la cookie `op_perms` (espejo non-httpOnly
 * de los permisos, lo mismo que consume el sidebar). El dueño siempre la trae en true
 * (proxy escribe OWNER_PERMISSIONS). Patrón `mounted` para evitar mismatch de hidratación y
 * fail-closed (false hasta poder leer la cookie en el cliente): los insights son contenido de
 * análisis de negocio (capital inmovilizado, márgenes, anomalías de pago) → solo `analysis`.
 */
function useHasInsightsPermission(): boolean {
  const [granted, setGranted] = useState(false)
  useEffect(() => {
    const match = document.cookie.match(/(?:^|; )op_perms=([^;]*)/)
    if (!match) return
    try {
      const perms = JSON.parse(decodeURIComponent(match[1])) as { analysis?: boolean }
      setGranted(perms?.analysis === true)
    } catch {
      // cookie corrupta → fail-closed (granted queda false)
    }
  }, [])
  return granted
}

/**
 * Insights activos (status new|seen) del negocio del usuario. RLS (business isolation)
 * scopea por get_business_id() — no hace falta pasar business_id. Volumen chico (un
 * puñado por noche): se traen todos y los consumidores filtran por surface en memoria.
 * Sólo consulta si la feature está activada (opt-in del negocio) Y el operario tiene `analysis`
 * (los operarios montan sobre la sesión Supabase del dueño, así que el gate por rol es
 * client-side vía cookie — RLS no distingue operario).
 */
export function useActiveInsights(enabled = true) {
  const supabase = useMemo(() => createClient(), [])
  const { data: aiEnabled } = useAiInsightsEnabled()
  const hasPermission = useHasInsightsPermission()

  return useQuery({
    queryKey: INSIGHTS_QUERY_KEY,
    queryFn: async (): Promise<AiInsight[]> => {
      const { data, error } = await supabase
        .from('ai_insights')
        .select(SELECT_COLS)
        .in('status', ACTIVE_INSIGHT_STATUSES)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as AiInsight[]
    },
    enabled: enabled && aiEnabled === true && hasPermission,
    staleTime: 60_000,
  })
}

/** Insights activos para una superficie puntual (ej. 'inventory', 'dashboard'). */
export function useInsightsForSurface(surface: InsightSurface, enabled = true) {
  const query = useActiveInsights(enabled)
  const insights = useMemo(
    () => (query.data ?? []).filter((i) => i.surface === surface),
    [query.data, surface],
  )
  return { ...query, insights }
}

/**
 * Marca como 'seen' los insights 'new' indicados (al abrir el popover). Optimista: actualiza
 * el cache para que el glyph deje de pulsar de inmediato. No quita las cards del feed (seen
 * sigue activo); solo apaga el énfasis de "nuevo".
 */
export function useMarkInsightsSeen() {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return
      const { error } = await supabase.from('ai_insights').update({ status: 'seen' }).in('id', ids)
      if (error) throw error
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: INSIGHTS_QUERY_KEY })
      const previous = queryClient.getQueryData<AiInsight[]>(INSIGHTS_QUERY_KEY)
      const idSet = new Set(ids)
      queryClient.setQueryData<AiInsight[]>(INSIGHTS_QUERY_KEY, (old) =>
        old?.map((i) => (idSet.has(i.id) && i.status === 'new' ? { ...i, status: 'seen' } : i)),
      )
      return { previous }
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(INSIGHTS_QUERY_KEY, context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: INSIGHTS_QUERY_KEY })
    },
  })
}

/**
 * Cambia el status de un insight (seen|dismissed|acted). RLS WITH CHECK garantiza que
 * solo se toquen filas del propio negocio; el CHECK del enum valida el valor. Optimista.
 */
export function useUpdateInsightStatus() {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: InsightStatus }) => {
      const { error } = await supabase.from('ai_insights').update({ status }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: INSIGHTS_QUERY_KEY })
      const previous = queryClient.getQueryData<AiInsight[]>(INSIGHTS_QUERY_KEY)
      queryClient.setQueryData<AiInsight[]>(INSIGHTS_QUERY_KEY, (old) => {
        if (!old) return old
        // dismissed|acted dejan de ser activos → se quitan del feed; seen solo actualiza.
        if (status === 'dismissed' || status === 'acted') return old.filter((i) => i.id !== id)
        return old.map((i) => (i.id === id ? { ...i, status } : i))
      })
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(INSIGHTS_QUERY_KEY, context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: INSIGHTS_QUERY_KEY })
    },
  })
}
