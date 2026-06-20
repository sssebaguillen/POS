'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Vault, CaretRight } from '@phosphor-icons/react/dist/ssr'
import { getCurrencySymbol, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ACCENT_DOT } from '@/lib/accent-colors'
import PopNumber from '@/components/shared/PopNumber'
import { useActiveCashSession } from '@/lib/hooks/useActiveCashSession'

// Neutral surface (matches the operator button below); colour lives only in the
// pulsing dot. Cash = emerald in the app's accent system (PAYMENT_TONE.cash).
const TONE = 'emerald' as const

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface Props {
  // analysis permission — gates the amount + makes the widget link to /cash-sessions
  // (the page itself is analysis-gated, so a non-analysis operator can't reach it).
  canSeeAmount: boolean
  currencyCode: string
  collapsed: boolean
  isMobileDrawer: boolean
  onNavigate?: () => void
}

export default function CashSessionWidget({
  canSeeAmount,
  currencyCode,
  collapsed,
  isMobileDrawer,
  onNavigate,
}: Props) {
  const { data: session } = useActiveCashSession(true)

  // Local clock so the elapsed label ticks without waiting for a refetch.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Subtle reveal once the session first loads (avoids a hard pop-in).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!session) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [session])

  if (!session) return null

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - new Date(session.opened_at).getTime()) / 1000))
  const elapsedLabel = formatElapsed(elapsedSeconds)
  // No decimals in the widget — glanceable. /cash-sessions keeps full precision.
  const moneyLabel = `${getCurrencySymbol(currencyCode)}${formatNumber(Math.round(session.sales_total))}`

  const compact = collapsed && !isMobileDrawer
  const isLink = canSeeAmount

  const tooltip = compact
    ? `Caja abierta · ${elapsedLabel}${canSeeAmount ? ` · ${moneyLabel}` : ''}`
    : undefined

  // Corner overlay dot — the only spot of colour (used on the icon in both modes).
  const cornerDot = (
    <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
      <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', ACCENT_DOT[TONE])} />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', ACCENT_DOT[TONE])} />
    </span>
  )

  const handleClick = () => {
    if (isMobileDrawer) onNavigate?.()
  }

  if (compact) {
    const className = cn(
      'group relative flex w-full items-center justify-center rounded-lg p-2.5 text-hint transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hover:bg-hover-bg hover:text-body active:scale-95',
      shown ? 'opacity-100' : 'opacity-0'
    )
    const inner = (
      <>
        <Vault size={18} />
        {cornerDot}
      </>
    )
    return isLink ? (
      <Link href="/cash-sessions" title={tooltip} aria-label={tooltip} onClick={handleClick} className={className}>
        {inner}
      </Link>
    ) : (
      <div title={tooltip} aria-label={tooltip} className={cn(className, 'cursor-default')}>
        {inner}
      </div>
    )
  }

  // Connected-tab look: narrower than the operator button and resting flush on
  // its top edge (the negative bottom margin just cancels the footer's gap, so
  // there's no overlap to occlude — the button keeps its normal transparent fill).
  // Single line, ~half the button's height.
  // Back card: a distinct (accent) surface that peeks above the operator button.
  // The operator button (opaque + shadow, higher z) tucks over its bottom edge,
  // so only the top — with the info — shows. Square bottom (rounded-t-2xl) hides
  // cleanly behind the button.
  const className = cn(
    'group relative z-0 -mb-4 flex w-full items-center gap-2.5 rounded-t-2xl bg-accent px-2.5 pt-2 pb-4 transition-[opacity,transform] duration-200 ease-[var(--ease-out)]',
    shown ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
  )
  // Hero is the number (money, or elapsed when the amount is gated); the label
  // recedes; colour lives only in the icon + dot.
  const inner = (
    <>
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-emerald-600 dark:text-emerald-400">
        <Vault size={16} />
        {cornerDot}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-muted-foreground">
          Caja abierta{canSeeAmount ? ` · ${elapsedLabel}` : ''}
        </span>
        {canSeeAmount ? (
          <PopNumber value={moneyLabel} className="block text-base font-bold leading-tight text-heading tabular-nums" />
        ) : (
          <span className="block text-base font-bold leading-tight text-heading tabular-nums">{elapsedLabel}</span>
        )}
      </span>
      {isLink && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge bg-card text-hint transition-colors duration-150 group-hover:bg-hover-bg group-hover:text-body">
          <CaretRight size={15} />
        </span>
      )}
    </>
  )

  return isLink ? (
    <Link href="/cash-sessions" onClick={handleClick} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  )
}
