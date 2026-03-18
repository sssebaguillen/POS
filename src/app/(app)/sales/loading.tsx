export default function SalesLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 shrink-0">
        <div className="skeleton-pulse h-6 w-44 rounded-lg" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-4">
          {/* Filter bar */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="skeleton-pulse h-9 w-64 rounded-lg" />
            <div className="skeleton-pulse h-9 w-36 rounded-lg" />
            <div className="skeleton-pulse h-9 w-36 rounded-lg" />
          </div>

          {/* Summary row */}
          <div className="flex gap-4">
            <div className="skeleton-pulse h-4 w-40 rounded" />
            <div className="skeleton-pulse h-4 w-32 rounded" />
          </div>

          {/* Table */}
          <div className="surface-card overflow-hidden">
            <div className="border-b border-edge/50 px-4 py-3 grid grid-cols-[1fr_1fr_1fr_1fr_80px] gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton-pulse h-3 w-20 rounded" />
              ))}
            </div>
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="border-b border-edge/30 px-4 py-3.5 grid grid-cols-[1fr_1fr_1fr_1fr_80px] gap-4 items-center">
                <div className="skeleton-pulse h-4 w-24 rounded" />
                <div className="skeleton-pulse h-5 w-24 rounded-full" />
                <div className="skeleton-pulse h-4 w-20 rounded" />
                <div className="skeleton-pulse h-4 w-16 rounded" />
                <div className="skeleton-pulse h-7 w-16 rounded-lg ml-auto" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
