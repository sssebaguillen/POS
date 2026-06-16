'use client'

import type { ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_LABELS, isPaymentMethod } from '@/lib/payments'
import { PROFILE_ROLE_LABELS, OPERATOR_ROLE_LABELS, type OperatorRole } from '@/lib/constants/domain'
import { cn } from '@/lib/utils'

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function getOperatorRoleLabel(role: string | null | undefined): string {
  if (!role) return '—'
  if (role === 'owner') return PROFILE_ROLE_LABELS.owner
  if (role in OPERATOR_ROLE_LABELS) {
    return OPERATOR_ROLE_LABELS[role as OperatorRole]
  }
  return role
}

interface DeletedBadgeProps {
  label: string
}

export function DeletedBadge({ label }: DeletedBadgeProps) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-destructive/15 text-destructive">
      <Trash2 size={12} />
      {label}
    </div>
  )
}

interface StatProps {
  label: string
  value: string
  emphasis?: boolean
}

export function Stat({ label, value, emphasis = false }: StatProps) {
  return (
    <div>
      <p className="text-label text-hint mb-0.5">{label}</p>
      <p className={cn('text-body', emphasis && 'text-lg font-bold text-heading font-display')}>
        {value}
      </p>
    </div>
  )
}

interface DiffRowProps {
  label: string
  before: ReactNode
  after: ReactNode
}

export function DiffRow({ label, before, after }: DiffRowProps) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-label text-hint min-w-[120px]">{label}</span>
      <span className="text-body line-through opacity-70">{before}</span>
      <span className="text-hint">→</span>
      <span className="text-heading font-medium">{after}</span>
    </div>
  )
}

interface PaymentBadgeProps {
  method: string | undefined
  amount?: number
}

export function PaymentBadge({ method, amount }: PaymentBadgeProps) {
  const formatMoney = useFormatMoney()
  const label = method && isPaymentMethod(method) ? PAYMENT_LABELS[method] : method ?? '—'
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/20 dark:bg-primary/15 dark:border-primary/30">
      {label}
      {amount !== undefined && (
        <span className="text-hint">· {formatMoney(amount)}</span>
      )}
    </span>
  )
}
