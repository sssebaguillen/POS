'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import type { DateRangePeriod } from '@/components/shared/DateRangeFilter'
import Toast from '@/components/shared/Toast'
import { useToast } from '@/hooks/useToast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { UserRole } from '@/lib/operator'
import { OPERATOR_ROLE_LABELS, PROFILE_ROLE_LABELS } from '@/lib/constants/domain'
import { useFormatMoney } from '@/lib/context/CurrencyContext'

interface OperatorTopProduct {
  product_name: string
  total_quantity: number
  total_revenue: number
}

interface OperatorSaleHistoryRow {
  id: string
  total: number
  created_at: string
  status: string | null
  items_count: number
}

interface OperatorMeViewProps {
  businessId: string
  operatorId: string
  operatorName: string
  operatorRole: UserRole
  memberSinceLabel: string
  canChangePin: boolean
  period: DateRangePeriod
  from?: string
  to?: string
  totalSales: number
  totalRevenue: number
  topProducts: OperatorTopProduct[]
  saleHistory: OperatorSaleHistoryRow[]
}

function normalizePin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

function roleLabel(role: UserRole): string {
  if (role === 'owner') return PROFILE_ROLE_LABELS.owner
  return OPERATOR_ROLE_LABELS[role]
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusLabel(status: string | null): string {
  if (status === 'cancelled') return 'Cancelada'
  if (status === 'refunded') return 'Reembolsada'
  return 'Completada'
}

export default function OperatorMeView({
  businessId,
  operatorId,
  operatorName,
  operatorRole,
  memberSinceLabel,
  canChangePin,
  period,
  from,
  to,
  totalSales,
  totalRevenue,
  topProducts,
  saleHistory,
}: OperatorMeViewProps) {
  const formatMoney = useFormatMoney()
  const supabase = useMemo(() => createClient(), [])
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [currentPinError, setCurrentPinError] = useState('')
  const [newPinError, setNewPinError] = useState('')
  const [confirmPinError, setConfirmPinError] = useState('')
  const currentPinRef = useRef<HTMLInputElement>(null)
  const newPinRef = useRef<HTMLInputElement>(null)
  const confirmPinRef = useRef<HTMLInputElement>(null)
  const { toast, showToast, dismissToast } = useToast()

  async function handleChangePin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setCurrentPinError('')
    setNewPinError('')
    setConfirmPinError('')

    let hasError = false

    if (!currentPin) {
      setCurrentPinError('Ingresá tu PIN actual.')
      hasError = true
    }

    if (!newPin) {
      setNewPinError('Ingresá el nuevo PIN.')
      hasError = true
    } else if (!/^\d{4}$|^\d{6}$/.test(newPin)) {
      setNewPinError('Debe tener exactamente 4 o 6 dígitos.')
      hasError = true
    }

    if (!confirmPin) {
      setConfirmPinError('Repetí el nuevo PIN.')
      hasError = true
    } else if (newPin && confirmPin !== newPin) {
      setConfirmPinError('Los PINs no coinciden.')
      hasError = true
    }

    if (hasError) {
      if (!currentPin) {
        currentPinRef.current?.focus()
      } else if (!newPin || !/^\d{4}$|^\d{6}$/.test(newPin)) {
        newPinRef.current?.focus()
      } else {
        confirmPinRef.current?.focus()
      }
      return
    }

    setSavingPin(true)

    const { data: verifyResult, error: verifyError } = await supabase.rpc('verify_operator_pin', {
      p_business_id: businessId,
      p_operator_id: operatorId,
      p_pin: currentPin,
    })

    if (verifyError || verifyResult?.success !== true) {
      setSavingPin(false)
      setCurrentPinError('PIN incorrecto.')
      currentPinRef.current?.focus()
      return
    }

    const { error: updateError } = await supabase.rpc('update_operator', {
      p_operator_id: operatorId,
      p_name: null,
      p_new_pin: newPin,
      p_permissions: null,
    })

    setSavingPin(false)

    if (updateError) {
      showToast({ message: 'No se pudo actualizar el PIN. Intentá de nuevo.' })
      return
    }

    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    showToast({ message: 'PIN actualizado correctamente.' })
  }

  const initials = operatorName.charAt(0).toUpperCase()
  const avgTicket = totalSales > 0 ? totalRevenue / totalSales : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">

          {/* Compact identity bar */}
          <div className="surface-card px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold font-display select-none" aria-hidden>
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground font-display leading-tight" title={operatorName}>{operatorName}</p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{roleLabel(operatorRole)}</span>
                  <span className="text-muted-foreground/40" aria-hidden>•</span>
                  <span>Miembro desde {memberSinceLabel}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Stats — primary content */}
          <section aria-labelledby="section-stats" className="space-y-4">
            <div className="flex flex-col gap-3">
              <div>
                <h2 id="section-stats" className="text-base font-semibold text-foreground font-display">Estadísticas personales</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Revisá tus ventas, productos más vendidos e historial reciente.
                </p>
              </div>
              <DateRangeFilter value={period} from={from} to={to} useUrlParams />
            </div>

            {/* KPI strip — stacked on mobile, side-by-side from sm */}
            <div className="surface-card p-5">
              <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="pb-4 sm:pb-0 sm:pr-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Ventas realizadas</p>
                  <p className="mt-2 text-3xl font-semibold text-foreground font-display tracking-tight">
                    {totalSales.toLocaleString('es-AR')}
                  </p>
                </div>
                <div className="pt-4 sm:pt-0 sm:pl-5">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Monto total</p>
                  <p className="mt-2 text-3xl font-semibold text-foreground font-display tracking-tight">
                    {formatMoney(totalRevenue)}
                  </p>
                  {avgTicket !== null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      ticket promedio {formatMoney(avgTicket)}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.1fr,1.4fr]">
              <section className="surface-card overflow-hidden">
                <div className="border-b border-edge-soft px-5 py-4">
                  <h3 className="text-base font-semibold text-foreground font-display">Top productos</h3>
                </div>
                <div className="overflow-x-auto p-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">#</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Unidades</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                            No hay productos para mostrar en este período.
                          </TableCell>
                        </TableRow>
                      ) : (
                        topProducts.map((product, index) => (
                          <TableRow key={`${product.product_name}-${index}`}>
                            <TableCell className="text-xs font-medium text-muted-foreground tabular-nums">
                              {index + 1}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate font-medium text-foreground" title={product.product_name}>
                              {product.product_name}
                            </TableCell>
                            <TableCell className="text-right">{product.total_quantity.toLocaleString('es-AR')}</TableCell>
                            <TableCell className="text-right font-medium text-foreground">
                              {formatMoney(product.total_revenue)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section className="surface-card overflow-hidden">
                <div className="border-b border-edge-soft px-5 py-4">
                  <h3 className="text-base font-semibold text-foreground font-display">Historial de ventas</h3>
                </div>
                <div className="overflow-x-auto p-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {saleHistory.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                            No hay ventas registradas en este período.
                          </TableCell>
                        </TableRow>
                      ) : (
                        saleHistory.map(sale => {
                          const isVoid = sale.status === 'cancelled' || sale.status === 'refunded'
                          return (
                            <TableRow key={sale.id} className={isVoid ? 'opacity-50' : undefined}>
                              <TableCell className="min-w-[180px]">
                                <div className="flex flex-col">
                                  <span className="font-medium text-foreground">{formatDateTime(sale.created_at)}</span>
                                  <span className="text-xs text-muted-foreground">{statusLabel(sale.status)}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{sale.items_count.toLocaleString('es-AR')}</TableCell>
                              <TableCell className={`text-right font-medium ${isVoid ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                                {formatMoney(sale.total)}
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          </section>

          {/* PIN — secondary, below stats */}
          {canChangePin && (
            <section aria-labelledby="section-pin" className="surface-card p-6">
              <div className="mb-5">
                <h2 id="section-pin" className="text-base font-semibold text-foreground font-display">Cambiar PIN</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Verificá tu PIN actual antes de definir uno nuevo.
                </p>
              </div>

              <form onSubmit={handleChangePin} className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label htmlFor="pin-current" className="text-xs uppercase tracking-wide text-muted-foreground">PIN actual</label>
                  <Input
                    ref={currentPinRef}
                    id="pin-current"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={currentPin}
                    aria-invalid={!!currentPinError || undefined}
                    aria-describedby={currentPinError ? 'pin-current-error' : undefined}
                    onChange={event => {
                      setCurrentPin(normalizePin(event.target.value))
                      if (currentPinError) setCurrentPinError('')
                    }}
                    placeholder="4 o 6 dígitos"
                  />
                  {currentPinError && (
                    <p id="pin-current-error" role="alert" aria-live="polite" className="text-xs text-destructive">{currentPinError}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pin-new" className="text-xs uppercase tracking-wide text-muted-foreground">PIN nuevo</label>
                  <Input
                    ref={newPinRef}
                    id="pin-new"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={newPin}
                    aria-invalid={!!newPinError || undefined}
                    aria-describedby={newPinError ? 'pin-new-error' : undefined}
                    onChange={event => {
                      setNewPin(normalizePin(event.target.value))
                      if (newPinError) setNewPinError('')
                    }}
                    onBlur={() => {
                      if (newPin && !/^\d{4}$|^\d{6}$/.test(newPin)) {
                        setNewPinError('Debe tener exactamente 4 o 6 dígitos.')
                      }
                    }}
                    placeholder="4 o 6 dígitos"
                  />
                  {newPinError && (
                    <p id="pin-new-error" role="alert" aria-live="polite" className="text-xs text-destructive">{newPinError}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="pin-confirm" className="text-xs uppercase tracking-wide text-muted-foreground">Confirmar PIN nuevo</label>
                  <Input
                    ref={confirmPinRef}
                    id="pin-confirm"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={confirmPin}
                    aria-invalid={!!confirmPinError || undefined}
                    aria-describedby={confirmPinError ? 'pin-confirm-error' : undefined}
                    onChange={event => {
                      setConfirmPin(normalizePin(event.target.value))
                      if (confirmPinError) setConfirmPinError('')
                    }}
                    onBlur={() => {
                      if (confirmPin && newPin && confirmPin !== newPin) {
                        setConfirmPinError('Los PINs no coinciden.')
                      }
                    }}
                    placeholder="Repetí el PIN"
                  />
                  {confirmPinError && (
                    <p id="pin-confirm-error" role="alert" aria-live="polite" className="text-xs text-destructive">{confirmPinError}</p>
                  )}
                </div>

                <div className="md:col-span-3 flex justify-end">
                  <Button type="submit" size="lg" disabled={savingPin} aria-busy={savingPin}>
                    {savingPin ? 'Guardando...' : 'Actualizar PIN'}
                  </Button>
                </div>
              </form>
            </section>
          )}

        </div>
      </div>

      {toast && <Toast message={toast.message} duration={toast.duration} onDismiss={dismissToast} />}
    </div>
  )
}
