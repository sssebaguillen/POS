'use client'

import { useFormatMoney } from '@/lib/context/CurrencyContext'
import type { CatalogOrderData } from '@/components/activity/payloads'
import { Stat, toNumber } from '@/components/activity/detail/shared'

const STATUS_LABEL: Record<string, string> = {
  recibido:     'Recibido',
  aceptado:     'Aceptado',
  en_camino:    'En camino',
  listo_retiro: 'Listo para retirar',
  completado:   'Completado',
  rechazado:    'Rechazado',
  cancelado:    'Cancelado',
}

const STATUS_CLASS: Record<string, string> = {
  recibido:     'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  aceptado:     'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  en_camino:    'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  listo_retiro: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  completado:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  rechazado:    'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  cancelado:    'bg-muted text-muted-foreground',
}

function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABEL[status] ?? status
  const cls = STATUS_CLASS[status] ?? STATUS_CLASS.cancelado
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function CustomerRow({ data }: { data: CatalogOrderData }) {
  const delivery = data.delivery_type === 'delivery' ? 'Delivery' : 'Para llevar'
  return (
    <div className="text-sm text-body space-y-0.5">
      <p>
        <span className="text-hint">Cliente:</span> {data.customer_name ?? '—'}
        {data.customer_phone ? ` · ${data.customer_phone}` : ''}
      </p>
      <p>
        <span className="text-hint">Entrega:</span> {delivery}
        {data.delivery_type === 'delivery' && data.address ? ` · ${data.address}` : ''}
      </p>
      {data.notes && (
        <p>
          <span className="text-hint">Notas:</span> {data.notes}
        </p>
      )}
    </div>
  )
}

export function CatalogOrderCreated({ data }: { data: CatalogOrderData | null }) {
  const formatMoney = useFormatMoney()
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>
  return (
    <div className="space-y-3">
      <CustomerRow data={data} />
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total" value={formatMoney(toNumber(data.total))} emphasis />
        <Stat label="Estado" value={STATUS_LABEL[data.status ?? 'recibido'] ?? data.status ?? 'Recibido'} />
      </div>
    </div>
  )
}

export function CatalogOrderTransition({
  oldData,
  newData,
}: {
  oldData: CatalogOrderData | null
  newData: CatalogOrderData | null
}) {
  const formatMoney = useFormatMoney()
  const data = newData ?? oldData
  if (!data) return <p className="text-sm text-hint">Sin datos.</p>

  const oldStatus = oldData?.status
  const newStatus = newData?.status

  return (
    <div className="space-y-3">
      {oldStatus && newStatus && oldStatus !== newStatus && (
        <div className="flex items-center gap-2 text-sm">
          <StatusPill status={oldStatus} />
          <span className="text-hint">→</span>
          <StatusPill status={newStatus} />
        </div>
      )}
      <CustomerRow data={data} />
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total" value={formatMoney(toNumber(data.total))} emphasis />
        {newStatus === 'completado' && newData?.sale_id && (
          <Stat label="Venta vinculada" value={String(newData.sale_id).slice(0, 8)} />
        )}
      </div>
    </div>
  )
}
