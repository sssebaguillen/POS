'use client'

import { PAYMENT_LABELS } from '@/lib/payments'
import { formatMoney } from '@/lib/format'
import type { ReceiptData } from '@/lib/printer/types'

interface Props {
  receipt: ReceiptData
  showPreview?: boolean
}

function ReceiptContent({ receipt }: { receipt: ReceiptData }) {
  const createdAt = new Date(receipt.createdAt)

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '20px', fontWeight: 700 }}>{receipt.businessName}</div>
        <div>Comprobante de venta</div>
        <div>{createdAt.toLocaleString('es-AR')}</div>
        <div>Venta #{receipt.saleId.slice(0, 8).toUpperCase()}</div>
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div>
        {receipt.items.map(item => (
          <div key={item.product_id} style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ flex: 1 }}>
                {item.icon ? `${item.icon} ` : ''}
                {item.quantity}x {item.name}
              </span>
              <span>{formatMoney(item.total)}</span>
            </div>
            <div style={{ fontSize: '11px', opacity: 0.75 }}>
              {formatMoney(item.unit_price)} c/u
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ display: 'grid', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Subtotal</span>
          <span>{formatMoney(receipt.subtotal)}</span>
        </div>

        {receipt.discount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Descuento</span>
            <span>-{formatMoney(receipt.discount)}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '15px' }}>
          <span>Total</span>
          <span>{formatMoney(receipt.total)}</span>
        </div>
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

      <div style={{ display: 'grid', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Pago</span>
          <span>{PAYMENT_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}</span>
        </div>

        {receipt.paymentMethod === 'cash' && receipt.cashReceived !== null && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Recibido</span>
              <span>{formatMoney(receipt.cashReceived)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Vuelto</span>
              <span>{formatMoney(receipt.change)}</span>
            </div>
          </>
        )}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0 10px' }} />

      <div style={{ textAlign: 'center' }}>
        Gracias por tu compra
      </div>
    </>
  )
}

export default function ReceiptTemplate({ receipt, showPreview = false }: Props) {

  return (
    <div aria-hidden="true" className="pointer-events-none">
      <style>{`
        @media screen {
          .receipt-print-root {
            display: none;
          }
        }

        @media print {
          @page {
            size: auto;
            margin: 0;
          }

          body {
            background: #ffffff !important;
          }

          body * {
            visibility: hidden;
          }

          .receipt-print-root,
          .receipt-print-root * {
            visibility: visible;
          }

          .receipt-print-root {
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

      {showPreview && (
        <div className="pointer-events-auto rounded-xl border border-edge-soft bg-white px-4 py-5 text-black shadow-sm">
          <div
            style={{
              width: '100%',
              maxWidth: '340px',
              margin: '0 auto',
              fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
              fontSize: '12px',
              lineHeight: 1.35,
            }}
          >
            <ReceiptContent receipt={receipt} />
          </div>
        </div>
      )}

      <div className="receipt-print-root">
        <ReceiptContent receipt={receipt} />
      </div>
    </div>
  )
}
