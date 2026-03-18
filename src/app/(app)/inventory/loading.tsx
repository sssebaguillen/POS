export default function InventoryLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 shrink-0">
        <div className="skeleton-pulse h-6 w-16 rounded-lg" />
        <div className="ml-auto skeleton-pulse h-9 w-36 rounded-lg" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-4">
          {/* Search + filters bar */}
          <div className="flex gap-3 flex-wrap">
            <div className="skeleton-pulse h-9 w-64 rounded-lg" />
            <div className="skeleton-pulse h-9 w-40 rounded-lg" />
            <div className="skeleton-pulse h-9 w-40 rounded-lg" />
          </div>

          {/* Table */}
          <div className="surface-card overflow-hidden">
            {/* Table header */}
            <div className="border-b border-edge/50 px-4 py-3 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4">
              {['Producto', 'Categoria', 'Stock', 'Precio', ''].map(col => (
                <div key={col} className="skeleton-pulse h-3 w-20 rounded" />
              ))}
            </div>
            {/* Table rows */}
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="border-b border-edge/30 px-4 py-3.5 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 items-center">
                <div className="flex items-center gap-3">
                  <div className="skeleton-pulse h-9 w-9 rounded-xl shrink-0" />
                  <div className="space-y-1.5">
                    <div className="skeleton-pulse h-4 w-32 rounded" />
                    <div className="skeleton-pulse h-3 w-20 rounded" />
                  </div>
                </div>
                <div className="skeleton-pulse h-4 w-20 rounded" />
                <div className="skeleton-pulse h-4 w-12 rounded" />
                <div className="skeleton-pulse h-4 w-20 rounded" />
                <div className="skeleton-pulse h-7 w-16 rounded-lg ml-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
