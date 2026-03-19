'use client'

import { useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import DateRangeFilter, { type DateRangePeriod } from '@/components/shared/DateRangeFilter'
import ExportCSVButton from '@/components/shared/ExportCSVButton'
import PageHeader from '@/components/shared/PageHeader'

interface OperatorSalesRow {
  operator_id: string | null
  operator_name: string
  role: string
  transactions: number
  total_revenue: number
  avg_ticket: number
  units_sold: number
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  manager: 'Gerente',
  cashier: 'Cajero',
  custom: 'Personalizado',
}

interface Props {
  rows: OperatorSalesRow[]
  businessId: string | null
  period: string
  from?: string
  to?: string
}

export default function OperatorSalesDetailView({ rows, period, from, to }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  function navigate(newPeriod: DateRangePeriod, newFrom?: string, newTo?: string) {
    const params = new URLSearchParams()
    params.set('period', newPeriod)
    if (newPeriod === 'personalizado' && newFrom && newTo) {
      params.set('from', newFrom)
      params.set('to', newTo)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const sorted = useMemo(() => [...rows].sort((a, b) => (b.total_revenue ?? 0) - (a.total_revenue ?? 0)), [rows])

  const csvData = useMemo(() =>
    sorted.map(r => ({
      Operador: r.operator_name,
      Rol: ROLE_LABELS[r.role] ?? r.role,
      Transacciones: r.transactions,
      'Ingresos totales': r.total_revenue,
      'Ticket promedio': r.avg_ticket,
      'Unidades vendidas': r.units_sold,
    })),
    [sorted]
  )

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Operadores" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <ExportCSVButton data={csvData} filename="ventas-por-operador" />
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          <DateRangeFilter
            value={period as DateRangePeriod}
            from={from}
            to={to}
            onChange={navigate}
          />

          <div className="surface-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-edge/60">
                <tr className="text-xs text-hint font-medium">
                  <th className="text-left px-4 py-3">Operador</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Rol</th>
                  <th className="text-right px-4 py-3">Ingresos</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Transacciones</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Ticket promedio</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Unidades</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-hint py-12 text-sm">Sin datos para el período</td>
                  </tr>
                ) : (
                  sorted.map(row => (
                    <tr key={row.operator_id ?? row.operator_name} className="border-b border-edge/40 hover:bg-hover-bg transition-colors">
                      <td className="px-4 py-3 font-medium text-heading">{row.operator_name}</td>
                      <td className="px-4 py-3 text-body hidden md:table-cell">{ROLE_LABELS[row.role] ?? row.role}</td>
                      <td className="px-4 py-3 text-right font-semibold">${(row.total_revenue ?? 0).toLocaleString('es-AR')}</td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">{row.transactions ?? 0}</td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        ${(row.avg_ticket ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">{row.units_sold ?? 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
