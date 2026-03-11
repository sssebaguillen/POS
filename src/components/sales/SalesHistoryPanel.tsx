'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface SaleHistoryRow {
  id: string
  created_at: string
  total: number
  status: string | null
  payment_method: string | null
}

interface Props {
  sales: SaleHistoryRow[]
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizePayment(method: string | null) {
  if (!method) return 'sin dato'
  const map: Record<string, string> = {
    cash: 'Efectivo',
    card: 'Tarjeta',
    transfer: 'Transferencia',
    mercadopago: 'MercadoPago',
    credit: 'Crédito',
  }
  return map[method] ?? method
}

export default function SalesHistoryPanel({ sales }: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sales
    return sales.filter(sale => {
      return (
        sale.id.toLowerCase().includes(q) ||
        normalizePayment(sale.payment_method).toLowerCase().includes(q)
      )
    })
  }, [query, sales])

  const summary = useMemo(() => {
    const total = filtered.reduce((acc, sale) => acc + Number(sale.total), 0)
    return {
      count: filtered.length,
      total,
    }
  }, [filtered])

  function exportCsv() {
    const headers = ['id', 'fecha', 'hora', 'total', 'metodo_pago', 'estado']
    const rows = filtered.map(sale => {
      const date = new Date(sale.created_at)
      const fecha = date.toLocaleDateString('es-AR')
      const hora = formatTime(sale.created_at)
      return [
        sale.id,
        fecha,
        hora,
        Number(sale.total).toFixed(2),
        normalizePayment(sale.payment_method),
        sale.status ?? '',
      ]
    })

    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ventas-dia-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-heading">Historial de ventas del dia</h1>
          <p className="text-sm text-subtle">
            {summary.count} transacciones · ${summary.total.toLocaleString('es-AR')}
          </p>
        </div>
        <Button onClick={exportCsv} disabled={filtered.length === 0}>
          Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por id o metodo de pago..."
          className="h-10"
        />
      </div>

      <div className="rounded-xl border border-edge bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-body">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Hora</th>
              <th className="text-left px-4 py-2.5 font-medium">Metodo</th>
              <th className="text-left px-4 py-2.5 font-medium">Estado</th>
              <th className="text-right px-4 py-2.5 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-hint">
                  No hay ventas para mostrar
                </td>
              </tr>
            ) : (
              filtered.map(sale => (
                <tr key={sale.id} className="border-t">
                  <td className="px-4 py-3">{formatTime(sale.created_at)}</td>
                  <td className="px-4 py-3">{normalizePayment(sale.payment_method)}</td>
                  <td className="px-4 py-3">{sale.status ?? 'completed'}</td>
                  <td className="px-4 py-3 text-right font-semibold">
                    ${Number(sale.total).toLocaleString('es-AR')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
