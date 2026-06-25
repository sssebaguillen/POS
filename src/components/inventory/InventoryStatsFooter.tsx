import type { InventoryStats } from '@/components/inventory/inventoryStats'

interface Props {
  stats: InventoryStats
  formatMoney: (value: number) => string
}

/**
 * Barra de KPIs al pie del inventario (activos / stock / valor / margen / sin stock / bajo / categorías).
 * Presentacional pura — extraída de InventoryPanel sin cambiar el markup ni los datos
 * (consume el resultado de computeInventoryStats + formatMoney). Behavior-preserving.
 */
export default function InventoryStatsFooter({ stats, formatMoney }: Props) {
  const { activeProducts, totalStock, inventoryValue, avgMargin, outOfStock, lowStock, categoryCount } = stats

  return (
    <div className="bg-surface border-t border-edge/60 px-4 py-2 flex items-center gap-4 text-caption text-subtle shrink-0 overflow-x-auto whitespace-nowrap">
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="w-2 h-2 rounded-full bg-success" />
        <span className="hidden inv:inline">{activeProducts.length} productos activos</span>
        <span className="inv:hidden">{activeProducts.length} activos</span>
      </span>
      <span className="shrink-0">
        <span className="hidden inv:inline">{totalStock} uds en stock</span>
        <span className="inv:hidden">{totalStock} uds.</span>
      </span>
      <span className="shrink-0">
        <span className="hidden inv:inline">Valor inventario {formatMoney(inventoryValue)}</span>
        <span className="inv:hidden">{formatMoney(inventoryValue)}</span>
      </span>
      <span className="shrink-0">
        <span className="hidden inv:inline">Margen promedio {avgMargin.toFixed(0)}%</span>
        <span className="inv:hidden">~{avgMargin.toFixed(0)}%</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="w-2 h-2 rounded-full bg-destructive" />
        {outOfStock} sin stock
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="w-2 h-2 rounded-full bg-warning" />
        <span className="hidden inv:inline">{lowStock} stock bajo</span>
        <span className="inv:hidden">{lowStock} bajo</span>
      </span>
      <span className="ml-auto shrink-0 hidden inv:inline">{categoryCount} categorías</span>
    </div>
  )
}
