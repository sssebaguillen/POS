'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'
import { X, Printer } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import SelectDropdown from '@/components/ui/SelectDropdown'
import type { InventoryProduct } from '@/components/inventory/types'

interface PrintLabelsModalProps {
  products: InventoryProduct[]
  formatMoney: (value: number) => string
  onClose: () => void
}

// Formatos A4 estándar (Avery-like, disponibles en AR). w/h en mm; las métricas escalan el
// contenido al tamaño. Ajustables si el negocio usa otra plancha.
interface LabelPreset {
  id: string
  label: string
  w: number
  h: number
  name: string      // font-size del nombre
  brand: string     // font-size de la marca
  price: string     // font-size del precio
  barH: number      // alto del código (px, jsbarcode)
  barFont: number   // font-size del número bajo el código
  barW: number      // ancho de módulo del código
  nameLines: 1 | 2
}

const LABEL_PRESETS: LabelPreset[] = [
  { id: 'chica',   label: 'Chica · 38×21mm',     w: 38,   h: 21,   name: '6pt',   brand: '5pt',   price: '9pt',  barH: 14, barFont: 7,  barW: 1,   nameLines: 1 },
  { id: 'mediana', label: 'Mediana · 63.5×38mm', w: 63.5, h: 38.1, name: '8.5pt', brand: '6.5pt', price: '13pt', barH: 26, barFont: 9,  barW: 1.3, nameLines: 2 },
  { id: 'grande',  label: 'Grande · 70×42mm',    w: 70,   h: 42.3, name: '9pt',   brand: '7pt',   price: '15pt', barH: 30, barFont: 10, barW: 1.5, nameLines: 2 },
  { id: 'gondola', label: 'Góndola · 99×38mm',   w: 99.1, h: 38.1, name: '9pt',   brand: '7pt',   price: '16pt', barH: 28, barFont: 10, barW: 1.6, nameLines: 2 },
]

// Ancho útil de una A4 con márgenes de 5mm (210 − 2×5). El preview usa este ancho fijo para que
// la cantidad de columnas que ves sea EXACTAMENTE la que se imprime. 5mm es seguro para cualquier
// impresora y deja que las etiquetas anchas (góndola) entren de a 2.
const A4_MARGIN_MM = 5
const A4_CONTENT_MM = 210 - A4_MARGIN_MM * 2

// Tope alto solo como guard de performance (cada etiqueta es un SVG de barcode); rara vez se
// necesita tanto. El total impreso es productos × copias.
const MAX_COPIES = 200

// Código de barras Code128 vía jsbarcode sobre un <svg> (imperativo, vía ref — sin setState).
// El valor es lo que el scanner del POS reconoce: `barcode` exacto, o `sku`.
function Barcode({ value, height, fontSize, width }: { value: string; height: number; fontSize: number; width: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        width,
        height,
        fontSize,
        margin: 0,
        displayValue: true,
        background: '#ffffff',
        lineColor: '#000000',
      })
    } catch {
      // valor inválido para Code128 — la etiqueta queda sin barra
    }
  }, [value, height, fontSize, width])
  return <svg ref={ref} className="max-w-full" />
}

