export default function CatalogLoading() {
  return (
    <div className="h-screen overflow-y-auto bg-background">
      {/* Navbar skeleton — espejo de CatalogNavbar (sticky, mismo alto) */}
      <div className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-6 animate-pulse">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-muted" />
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="hidden h-8 w-36 rounded-lg bg-muted/70 sm:block" />
          <div className="order-last h-9 w-full rounded-lg bg-muted/70 md:order-none md:mx-auto md:w-auto md:max-w-sm md:flex-1" />
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <div className="h-9 w-9 rounded-xl bg-muted/70" />
            <div className="h-9 w-9 rounded-xl bg-muted/70" />
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8">
        <div className="animate-pulse">
          {/* Fila única: chips de categorías + orden + filtros */}
          <div className="flex items-center gap-2 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-7 w-20 shrink-0 rounded-full bg-muted/70" />
            ))}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="h-9 w-36 rounded-lg bg-muted/70" />
              <div className="h-9 w-28 rounded-lg bg-muted/70" />
            </div>
          </div>

          {/* Product grid */}
          {/* Mismos breakpoints que ProductGrid para que el swap skeleton→contenido no salte */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 md:mt-6">
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
    </div>
  )
}
