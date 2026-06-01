'use client'

import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/format'
import { PAYMENT_LABELS } from '@/lib/payments'
import { SETTLEMENT_METHODS, type SettlementMethod } from './useSettlePayment'

interface Props {
  amount: string
  onAmountChange: (value: string) => void
  method: SettlementMethod
  onMethodChange: (method: SettlementMethod) => void
  error: string | null
  creditBalance: number
}

export default function SettlePaymentFields({
  amount,
  onAmountChange,
  method,
  onMethodChange,
  error,
  creditBalance,
}: Props) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        <label className="text-label text-subtle">
          Monto <span className="text-destructive">*</span>
        </label>
        <Input
          type="number"
          inputMode="decimal"
          min="0"
          max={creditBalance}
          step="0.01"
          value={amount}
          onChange={e => onAmountChange(e.target.value)}
          placeholder="0.00"
          autoFocus
          className="h-9"
        />
        <p className="text-caption text-hint">Deuda actual: {formatMoney(creditBalance)}</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-label text-subtle">Método</label>
        <div className="flex gap-2">
          {SETTLEMENT_METHODS.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => onMethodChange(m)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                method === m
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-body border-edge hover:bg-hover-bg'
              }`}
            >
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
