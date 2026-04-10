'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import DateRangeFilter from '@/components/shared/DateRangeFilter'
import type { DateRangePeriod } from '@/components/shared/DateRangeFilter'
import Toast from '@/components/shared/Toast'
import { useToast } from '@/hooks/useToast'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { UserRole } from '@/lib/operator'

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
  if (role === 'owner') return 'Owner'
  if (role === 'manager') return 'Manager'
  if (role === 'custom') return 'Custom'
  return 'Cashier'
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString('es-AR')}`
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
  const supabase = useMemo(() => createClient(), [])
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const { toast, showToast, dismissToast } = useToast()

  async function handleChangePin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentPin) {
      showToast({ message: 'Ingresá tu PIN actual.' })
      return
    }

    if (!newPin || !confirmPin) {
      showToast({ message: 'Completa el nuevo PIN y su confirmación.' })
      return
    }

    if (newPin !== confirmPin) {
      showToast({ message: 'El nuevo PIN y la confirmación no coinciden.' })
      return
    }

    if (!/^\d{4}$|^\d{6}$/.test(newPin)) {
      showToast({ message: 'El nuevo PIN debe contener exactamente 4 o 6 dígitos.' })
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
      showToast({ message: verifyResult?.error ?? verifyError?.message ?? 'El PIN actual no es válido.' })
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
      showToast({ message: updateError.message })
      return
    }

    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    showToast({ message: 'PIN actualizado correctamente.' })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <section className="surface-card p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Operario activo</p>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">{operatorName}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{roleLabel(operatorRole)}</span>
              <span className="text-border">•</span>
              <span>Miembro desde {memberSinceLabel}</span>
            </div>
          </section>

          {canChangePin && (
            <section className="surface-card p-6">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-foreground">Cambiar PIN</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Verificá tu PIN actual antes de definir uno nuevo.
                </p>
              </div>

              <form onSubmit={handleChangePin} className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">PIN actual</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={currentPin}
                    onChange={event => setCurrentPin(normalizePin(event.target.value))}
                    placeholder="4 o 6 dígitos"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">PIN nuevo</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={newPin}
                    onChange={event => setNewPin(normalizePin(event.target.value))}
                    placeholder="4 o 6 dígitos"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Confirmar PIN nuevo</label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={confirmPin}
                    onChange={event => setConfirmPin(normalizePin(event.target.value))}
                    placeholder="Repetí el PIN"
                  />
                </div>

                <div className="md:col-span-3 flex justify-end">
                  <Button type="submit" disabled={savingPin}>
                    {savingPin ? 'Guardando...' : 'Actualizar PIN'}
                  </Button>
                </div>
              </form>
            </section>
          )}

          <section className="space-y-4">
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Estadísticas personales</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Revisá tus ventas, productos más vendidos e historial reciente.
                </p>
              </div>
              <DateRangeFilter value={period} from={from} to={to} useUrlParams />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="surface-card p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Ventas realizadas</p>
                <p className="mt-3 text-3xl font-semibold text-foreground">{totalSales.toLocaleString('es-AR')}</p>
              </div>
              <div className="surface-card p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Monto total</p>
                <p className="mt-3 text-3xl font-semibold text-foreground">{formatMoney(totalRevenue)}</p>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr,1.4fr]">
              <section className="surface-card overflow-hidden">
                <div className="border-b border-edge-soft px-5 py-4">
                  <h3 className="text-base font-semibold text-foreground">Top productos</h3>
                </div>
                <div className="p-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Unidades</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                            No hay productos para mostrar en este período.
                          </TableCell>
                        </TableRow>
                      ) : (
                        topProducts.map(product => (
                          <TableRow key={product.product_name}>
                            <TableCell className="max-w-[220px] truncate font-medium text-foreground">
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
                  <h3 className="text-base font-semibold text-foreground">Historial de ventas</h3>
                </div>
                <div className="p-4">
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
                        saleHistory.map(sale => (
                          <TableRow key={sale.id}>
                            <TableCell className="min-w-[180px]">
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">{formatDateTime(sale.created_at)}</span>
                                <span className="text-xs text-muted-foreground">{statusLabel(sale.status)}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{sale.items_count.toLocaleString('es-AR')}</TableCell>
                            <TableCell className="text-right font-medium text-foreground">
                              {formatMoney(sale.total)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          </section>
        </div>
      </div>

      {toast && <Toast message={toast.message} duration={toast.duration} onDismiss={dismissToast} />}
    </div>
  )
}
