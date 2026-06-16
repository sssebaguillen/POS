export default function DashboardLoading() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 gap-4 shrink-0">
        <div className="skeleton-pulse h-6 w-36 rounded-lg" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          {/* Filter row: date range (left) + AI glyph & view tabs (right) */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="skeleton-pulse h-9 w-[340px] max-w-full rounded-full" />
            <div className="flex items-center gap-2">
              <div className="skeleton-pulse h-9 w-9 rounded-lg" />
              <div className="skeleton-pulse h-9 w-[190px] rounded-full" />
            </div>
          </div>

          {/* KPI Cards — 3, no icons (mirror KPICard) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="surface-card p-5 flex flex-col">
                <div className="skeleton-pulse h-3 w-20 rounded mb-3" />
                <div className="skeleton-pulse h-8 w-28 rounded-lg" />
                <div className="skeleton-pulse h-3 w-24 rounded mt-3" />
                <div className="skeleton-pulse h-20 w-full rounded-lg mt-4" />
              </div>
            ))}
          </div>

          {/* Balance (wide) + Recent activity (narrow) */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-stretch">
            <div className="xl:col-span-3 surface-card p-5 flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <div className="skeleton-pulse h-4 w-32 rounded" />
                  <div className="skeleton-pulse h-3 w-20 rounded" />
                </div>
                <div className="skeleton-pulse h-3 w-16 rounded" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 pb-4 border-b border-edge/40">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="skeleton-pulse h-3 w-16 rounded" />
                    <div className="skeleton-pulse h-6 w-20 rounded-lg" />
                  </div>
                ))}
              </div>
              <div className="skeleton-pulse h-2.5 w-full rounded-full" />
              <div className="space-y-2.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <div className="skeleton-pulse h-2 w-2 rounded-full" />
                    <div className="skeleton-pulse h-3 flex-1 rounded" />
                    <div className="skeleton-pulse h-3 w-10 rounded" />
                  </div>
                ))}
              </div>
            </div>

            <div className="xl:col-span-1 surface-card p-5 flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div className="space-y-1.5">
                  <div className="skeleton-pulse h-4 w-28 rounded" />
                  <div className="skeleton-pulse h-3 w-24 rounded" />
                </div>
                <div className="skeleton-pulse h-3 w-14 rounded" />
              </div>
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <div className="skeleton-pulse h-4 w-14 rounded shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="skeleton-pulse h-3 w-full rounded" />
                      <div className="skeleton-pulse h-2.5 w-20 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Chart + stock alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="surface-card p-6 flex flex-col">
              <div className="skeleton-pulse h-5 w-44 rounded-lg mb-4" />
              <div className="skeleton-pulse flex-1 min-h-[16rem] w-full rounded-xl" />
            </div>
            <div className="surface-card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="skeleton-pulse h-5 w-32 rounded-lg" />
                <div className="skeleton-pulse h-3 w-16 rounded" />
              </div>
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton-pulse h-11 w-full rounded-xl" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
