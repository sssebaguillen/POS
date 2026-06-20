'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { ActiveSessionRow } from '@/app/(app)/cash-sessions/page'

/** Query key única de la caja activa. Las mutaciones (abrir/cerrar/venta) la invalidan. */
export const ACTIVE_CASH_SESSION_KEY = ['active_cash_session'] as const

/**
 * Caja abierta del negocio del usuario (RLS scopea por get_business_id()). Fuente de verdad
 * ÚNICA y compartida: el widget del sidebar y el POS montan este mismo hook (misma key) → un
 * solo fetch de `get_active_session`, y abrir/cerrar caja o completar una venta invalidan la
 * key para refrescar a todos. `data` es `undefined` mientras carga (gate de skeleton), `null`
 * si no hay caja abierta, o la fila activa.
 */
export function useActiveCashSession(enabled = true) {
  const supabase = useMemo(() => createClient(), [])
  return useQuery({
    queryKey: ACTIVE_CASH_SESSION_KEY,
    queryFn: async (): Promise<ActiveSessionRow | null> => {
      const { data, error } = await supabase.rpc('get_active_session')
      if (error) throw error
      return (data ?? null) as ActiveSessionRow | null
    },
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })
}
