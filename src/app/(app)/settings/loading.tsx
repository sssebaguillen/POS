export default function SettingsLoading() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-edge/60 bg-surface flex items-center px-5 shrink-0">
        <div className="skeleton-pulse h-6 w-40 rounded-lg" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-4 pb-6 space-y-6">
          {/* Business settings card */}
          <div className="surface-card p-6 space-y-4">
            <div className="skeleton-pulse h-5 w-36 rounded" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="skeleton-pulse h-3 w-24 rounded" />
                  <div className="skeleton-pulse h-9 w-full rounded-lg" />
                </div>
              ))}
            </div>
            <div className="skeleton-pulse h-10 w-32 rounded-lg mt-2" />
          </div>

          {/* Operators panel */}
          <div className="surface-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="skeleton-pulse h-5 w-28 rounded" />
              <div className="skeleton-pulse h-9 w-36 rounded-lg" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-edge/50 rounded-xl px-4 py-3.5 flex items-center gap-3">
                  <div className="skeleton-pulse h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton-pulse h-4 w-32 rounded" />
                    <div className="skeleton-pulse h-3 w-20 rounded" />
                  </div>
                  <div className="skeleton-pulse h-8 w-8 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
