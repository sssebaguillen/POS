'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { WifiSlash, WifiHigh } from '@phosphor-icons/react/dist/ssr'

/**
 * F0 del plan de POS offline: detección de pérdida de conexión (`navigator.onLine`
 * + eventos `online`/`offline`) con un banner global. NO hace la venta resiliente
 * (eso es F1/F2) — solo avisa al operador apenas se cae la red, para que no
 * descubra el corte al apretar "Cobrar". Agnóstico del shell: sirve igual para la
 * futura app PWA o Tauri.
 */

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

// SSR (y primer render de hidratación): asumimos online → no se pinta nada, sin
// mismatch. Tras hidratar, useSyncExternalStore lee navigator.onLine real.
const getOnlineSnapshot = () => navigator.onLine
const getOnlineServerSnapshot = () => true

export default function OfflineBanner() {
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot)
  const [justReconnected, setJustReconnected] = useState(false)

  // Confirmación breve al volver la conexión. El setState vive en el handler del
  // evento (no es síncrono dentro del efecto), y se autodescarta a los segundos.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function handleOnline() {
      setJustReconnected(true)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setJustReconnected(false), 3500)
    }
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (online && !justReconnected) return null

  if (!online) {
    return (
      <div
        role="status"
        aria-live="assertive"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-xl border border-warning/30 bg-warning px-4 py-2.5 text-warning-foreground shadow-lg animate-fade-in max-w-[calc(100vw-1.5rem)]"
      >
        <WifiSlash weight="bold" className="w-5 h-5 shrink-0" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">Sin conexión a internet</p>
          <p className="text-xs opacity-90">No podrás cobrar hasta que vuelva la conexión.</p>
        </div>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-xl border border-success/30 bg-success px-4 py-2.5 text-success-foreground shadow-lg animate-fade-in"
    >
      <WifiHigh weight="bold" className="w-5 h-5 shrink-0" />
      <p className="text-sm font-semibold">Conexión restablecida</p>
    </div>
  )
}
