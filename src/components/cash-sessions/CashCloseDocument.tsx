'use client'

import { useFormatMoney } from '@/lib/context/CurrencyContext'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants/domain'
import type { PaymentMethod } from '@/lib/constants/domain'

// Comprobante de cierre de caja imprimible. Mismo patrón de aislamiento que
// ReceiptTemplate: oculto en pantalla y, en @media print, esconde todo el resto
// del documento y muestra SOLO `.cashclose-print-root` (ancho térmico 76mm,
// monoespaciado). Se monta oculto dentro del drawer; el botón "Imprimir cierre"
// solo llama window.print().

interface DigitalBalance {
  method: string
  opening_balance: number | null
  closing_balance: number | null
  sales_total: number
  expected: number | null
  difference: number | null
}

export interface CashCloseDetail {
  id: string
  opening_amount: number
  closing_amount: number | null
  expected_amount: number | null
  difference: number | null
  opened_at: string
  closed_at: string | null
  notes: string | null
  opened_by_name: string
  closed_by_name: string | null
  sales_count: number
  sales_total: number
  payments_by_method: { method: string; total: number }[]
  digital_balances: DigitalBalance[]
}

interface Props {
  businessName: string
  detail: CashCloseDetail
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function diffLabel(diff: number | null, formatMoney: (v: number) => string): string {
  if (diff === null) return '—'
  if (diff === 0) return 'Cuadra exacto'
  if (diff > 0) return `+${formatMoney(diff)} sobrante`
  return `${formatMoney(diff)} faltante`
}

const Divider = () => <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontWeight: bold ? 700 : 400 }}>
    <span>{label}</span>
    <span>{value}</span>
  </div>
)

function DocContent({ businessName, detail, formatMoney }: Props & { formatMoney: (v: number) => string }) {
  const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m
  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '18px', fontWeight: 700 }}>{businessName}</div>
        <div style={{ fontWeight: 700 }}>Cierre de caja</div>
        <div>Sesión #{detail.id.slice(0, 8).toUpperCase()}</div>
        <div style={{ fontSize: '11px' }}>Impreso: {new Date().toLocaleString('es-AR')}</div>
      </div>

      <Divider />

      <div style={{ display: 'grid', gap: '4px' }}>
        <Row label="Apertura" value={fmtDateTime(detail.opened_at)} />
        <div style={{ fontSize: '11px', opacity: 0.8, textAlign: 'right' }}>{detail.opened_by_name}</div>
        <Row label="Cierre" value={fmtDateTime(detail.closed_at)} />
        <div style={{ fontSize: '11px', opacity: 0.8, textAlign: 'right' }}>{detail.closed_by_name ?? '—'}</div>
        <Row label="Fondo inicial" value={formatMoney(detail.opening_amount)} />
      </div>

      <Divider />

      <div style={{ display: 'grid', gap: '4px' }}>
        <Row label="Ventas" value={String(detail.sales_count)} />
        <Row label="Total vendido" value={formatMoney(detail.sales_total)} bold />
      </div>

      {detail.payments_by_method.length > 0 && (
        <>
          <Divider />
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>Por método de pago</div>
          <div style={{ display: 'grid', gap: '4px' }}>
            {detail.payments_by_method.map(p => (
              <Row key={p.method} label={methodLabel(p.method)} value={formatMoney(p.total)} />
            ))}
          </div>
        </>
      )}

      {detail.expected_amount !== null && (
        <>
          <Divider />
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>Arqueo de efectivo</div>
          <div style={{ display: 'grid', gap: '4px' }}>
            <Row label="Efectivo esperado" value={formatMoney(detail.expected_amount)} />
            <Row label="Efectivo contado" value={formatMoney(detail.closing_amount ?? 0)} />
            <Row label="Diferencia" value={diffLabel(detail.difference, formatMoney)} bold />
          </div>
        </>
      )}

      {detail.digital_balances.length > 0 && (
        <>
          <Divider />
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>Cuentas digitales</div>
          <div style={{ display: 'grid', gap: '8px' }}>
            {detail.digital_balances.map(b => (
              <div key={b.method} style={{ display: 'grid', gap: '2px' }}>
                <div style={{ fontWeight: 700, fontSize: '12px' }}>{methodLabel(b.method)}</div>
                {b.opening_balance !== null && <Row label="Saldo inicial" value={formatMoney(b.opening_balance)} />}
                <Row label="Ventas" value={formatMoney(b.sales_total)} />
                {b.expected !== null && <Row label="Esperado" value={formatMoney(b.expected)} />}
                {b.closing_balance !== null && <Row label="Saldo final" value={formatMoney(b.closing_balance)} />}
                {b.difference !== null && <Row label="Diferencia" value={diffLabel(b.difference, formatMoney)} />}
              </div>
            ))}
          </div>
        </>
      )}

      {detail.notes && (
        <>
          <Divider />
          <div style={{ fontSize: '11px' }}>
            <span style={{ fontWeight: 700 }}>Notas: </span>{detail.notes}
          </div>
        </>
      )}

      <Divider />
      <div style={{ textAlign: 'center', fontSize: '11px' }}>
        Cerró: {detail.closed_by_name ?? '—'}
      </div>
    </>
  )
}

export default function CashCloseDocument({ businessName, detail }: Props) {
  const formatMoney = useFormatMoney()
  return (
    <div aria-hidden="true" className="pointer-events-none">
      <style>{`
        @media screen {
          .cashclose-print-root { display: none; }
        }
        @media print {
          @page { size: auto; margin: 0; }
          body { background: #ffffff !important; }
          body * { visibility: hidden; }
          .cashclose-print-root,
          .cashclose-print-root * { visibility: visible; }
          .cashclose-print-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 76mm;
            padding: 8mm 6mm 10mm;
            color: #000000;
            background: #ffffff;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 12px;
            line-height: 1.35;
          }
        }
      `}</style>

      <div className="cashclose-print-root">
        <DocContent businessName={businessName} detail={detail} formatMoney={formatMoney} />
      </div>
    </div>
  )
}
