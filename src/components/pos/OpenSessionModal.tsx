'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

interface Props {
  open: boolean
  operatorId: string | null
  onOpened: (sessionId: string) => void
  onClose: () => void
}

const SUGGESTION_WINDOW_HOURS = 24

export default function OpenSessionModal({ open, operatorId, onOpened, onClose }: Props) {
  const [amount, setAmount] = useState('')
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()
  const formatMoney = useFormatMoney()

  useEffect(() => {
    if (!open) return
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
  }, [open, supabase])

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
    void queryClient.invalidateQueries({ queryKey: ['active_cash_session'] })
    onOpened(result.session!.id)
  }

  const isSuggested = suggestedAmount !== null && amount === String(suggestedAmount)

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent showCloseButton={false} className="block p-6">
        <div className="flex items-center justify-between mb-5">
          <DialogTitle className="text-base font-semibold text-heading">Abrir caja</DialogTitle>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-hover-bg transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-95 text-hint">
            <X className="w-4 h-4" />
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
      </DialogContent>
    </Dialog>
  )
}
