'use client'

import SelectDropdown from '@/components/ui/SelectDropdown'
import { applyRounding } from '@/lib/price-lists'
import { formatMoney } from '@/lib/format'

// Pasos de redondeo cubren desde precios chicos (0,1 / 1 → MX, UY, ES, US) hasta
// precios grandes (10 / 50 / 100 → AR, CL). Todo es la misma fórmula: múltiplo más cercano.
const STEP_OPTIONS = [
  { value: '', label: 'Sin redondeo' },
  { value: '0.1', label: 'A 1 decimal (0,10)' },
  { value: '1', label: 'Sin decimales (1)' },
  { value: '5', label: 'Al múltiplo de 5' },
  { value: '10', label: 'Al múltiplo de 10' },
  { value: '50', label: 'Al múltiplo de 50' },
  { value: '100', label: 'Al múltiplo de 100' },
]

// Precio "feo" de muestra para que el dueño vea el efecto antes de guardar.
// Elegido justo por encima de un múltiplo redondo: con redondeo matemático baja y
// con "hacia arriba" sube, así el efecto del checkbox se ve en todos los pasos.
const SAMPLE_PRICE = 1201.34

interface RoundingFieldProps {
  step: number | null
  up: boolean
  onChange: (step: number | null, up: boolean) => void
}

export default function RoundingField({ step, up, onChange }: RoundingFieldProps) {
  const rounded = applyRounding(SAMPLE_PRICE, step, up)

  return (
    <div className="flex flex-col gap-2">
      <label className="text-label text-subtle">Redondeo de precios</label>

      <SelectDropdown
        value={step == null ? '' : String(step)}
        onChange={next => onChange(next === '' ? null : Number(next), up)}
        options={STEP_OPTIONS}
        usePortal
      />

      {step != null && (
        <>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={up}
              onChange={event => onChange(step, event.target.checked)}
              className="h-4 w-4 rounded border-edge accent-primary cursor-pointer"
            />
            <span className="text-sm text-body">Redondear siempre hacia arriba</span>
          </label>

          <p className="rounded-lg border border-edge/70 bg-surface px-3 py-2 text-caption text-hint">
            Ejemplo: {formatMoney(SAMPLE_PRICE)} → <span className="text-body font-medium">{formatMoney(rounded)}</span>
          </p>
        </>
      )}

      <p className="text-caption text-hint">
        Se aplica solo a los precios que esta lista calcula desde el costo. No cambia el precio base de tus productos.
      </p>
    </div>
  )
}