export default function PrintLabelsModal({ products, formatMoney, onClose }: PrintLabelsModalProps) {
  // El input vive como string para permitir vaciarlo y escribir de cero; `copies` es el número
  // derivado (clampeado) que se usa para generar etiquetas. En blur normalizamos el texto.
  const [copiesInput, setCopiesInput] = useState('1')
  const copies = Math.min(Math.max(parseInt(copiesInput, 10) || 1, 1), MAX_COPIES)
  const [presetId, setPresetId] = useState('mediana')
  const [showBrand, setShowBrand] = useState(true)
  const [showBarcode, setShowBarcode] = useState(true)

  const preset = LABEL_PRESETS.find(p => p.id === presetId) ?? LABEL_PRESETS[1]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Una etiqueta por producto, repetida `copies` veces.
  const labels = products.flatMap(p => Array.from({ length: copies }, (_, i) => ({ product: p, key: `${p.id}-${i}` })))

  return createPortal(
    <>
      {/* CSS de impresión: oculta TODO menos la hoja (visibility preserva el layout aunque la
          hoja viva dentro del overlay del portal). El ancho de columna sigue el preset. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #pulsar-label-sheet, #pulsar-label-sheet * { visibility: visible !important; }
          #pulsar-label-sheet { position: absolute !important; left: 0; top: 0; }
          @page { margin: ${A4_MARGIN_MM}mm; }
        }
      `}</style>

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div className="surface-elevated flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl">
          {/* Header */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4 print:hidden">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-heading">Imprimir etiquetas</h2>
              <p className="mt-0.5 text-xs text-subtle">
                {products.length} {products.length === 1 ? 'producto' : 'productos'} · {labels.length}{' '}
                {labels.length === 1 ? 'etiqueta' : 'etiquetas'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-hint transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)] hover:bg-hover-bg active:scale-95"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>

          {/* Controles */}
          <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-edge px-5 py-3 print:hidden">
            <label className="flex items-center gap-2 text-xs text-subtle">
              Tamaño
              <div className="w-56">
                <SelectDropdown
                  value={presetId}
                  onChange={setPresetId}
                  options={LABEL_PRESETS.map(p => ({ value: p.id, label: p.label }))}
                  usePortal
                />
              </div>
            </label>
            <label className="flex items-center gap-2 text-xs text-subtle">
              Copias
              <input
                type="text"
                inputMode="numeric"
                value={copiesInput}
                onChange={e => setCopiesInput(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={() => setCopiesInput(String(copies))}
                className="h-9 w-16 rounded-lg border border-input bg-card px-2 text-sm text-body tabular-nums"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-body">
              <input type="checkbox" checked={showBrand} onChange={e => setShowBrand(e.target.checked)} className="accent-primary" />
              Mostrar marca
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-body">
              <input type="checkbox" checked={showBarcode} onChange={e => setShowBarcode(e.target.checked)} className="accent-primary" />
              Mostrar código de barras
            </label>
          </div>

          {/* Preview / hoja imprimible */}
          <div className="overflow-auto bg-muted/30 p-6 print:overflow-visible print:bg-transparent print:p-0">
            {/* Hoja A4 centrada (chrome solo de pantalla; en impresión la grilla se posiciona
                absoluta al margen real). Reencuadra el sobrante como "el área alrededor de la hoja". */}
            <div
              className="mx-auto border border-edge/60 bg-white shadow-sm print:border-0 print:shadow-none"
              style={{ width: '210mm', padding: `${A4_MARGIN_MM}mm` }}
            >
              <div
                id="pulsar-label-sheet"
                className="grid justify-start"
                style={{ width: `${A4_CONTENT_MM}mm`, gridTemplateColumns: `repeat(auto-fill, ${preset.w}mm)`, gap: '1mm' }}
              >
              {labels.map(({ product, key }) => {
                const code = product.barcode || product.sku || ''
                return (
                  <div
                    key={key}
                    className="flex flex-col justify-between gap-0.5 overflow-hidden rounded-md border border-[#e0d4c0] bg-white p-[1.5mm] text-black"
                    style={{ width: `${preset.w}mm`, height: `${preset.h}mm` }}
                  >
                    <div className="min-h-0">
                      {showBrand && product.brand?.name && (
                        <p className="truncate uppercase tracking-wide text-neutral-500" style={{ fontSize: preset.brand }}>
                          {product.brand.name}
                        </p>
                      )}
                      <p
                        className={`font-medium leading-tight ${preset.nameLines === 1 ? 'line-clamp-1' : 'line-clamp-2'}`}
                        style={{ fontSize: preset.name }}
                      >
                        {product.name}
                      </p>
                    </div>
                    <p className="font-bold leading-none tabular-nums" style={{ fontSize: preset.price }}>
                      {formatMoney(Number(product.price))}
                    </p>
                    {showBarcode && (
                      <div className="flex items-end justify-center" style={{ minHeight: code ? undefined : 0 }}>
                        {code ? (
                          <Barcode value={code} height={preset.barH} fontSize={preset.barFont} width={preset.barW} />
                        ) : (
                          <span className="text-neutral-400 print:hidden" style={{ fontSize: preset.barFont }}>sin código</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-edge px-5 py-3 print:hidden">
            <Button type="button" variant="outline" className="h-9 px-4" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" className="h-9 px-4" onClick={() => window.print()}>
              <Printer size={16} />
              Imprimir
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
