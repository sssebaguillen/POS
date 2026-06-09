'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useUnreadOrdersCount } from './UnreadBadge'
import { useToast } from '@/hooks/useToast'

const ACTIVE_ROUTES = ['/pos', '/dashboard']
const MUTE_KEY = 'orders-online-mute'

function playBeep() {
  if (typeof window === 'undefined') return
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.55)
    osc.onended = () => ctx.close().catch(() => {})
  } catch {
    // ignore audio errors (autoplay policies, etc.)
  }
}

export default function NewOrderNotifier() {
  const pathname = usePathname()
  const isActiveRoute = ACTIVE_ROUTES.some(r => pathname === r || pathname.startsWith(`${r}/`))
  const { data: count = 0 } = useUnreadOrdersCount(isActiveRoute)
  const previousCount = useRef<number | null>(null)
  const { showToast } = useToast()

  useEffect(() => {
    if (previousCount.current === null) {
      previousCount.current = count
      return
    }
    if (count > previousCount.current) {
      const muted = typeof window !== 'undefined' && window.localStorage.getItem(MUTE_KEY) === 'true'
      if (!muted) playBeep()
      const diff = count - previousCount.current
      showToast({
        message: diff === 1 ? 'Nuevo pedido online' : `${diff} pedidos online nuevos`,
        variant: 'success',
        duration: 5000,
      })
    }
    previousCount.current = count
  }, [count, showToast])

  return null
}
