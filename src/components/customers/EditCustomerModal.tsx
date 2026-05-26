'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import { formatMoney } from '@/lib/format'
import { PAYMENT_LABELS } from '@/lib/payments'
import Toast from '@/components/shared/Toast'
import type { Customer } from '@/lib/types'
import { ERR } from '@/lib/errors'

type SettlementMethod = 'cash' | 'card' | 'transfer'

const SETTLEMENT_METHODS: SettlementMethod[] = ['cash', 'card', 'transfer']

interface Props {
  open: boolean
  onClose: () => void
  customer: Customer
  operatorId: string | null
  onUpdated: (customer: Customer) => void
}

export default function EditCustomerModal({ open, onClose, customer, operatorId, onUpdated }: Props) {
  const supabase = useMemo(() => createClient(), [])

  const [name, setName] = useState(customer.name)
  const [phone, setPhone] = useState(customer.phone ?? '')
  const [email, setEmail] = useState(customer.email ?? '')
  const [dni, setDni] = useState(customer.dni ?? '')
  const [creditLimit, setCreditLimit] = useState(String(customer.credit_limit))
  const [isCreditEnabled, setIsCreditEnabled] = useState(customer.is_credit_enabled)
  const [notes, setNotes] = useState(customer.notes ?? '')
  const [creditBalance, setCreditBalance] = useState(customer.credit_balance)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [showSettleForm, setShowSettleForm] = useState(false)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleMethod, setSettleMethod] = useState<SettlementMethod>('cash')
  const [settleError, setSettleError] = useState<string | null>(null)
  const [settling, setSettling] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(ERR.CST41)
      return
    }

    const parsedLimit = Number.parseFloat(creditLimit.replace(',', '.'))
    if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
      setError(ERR.CST42)
      return
    }

    setSaving(true)
    setError(null)

    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('update_customer', {
        p_operator_id: operatorId,
        p_business_id: customer.business_id,
        p_customer_id: customer.id,
        p_name: trimmedName,
        p_phone: phone.trim() || null,
        p_email: email.trim() || null,
        p_dni: dni.trim() || null,
        p_credit_limit: parsedLimit,
        p_is_credit_enabled: isCreditEnabled,
        p_notes: notes.trim() || null,
      })

      const result = rpcResult as { success: boolean; error?: string; customer?: Customer } | null

      if (rpcError || !result?.success || !result.customer) {
        setError(result?.error ?? ERR.CST1)
        return
      }

      onUpdated(result.customer)
    } catch {
      setError(ERR.CST1)
    } finally {
      setSaving(false)
    }
  }

  async function handleSettlePayment() {
    const parsedAmount = Number.parseFloat(settleAmount.replace(',', '.'))
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setSettleError('El monto debe ser mayor a 0.')
      return
    }
    if (parsedAmount > creditBalance) {
      setSettleError(`El monto no puede superar la deuda actual (${formatMoney(creditBalance)}).`)
      return
    }

    setSettling(true)
    setSettleError(null)

    const { data, error: rpcError } = await supabase.rpc('settle_customer_credit', {
      p_customer_id: customer.id,
      p_amount: parsedAmount,
      p_method: settleMethod,
      p_operator_id: operatorId,
    })

    if (rpcError) {
      setSettleError(rpcError.message ?? 'No se pudo registrar el pago.')
      setSettling(false)
      return
    }

    const nextBalance =
      typeof data === 'number'
        ? data
        : Math.max(0, creditBalance - parsedAmount)

    setCreditBalance(nextBalance)
    setShowSettleForm(false)
    setSettleAmount('')
    setSettleMethod('cash')
    setSettling(false)
    setToast('Pago registrado correctamente.')
    onUpdated({ ...customer, credit_balance: nextBalance })
  }

  if (!open) return null

  return (
    <>
      <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
        <DialogContent
          className="sm:max-w-md p-0 gap-0 overflow-hidden bg-card flex flex-col"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-edge shrink-0">
            <DialogTitle className="text-base font-semibold text-heading">Editar cliente</DialogTitle>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-hover-bg transition-colors text-hint"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
            <div className="space-y-1.5">
              <label className="text-label text-subtle">
                Nombre <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={e => { setName(e.target.value); setError(null) }}
                placeholder="Nombre del cliente"
                maxLength={120}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-label text-subtle">Teléfono</label>
                <Input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+54 9 XXXX XXXXXX"
                  maxLength={30}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-label text-subtle">DNI</label>
                <Input
                  value={dni}
                  onChange={e => setDni(e.target.value)}
                  placeholder="DNI"
                  maxLength={20}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-label text-subtle">Email</label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="email@ejemplo.com"
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-label text-subtle">Límite de crédito</label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={creditLimit}
                onChange={e => { setCreditLimit(e.target.value); setError(null) }}
                placeholder="0"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-edge px-3 py-2.5">
              <span className="text-sm text-body">Habilitar crédito</span>
              <button
                type="button"
                role="switch"
                aria-checked={isCreditEnabled}
                onClick={() => setIsCreditEnabled(prev => !prev)}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${isCreditEnabled ? 'bg-primary' : 'bg-muted-foreground'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card shadow-sm transition-transform ${isCreditEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-label text-subtle">Notas</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Notas internas (opcional)"
                rows={3}
                maxLength={500}
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-body placeholder:text-hint focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring outline-none transition-colors resize-none dark:bg-input/30"
              />
            </div>

            {isCreditEnabled && (
              <div className="rounded-xl border border-edge/70 p-3.5 space-y-3">
                <p className="text-label text-subtle">Cuenta corriente</p>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-body">Deuda actual</span>
                  <span className={`text-sm tabular-nums font-semibold ${creditBalance > 0 ? 'text-destructive' : 'text-hint'}`}>
                    {formatMoney(creditBalance)}
                  </span>
                </div>

                {!showSettleForm ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowSettleForm(true)}
                    disabled={creditBalance <= 0}
                    className="h-9 w-full rounded-lg text-sm border border-edge"
                  >
                    Registrar pago
                  </Button>
                ) : (
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
                        value={settleAmount}
                        onChange={e => { setSettleAmount(e.target.value); setSettleError(null) }}
                        placeholder="0.00"
                        autoFocus
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-label text-subtle">Método</label>
                      <div className="flex gap-2">
                        {SETTLEMENT_METHODS.map(method => (
                          <button
                            key={method}
                            type="button"
                            onClick={() => setSettleMethod(method)}
                            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              settleMethod === method
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-transparent text-body border-edge hover:bg-hover-bg'
                            }`}
                          >
                            {PAYMENT_LABELS[method]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {settleError && (
                      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {settleError}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="cancel"
                        onClick={() => {
                          setShowSettleForm(false)
                          setSettleAmount('')
                          setSettleMethod('cash')
                          setSettleError(null)
                        }}
                        disabled={settling}
                        className="h-8 rounded-lg text-sm"
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void handleSettlePayment()}
                        disabled={settling || creditBalance <= 0}
                        className="h-8 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        {settling ? 'Confirmando...' : 'Confirmar pago'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="border-t border-edge px-5 py-4 flex items-center justify-end gap-2.5 shrink-0">
            <Button
              type="button"
              variant="cancel"
              onClick={onClose}
              disabled={saving}
              className="h-9 rounded-lg text-sm"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="h-9 rounded-lg text-sm bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          message={toast}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  )
}
