'use client'

import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_LABELS, isPaymentMethod } from '@/lib/payments'
import type {
  CustomerData,
  CustomerSettlementNew,
  CustomerSettlementOld,
} from '@/components/activity/payloads'
import { DiffRow, Stat, toNumber } from '@/components/activity/detail/shared'

const CUSTOMER_FIELD_LABELS: Record<keyof CustomerData, string> = {
  name: 'Nombre',
  phone: 'Teléfono',
  email: 'Email',
  dni: 'DNI',
  credit_limit: 'Límite de crédito',
  credit_balance: 'Saldo',
  is_credit_enabled: 'Crédito',
  notes: 'Notas',
}

const CUSTOMER_FIELD_ORDER: (keyof CustomerData)[] = [
  'name',
  'phone',
  'email',
  'dni',
  'credit_limit',
  'is_credit_enabled',
  'notes',
]

interface CustomerSummaryProps {
  data: CustomerData | null
}

export function CustomerSummary({ data }: CustomerSummaryProps) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {data.name && <Stat label="Nombre" value={data.name} />}
        {data.phone && <Stat label="Teléfono" value={data.phone} />}
        {data.email && <Stat label="Email" value={data.email} />}
        {data.dni && <Stat label="DNI" value={data.dni} />}
        {data.credit_limit !== undefined && data.credit_limit !== null && (
          <Stat label="Límite de crédito" value={formatMoney(toNumber(data.credit_limit))} />
        )}
        {data.is_credit_enabled !== undefined && (
          <Stat label="Crédito" value={data.is_credit_enabled ? 'Habilitado' : 'Deshabilitado'} />
        )}
      </div>
    </div>
  )
}

interface CustomerDiffProps {
  oldData: CustomerData | null
  newData: CustomerData | null
}

export function CustomerDiff({ oldData, newData }: CustomerDiffProps) {
  const formatMoney = useFormatMoney()
  if (!oldData || !newData) return <p className="text-sm text-hint">Sin datos.</p>

  const rows: { label: string; before: string; after: string }[] = []

  for (const key of CUSTOMER_FIELD_ORDER) {
    if (!(key in newData)) continue
    const before = oldData[key]
    const after = newData[key]
    if (before === after) continue
    if (before == null && after == null) continue

    if (key === 'credit_limit') {
      rows.push({
        label: CUSTOMER_FIELD_LABELS[key],
        before: before == null ? '—' : formatMoney(toNumber(before)),
        after: after == null ? '—' : formatMoney(toNumber(after)),
      })
      continue
    }

    if (key === 'is_credit_enabled') {
      rows.push({
        label: CUSTOMER_FIELD_LABELS[key],
        before: before === true ? 'Habilitado' : 'Deshabilitado',
        after: after === true ? 'Habilitado' : 'Deshabilitado',
      })
      continue
    }

    rows.push({
      label: CUSTOMER_FIELD_LABELS[key],
      before: before == null || before === '' ? '—' : String(before),
      after: after == null || after === '' ? '—' : String(after),
    })
  }

  if (rows.length === 0) return <p className="text-sm text-hint">Sin cambios visibles.</p>

  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <DiffRow key={index} label={row.label} before={row.before} after={row.after} />
      ))}
    </div>
  )
}

interface CustomerSettlementProps {
  oldData: CustomerSettlementOld | null
  newData: CustomerSettlementNew | null
}

export function CustomerSettlement({ oldData, newData }: CustomerSettlementProps) {
  const formatMoney = useFormatMoney()
  if (!newData) return <p className="text-sm text-hint">Sin datos.</p>

  const previousBalance = oldData?.credit_balance != null ? toNumber(oldData.credit_balance) : null
  const nextBalance = newData.credit_balance != null ? toNumber(newData.credit_balance) : null
  const amount = newData.amount != null ? toNumber(newData.amount) : null
  const method =
    typeof newData.method === 'string' && isPaymentMethod(newData.method)
      ? PAYMENT_LABELS[newData.method]
      : newData.method ?? null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        {amount !== null && <Stat label="Monto pagado" value={formatMoney(amount)} emphasis />}
        {method && <Stat label="Método" value={method} />}
      </div>
      {previousBalance !== null && nextBalance !== null && (
        <DiffRow label="Saldo" before={formatMoney(previousBalance)} after={formatMoney(nextBalance)} />
      )}
    </div>
  )
}
