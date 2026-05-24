'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

interface Props {
  operatorId: string | null
  onOpened: (sessionId: string) => void
  onClose: () => void
}

const SUGGESTION_WINDOW_HOURS = 24

export default function OpenSessionModal({ operatorId, onOpened, onClose }: Props) {
  const [amount, setAmount] = useState('')
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])
  const formatMoney = useFormatMoney()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    async function fetchLastSession() {
      const { data } = await supabase
        .from('cash_sessions')
        .select('closing_amount, closed_at')
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (data?.closing_amount != null && data.closed_at) {
        const hoursSinceClosed = (Date.now() - new Date(data.closed_at).getTime()) / (1000 * 60 * 60)
        if (hoursSinceClosed < SUGGESTION_WINDOW_HOURS) {
          const suggested = Number(data.closing_amount)
          setSuggestedAmount(suggested)
          setAmount(String(suggested))
        }
      }
    }
    void fetchLastSession()
  }, [supabase])

  async function handleOpen() {
    setLoading(true)
    setError(null)
    const openingAmount = parseFloat(amount || '0')
    if (isNaN(openingAmount) || openingAmount < 0) {
      setError('Ingresá un monto válido')
      setLoading(false)
      return
    }
    const { data, error: rpcError } = await supabase.rpc('open_cash_session', {
      p_opening_amount: openingAmount,
      p_operator_id: operatorId,
    })
    const result = data as { success: boolean; session?: { id: string }; error?: string } | null
    if (rpcError || !result?.success) {
      setError(result?.error ?? 'Error al abrir la caja')
      setLoading(false)
      return
    }
    onOpened(result.session!.id)
  }

  const isSuggested = suggestedAmount !== null && amount === String(suggestedAmount)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 dark:bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-xl w-full max-w-sm mx-4 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Abrir caja</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block">Fondo inicial</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleOpen()}
              autoFocus
            />
            {isSuggested ? (
              <p className="text-xs text-primary mt-1.5 flex items-center gap-1">
                <ArrowRight size={11} />
                Sugerido del cierre anterior ({formatMoney(suggestedAmount)}) · Podés modificarlo
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1.5">
                Monto en efectivo con el que arranca la caja. Puede ser 0.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={loading} className="flex-1">
              Cancelar
            </Button>
            <Button onClick={handleOpen} disabled={loading} className="flex-1">
              {loading ? 'Abriendo…' : 'Abrir caja'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
