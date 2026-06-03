'use client'

import { cn } from '@/lib/utils'

const NBSP = ' '

interface PopNumberProps {
  /** Pre-formatted text to render (e.g. "$1.234"). Each char pops in. */
  value: string
  className?: string
}

/**
 * Number pop-in (transitions-dev): re-enters each character with a blurred
 * slide. Replay is driven by `key={value}` — whenever the value changes the
 * group remounts, restarting the CSS animation reliably on every change (and
 * on first render). The two trailing chars stagger so decimals feel alive.
 */
export default function PopNumber({ value, className }: PopNumberProps) {
  const chars = [...value]
  const len = chars.length

  return (
    <span key={value} className={cn('t-digit-group is-animating', className)} aria-label={value}>
      {chars.map((ch, i) => (
        <span
          key={i}
          className="t-digit"
          data-stagger={i === len - 2 ? '1' : i === len - 1 ? '2' : undefined}
          aria-hidden="true"
        >
          {ch === ' ' ? NBSP : ch}
        </span>
      ))}
    </span>
  )
}
