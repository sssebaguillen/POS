'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import PageHeader from '@/components/shared/PageHeader'
import { usePillIndicator } from '@/hooks/usePillIndicator'
import DeadStockLens from '@/components/stats/DeadStockLens'
import OverstockLens from '@/components/stats/OverstockLens'
import type {
  DeadStockRow, DeadStockSummary, DeadStockBucket,
  OverstockRow, OverstockSummary, InventoryHealthLens,
} from '@/lib/types'

interface Props {
  deadRows: DeadStockRow[]
  deadSummary: DeadStockSummary | null
  overstockRows: OverstockRow[]
  overstockSummary: OverstockSummary | null
  lens: InventoryHealthLens
  bucket: DeadStockBucket | null
  page: number
  pageSize: number
}

const LENSES: { key: InventoryHealthLens; label: string }[] = [
  { key: 'dead', label: 'Stock inmovilizado' },
  { key: 'overstock', label: 'Sobrestock' },
]

export default function InventoryHealthView({
  deadRows,
  deadSummary,
  overstockRows,
  overstockSummary,
  lens: initialLens,
  bucket: initialBucket,
  page: initialPage,
  pageSize,
}: Props) {
  const pathname = usePathname()
  const [lens, setLens] = useState<InventoryHealthLens>(initialLens)
  const { setRef, indicator } = usePillIndicator(lens)

  function switchLens(next: InventoryHealthLens) {
    if (next === lens) return
    setLens(next)
    if (typeof window === 'undefined') return
    window.history.replaceState(window.history.state, '', `${pathname}?lens=${next}`)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <PageHeader title="Salud de inventario" breadcrumbs={[{ label: 'Estadísticas', href: '/stats' }]}>
        <div className="pill-tabs">
          {indicator && (
            <span
              className="pill-tab-indicator"
              style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
            />
          )}
          {LENSES.map(l => (
            <button
              key={l.key}
              type="button"
              ref={setRef(l.key)}
              onClick={() => switchLens(l.key)}
              className={`pill-tab${lens === l.key ? ' pill-tab-active' : ''}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-6 space-y-4">
          {lens === 'dead' ? (
            <DeadStockLens
              rows={deadRows}
              summary={deadSummary}
              bucket={initialLens === 'dead' ? initialBucket : null}
              page={initialLens === 'dead' ? initialPage : 1}
              pageSize={pageSize}
            />
          ) : (
            <OverstockLens
              rows={overstockRows}
              summary={overstockSummary}
              page={initialLens === 'overstock' ? initialPage : 1}
              pageSize={pageSize}
            />
          )}
        </div>
      </div>
    </div>
  )
}
