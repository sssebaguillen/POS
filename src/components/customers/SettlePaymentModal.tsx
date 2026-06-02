'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import SettlePaymentFields from './SettlePaymentFields'
import { useSettlePayment } from './useSettlePayment'
import type { Customer } from '@/lib/types'

interface Props {
  customer: Customer
  operatorId: string | null
  onSettled: (nextBalance: number) => void
  onClose: () => void
}

export default function SettlePaymentModal({ customer, operatorId, onSettled, onClose }: Props) {
  const settle = useSettlePayment({
    customerId: customer.id,
    creditBalance: customer.credit_balance,
    operatorId,
    onSettled,
  })

  return (
    <Dialog open onOpenChange={nextOpen => !nextOpen && onClose()}>
      <DialogContent
        className="sm:max-w-sm p-0 gap-0 overflow-hidden bg-card flex flex-col"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
          <DialogTitle className="text-base font-semibold text-heading">
            Cobrar · {customer.name}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <SettlePaymentFields
            amount={settle.amount}
            onAmountChange={v => { settle.setAmount(v); settle.setError(null) }}
            method={settle.method}
            onMethodChange={settle.setMethod}
            error={settle.error}
            creditBalance={customer.credit_balance}
          />
        </div>

        <div className="border-t border-edge px-5 py-4 flex items-center justify-end gap-2.5 shrink-0">
          <Button
            type="button"
            variant="cancel"
            onClick={onClose}
            disabled={settle.settling}
            className="h-9 rounded-lg text-sm"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void settle.submit()}
            disabled={settle.settling || customer.credit_balance <= 0}
            className="h-9 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {settle.settling ? 'Confirmando...' : 'Confirmar pago'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
