export default function DashboardLoading() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 gap-4 shrink-0">
        <div className="skeleton-pulse h-6 w-36 rounded-lg" />
        <div className="ml-auto skeleton-pulse h-4 w-32 rounded-lg" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-5">
          {/* Period tabs */}
          <div className="skeleton-pulse h-9 w-[420px] max-w-full rounded-full" />

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="surface-card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="skeleton-pulse h-10 w-10 rounded-xl" />
                  <div className="skeleton-pulse h-5 w-14 rounded-full" />
                </div>
                <div className="space-y-2">
                  <div className="skeleton-pulse h-3 w-24 rounded" />
                  <div className="skeleton-pulse h-8 w-28 rounded-lg" />
                  <div className="skeleton-pulse h-3 w-20 rounded" />
                </div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div className="surface-card p-6">
            <div className="skeleton-pulse h-6 w-52 rounded-lg mb-4" />
            <div className="skeleton-pulse h-56 w-full rounded-xl" />
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="surface-card p-6">
              <div className="skeleton-pulse h-6 w-44 rounded-lg mb-4" />
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="skeleton-pulse h-4 w-5 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton-pulse h-4 w-full rounded" />
                      <div className="skeleton-pulse h-3 w-24 rounded" />
                    </div>
                    <div className="skeleton-pulse h-4 w-12 rounded" />
                  </div>
                ))}
              </div>
            </div>
            <div className="surface-card p-6">
              <div className="skeleton-pulse h-6 w-36 rounded-lg mb-4" />
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton-pulse h-12 w-full rounded-xl" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
