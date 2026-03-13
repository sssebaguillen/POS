'use client'

import { Fragment, useMemo, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export interface SaleItemDetail {
  product_name: string
  quantity: number
  unit_price: number
  total: number
}

export interface SaleHistoryRow {
  id: string
  created_at: string
  total: number
  status: string | null
  payment_method: string | null
  items: SaleItemDetail[]
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
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null)

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
    const items = filtered.reduce(
      (acc, sale) => acc + sale.items.reduce((itemAcc, item) => itemAcc + Number(item.quantity), 0),
      0
    )

    return {
      count: filtered.length,
      total,
      items,
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
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Ventas">
        <Button onClick={exportCsv} disabled={filtered.length === 0} size="sm" className="rounded-lg text-xs">
          Exportar CSV
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-edge/60 bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-hint">Transacciones</p>
            <p className="text-2xl font-bold text-heading mt-1">{summary.count}</p>
          </div>
          <div className="rounded-xl border border-edge/60 bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-hint">Total vendido</p>
            <p className="text-2xl font-bold text-heading mt-1">${summary.total.toLocaleString('es-AR')}</p>
          </div>
          <div className="rounded-xl border border-edge/60 bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-hint">Unidades vendidas</p>
            <p className="text-2xl font-bold text-heading mt-1">{summary.items}</p>
          </div>
        </div>

        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar por id o metodo de pago..."
          className="h-10 max-w-md"
        />

        <div className="rounded-xl border border-edge bg-surface overflow-hidden">
          <Table>
            <TableHeader className="bg-surface-alt">
              <TableRow>
                <TableHead>Hora</TableHead>
                <TableHead>Metodo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-hint">
                    No hay ventas para mostrar
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(sale => {
                  const isExpanded = expandedSaleId === sale.id

                  return (
                    <Fragment key={sale.id}>
                      <TableRow>
                        <TableCell>{formatTime(sale.created_at)}</TableCell>
                        <TableCell>{normalizePayment(sale.payment_method)}</TableCell>
                        <TableCell>
                          <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold bg-surface-alt text-body">
                            {sale.status ?? 'completed'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ${Number(sale.total).toLocaleString('es-AR')}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg text-xs"
                            onClick={() => setExpandedSaleId(isExpanded ? null : sale.id)}
                          >
                            {isExpanded ? 'Ocultar' : 'Ver'}
                          </Button>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow className="bg-surface-alt/50 hover:bg-surface-alt/50">
                          <TableCell colSpan={5}>
                            <div className="space-y-2 py-2">
                              <p className="text-xs uppercase tracking-wide text-hint">Items de la venta</p>
                              {sale.items.length === 0 ? (
                                <p className="text-sm text-hint">No hay items registrados</p>
                              ) : (
                                sale.items.map((item, index) => (
                                  <div key={`${sale.id}-${item.product_name}-${index}`} className="flex items-center justify-between text-sm">
                                    <span className="text-body">
                                      {item.product_name} x {item.quantity}
                                    </span>
                                    <span className="font-medium text-heading">
                                      ${item.total.toLocaleString('es-AR')}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
