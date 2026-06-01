'use client'

import { Button } from '@/components/ui/button'
import SettlePaymentFields from './SettlePaymentFields'
import { useSettlePayment } from './useSettlePayment'

interface Props {
  customerId: string
  creditBalance: number
  operatorId: string | null
  onSettled: (nextBalance: number) => void
  onCancel: () => void
}

export default function SettlePaymentForm({ customerId, creditBalance, operatorId, onSettled, onCancel }: Props) {
  const settle = useSettlePayment({ customerId, creditBalance, operatorId, onSettled })

  return (
    <div className="space-y-2.5">
      <SettlePaymentFields
        amount={settle.amount}
        onAmountChange={v => { settle.setAmount(v); settle.setError(null) }}
        method={settle.method}
        onMethodChange={settle.setMethod}
        error={settle.error}
        creditBalance={creditBalance}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="cancel"
          onClick={onCancel}
          disabled={settle.settling}
          className="h-9 rounded-lg text-sm"
        >
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={() => void settle.submit()}
          disabled={settle.settling || creditBalance <= 0}
          className="h-9 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {settle.settling ? 'Confirmando...' : 'Confirmar pago'}
        </Button>
      </div>
    </div>
  )
}
