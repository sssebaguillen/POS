export default function POSLoading() {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Product panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search bar */}
        <div className="border-b border-edge/60 px-4 py-3 flex items-center gap-3">
          <div className="skeleton-pulse h-9 flex-1 rounded-lg" />
          <div className="skeleton-pulse h-9 w-32 rounded-lg" />
        </div>

        {/* Category chips */}
        <div className="flex gap-2 px-4 py-3 border-b border-edge/30">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-pulse h-8 w-24 rounded-full" />
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="surface-card p-3 flex flex-col gap-2">
                <div className="skeleton-pulse h-20 w-full rounded-xl" />
                <div className="skeleton-pulse h-4 w-full rounded" />
                <div className="skeleton-pulse h-4 w-16 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cart panel */}
      <div className="w-80 shrink-0 border-l border-edge flex flex-col">
        <div className="border-b border-edge/60 px-4 py-3">
          <div className="skeleton-pulse h-6 w-24 rounded" />
        </div>
        <div className="flex-1 px-4 py-3 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="skeleton-pulse h-9 w-9 rounded-lg shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton-pulse h-4 w-full rounded" />
                <div className="skeleton-pulse h-3 w-16 rounded" />
              </div>
              <div className="skeleton-pulse h-4 w-14 rounded" />
            </div>
          ))}
        </div>
        <div className="border-t border-edge/60 p-4 space-y-3">
          <div className="skeleton-pulse h-4 w-full rounded" />
          <div className="skeleton-pulse h-12 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
