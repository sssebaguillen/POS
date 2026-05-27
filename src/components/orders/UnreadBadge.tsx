'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

const SEEN_AT_KEY = 'orders-online-seen-at'
const SEEN_AT_EVENT = 'orders-online-seen-at:changed'

/**
 * Mark the catalog-order badge as cleared up to `now`. Called by `/orders`
 * on mount and on each successful list refresh — once the owner is looking
 * at the section, every order they can see is "acknowledged".
 */
export function acknowledgeOrdersSeen() {
  if (typeof window === 'undefined') return
  const iso = new Date().toISOString()
  window.localStorage.setItem(SEEN_AT_KEY, iso)
  window.dispatchEvent(new CustomEvent(SEEN_AT_EVENT, { detail: iso }))
}

function readSeenAt(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SEEN_AT_KEY)
}

export function useUnreadOrdersCount(enabled: boolean) {
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const previousCount = useRef<number | null>(null)
  const [seenAt, setSeenAt] = useState<string | null>(() => readSeenAt())

  useEffect(() => {
    function refresh() { setSeenAt(readSeenAt()) }
    window.addEventListener(SEEN_AT_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(SEEN_AT_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const query = useQuery({
    queryKey: ['catalog_orders_unread', seenAt],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_catalog_orders_unread_count', {
        p_since: seenAt,
      })
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
