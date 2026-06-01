import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatMoney } from '@/lib/format'

export type SettlementMethod = 'cash' | 'card' | 'transfer'
export const SETTLEMENT_METHODS: SettlementMethod[] = ['cash', 'card', 'transfer']

interface Params {
  customerId: string
  creditBalance: number
  operatorId: string | null
  onSettled: (nextBalance: number) => void
}

export function useSettlePayment({ customerId, creditBalance, operatorId, onSettled }: Params) {
  const supabase = useMemo(() => createClient(), [])
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<SettlementMethod>('cash')
  const [error, setError] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)

  async function submit() {
    const parsed = Number.parseFloat(amount.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('El monto debe ser mayor a 0.')
      return
    }
    if (parsed > creditBalance) {
      setError(`El monto no puede superar la deuda actual (${formatMoney(creditBalance)}).`)
      return
    }

    setSettling(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('settle_customer_credit', {
      p_customer_id: customerId,
      p_amount: parsed,
      p_method: method,
      p_operator_id: operatorId,
    })
    if (rpcError) {
      setError(rpcError.message ?? 'No se pudo registrar el pago.')
      setSettling(false)
      return
    }
    const nextBalance = typeof data === 'number' ? data : Math.max(0, creditBalance - parsed)
    setSettling(false)
    onSettled(nextBalance)
  }

  return { amount, setAmount, method, setMethod, error, setError, settling, submit }
}
