'use client'

import { Button } from '@/components/ui/button'
import { normalizePayment } from '@/lib/payments'

interface SaleHistoryRow {
  id: string
  created_at: string
  total: number
  status: string | null
  method: string
}

interface Props {
  rows: SaleHistoryRow[]
}

export default function SalesHistoryTable({ rows }: Props) {
  function exportHistoryCsv() {
    const headers = ['id', 'fecha', 'hora', 'total', 'metodo', 'estado']
    const csvRows = rows.map(s => {
      const d = new Date(s.created_at)
      return [
        s.id,
        d.toLocaleDateString('es-AR'),
        d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
        Number(s.total).toFixed(2),
        s.method,
        s.status ?? 'completed',
      ]
    })
    const csv = [headers, ...csvRows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dashboard-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-2xl bg-surface border border-edge/60 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-heading">Historial detallado</p>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={exportHistoryCsv}
          disabled={rows.length === 0}
        >
          Exportar CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-subtle border-b">
              <th className="py-2 font-medium">Fecha</th>
              <th className="py-2 font-medium">Método</th>
              <th className="py-2 font-medium">Estado</th>
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map(sale => (
              <tr key={sale.id} className="border-b last:border-b-0">
                <td className="py-2 text-body">{new Date(sale.created_at).toLocaleString('es-AR')}</td>
                <td className="py-2 text-body">{normalizePayment(sale.method)}</td>
                <td className="py-2 text-body">{sale.status ?? 'completed'}</td>
                <td className="py-2 text-right font-medium">${Number(sale.total).toLocaleString('es-AR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
