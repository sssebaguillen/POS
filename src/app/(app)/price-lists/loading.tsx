export default function PriceListsLoading() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 shrink-0">
        <div className="skeleton-pulse h-6 w-44 rounded-lg" />
        <div className="ml-auto skeleton-pulse h-9 w-36 rounded-lg" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-4">
          {/* List panel */}
          <div className="surface-card overflow-hidden">
            {/* Panel header */}
            <div className="border-b border-edge/50 px-5 py-4 flex items-center gap-3">
              <div className="skeleton-pulse h-5 w-32 rounded" />
              <div className="skeleton-pulse h-5 w-16 rounded-full ml-2" />
            </div>

            {/* Price list rows */}
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-edge/30 px-5 py-4 flex items-center gap-4">
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-pulse h-5 w-40 rounded" />
                  <div className="skeleton-pulse h-3 w-24 rounded" />
                </div>
                <div className="skeleton-pulse h-7 w-20 rounded-full" />
                <div className="skeleton-pulse h-8 w-8 rounded-lg" />
              </div>
            ))}
          </div>

          {/* Override table placeholder */}
          <div className="surface-card p-6">
            <div className="skeleton-pulse h-5 w-44 rounded mb-4" />
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton-pulse h-12 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
