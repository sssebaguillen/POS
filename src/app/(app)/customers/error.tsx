'use client'

import { useEffect } from 'react'
import { Warning } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'

export default function CustomersError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[customers] render error', error)
  }, [error])

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
          <Warning className="h-6 w-6 text-warning" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">No pudimos cargar los clientes</h1>
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
