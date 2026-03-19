export default function StatsLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 shrink-0">
        <div className="skeleton-pulse h-6 w-40 rounded-lg" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          {/* Period tabs */}
          <div className="skeleton-pulse h-9 w-80 max-w-full rounded-full" />

          {/* KPI summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between min-h-[24px]">
                  <span />
                  <div className="skeleton-pulse h-5 w-14 rounded-full" />
                </div>
                <div className="space-y-2">
                  <div className="skeleton-pulse h-3 w-28 rounded" />
                  <div className="skeleton-pulse h-6 w-36 rounded-lg" />
                </div>
              </div>
            ))}
          </div>

          {/* Evolution chart + payment breakdown */}
          <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
            <div className="surface-card p-6">
              <div className="skeleton-pulse h-6 w-28 rounded-lg mb-3" />
              <div className="skeleton-pulse h-[200px] w-full rounded-xl" />
            </div>
            <div className="surface-card p-6">
              <div className="skeleton-pulse h-6 w-40 rounded-lg mb-4" />
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex justify-between">
                      <div className="skeleton-pulse h-4 w-24 rounded" />
                      <div className="skeleton-pulse h-4 w-10 rounded" />
                    </div>
                    <div className="skeleton-pulse h-2 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Day-of-week chart + product ranking */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="surface-card p-6">
              <div className="skeleton-pulse h-6 w-44 rounded-lg mb-3" />
              <div className="skeleton-pulse h-[180px] w-full rounded-xl" />
            </div>
            <div className="surface-card p-6">
              <div className="skeleton-pulse h-6 w-44 rounded-lg mb-4" />
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton-pulse h-4 w-4 rounded" />
                    <div className="skeleton-pulse flex-1 h-4 rounded" />
                    <div className="skeleton-pulse h-4 w-20 rounded" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
