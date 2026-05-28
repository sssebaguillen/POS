'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/**
 * Mark the catalog-order badge as read for the whole business. Called by
 * `/orders` on mount — once anyone opens the section, every order currently
 * visible is acknowledged for every device/operator. State lives in
 * businesses.catalog_orders_read_at (per business), not localStorage.
 */
export async function acknowledgeOrdersSeen() {
  const supabase = createClient()
  await supabase.rpc('mark_catalog_orders_read')
}

export function useUnreadOrdersCount(enabled: boolean) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const previousCount = useRef<number | null>(null)

  const query = useQuery({
    queryKey: ['catalog_orders_unread'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_catalog_orders_unread_count')
      if (error) throw error
      return Number(data ?? 0)
    },
    enabled,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  // Whenever the unread count changes, invalidate the full orders list so
  // any open /orders view picks up the change without waiting for its own poll.
  useEffect(() => {
    if (query.data === undefined) return
    if (previousCount.current !== null && query.data !== previousCount.current) {
      queryClient.invalidateQueries({ queryKey: ['catalog_orders'] })
    }
    previousCount.current = query.data
  }, [query.data, queryClient])

  return query
}

interface BadgeProps {
  count: number
  collapsed?: boolean
}

export default function UnreadBadge({ count, collapsed = false }: BadgeProps) {
  if (count <= 0) return null
  const label = count > 99 ? '99+' : String(count)
  return (
    <span
      aria-label={`${count} pedidos sin atender`}
      className={
        collapsed
          ? 'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center'
          : 'ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold'
      }
    >
      {label}
    </span>
  )
}
