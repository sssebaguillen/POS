import { SearchX } from 'lucide-react'

export default function CatalogNotFound() {
  return (
    <main className="flex h-screen items-center justify-center bg-background px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <SearchX className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Este catálogo no existe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revisa que el enlace esté bien escrito o pide al negocio su dirección actualizada.
          </p>
        </div>
      </div>
    </main>
  )
}
