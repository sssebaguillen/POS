'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CatalogError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[catalogo] render error', error)
  }, [error])

  return (
    <main className="flex h-screen items-center justify-center bg-background px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/40">
          <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">No pudimos cargar el catálogo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Es un problema temporal de nuestro lado. Intenta de nuevo en unos segundos.
          </p>
        </div>
        <Button type="button" className="h-10 px-6" onClick={reset}>
          Reintentar
        </Button>
      </div>
    </main>
  )
}
