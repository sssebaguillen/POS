export default function CatalogLoading() {
  return (
    <main className="h-screen overflow-y-auto bg-background px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto w-full max-w-7xl animate-pulse">
        {/* Business header */}
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 rounded-full bg-muted" />
          <div className="space-y-2">
            <div className="h-5 w-44 rounded bg-muted" />
            <div className="h-3.5 w-64 rounded bg-muted/70" />
          </div>
        </div>

        {/* Toolbar */}
        <div className="mt-6 flex items-center gap-2">
          <div className="h-9 w-28 rounded-full bg-muted" />
          <div className="h-9 w-24 rounded-full bg-muted/70" />
          <div className="ml-auto h-9 w-20 rounded-lg bg-muted/70" />
        </div>

        {/* Product grid */}
        {/* Mismos breakpoints que ProductGrid para que el swap skeleton→contenido no salte */}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border/70 bg-card">
              <div className="aspect-square bg-muted/60" />
              <div className="space-y-2 p-3">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-4 w-1/3 rounded bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
