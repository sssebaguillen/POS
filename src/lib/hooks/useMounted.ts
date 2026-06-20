'use client'

import { useSyncExternalStore } from 'react'

// La "montado-idad" no cambia durante la vida del componente → suscripción no-op.
const subscribeNoop = () => () => {}

/**
 * `true` en el cliente, `false` durante SSR y el primer render de hidratación — sin `setState`
 * en un efecto ni mismatch de hidratación. Reemplaza el patrón previo
 * `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])`.
 *
 * Úsalo para diferir hasta después de la hidratación cualquier UI que dependa de estado
 * client-only (tema/localStorage/matchMedia), p. ej. el ícono de los theme toggles (regla 25).
 * `useSyncExternalStore` da el snapshot del server (`false`) en SSR y el del cliente (`true`)
 * tras montar, igual que `useHasInsightsPermission` en `components/insights/useInsights.ts`.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false)
}
