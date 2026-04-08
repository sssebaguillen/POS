# Análisis de Arquitectura: Gestión de Estado — PulsarPos

---

## 1. Resumen Ejecutivo

**Puntuación: 6.0 / 10**

La gestión de estado de PulsarPos es **funcional pero primitiva**. La app resuelve correctamente la separación Server Components → Client Components de Next.js App Router, y el único store Zustand (cart) está bien segmentado. Sin embargo, la ausencia total de una capa de data-fetching client-side (React Query/SWR) fuerza a cada componente a reinventar su propio sistema de cache, loading, error y refetch — lo que produce inconsistencia entre módulos, code duplication significativo, y bugs latentes de stale state.

**Lo bueno:**
- Server Components hacen el fetch pesado; Client Components son presentacionales
- Zustand cart store bien aislado, con selectores granulares
- Uso correcto de `useMemo` para derived state
- Protección contra race conditions con `requestIdRef` en Expenses
- No hay over-engineering: sin Redux, sin Context innecesarios

**Lo malo:**
- 0 React Query → cada módulo reimplementa loading/error/cache manual
- Mutaciones con escrituras secuenciales no-atómicas (POS: 3 inserts sin transacción)
- Sin invalidación cruzada entre módulos (venta en POS no refresca Stock ni Dashboard)
- Lógica de date-range duplicada en 4+ archivos
- ~348 useState repartidos sin patrón unificado para forms

---

## 2. Análisis Detallado por Módulo

### 2.1 Herramientas de Estado — Distribución Global

| Herramienta | Instancias | % | Uso |
|---|---|---|---|
| `useState` | ~348 | 62.5% | Todo: UI, forms, loading, error, data local |
| `useMemo` | ~171 | 30.7% | Derived state, filtros, cálculos |
| `useEffect` | ~46 | 8.3% | Side effects, fetches client-side |
| `useRef` | ~32 | 5.7% | DOM refs, timers, race condition guards |
| `useCallback` | ~24 | 4.3% | Handlers estabilizados |
| Zustand | 1 store, 4 consumers | 0.7% | Solo cart del POS |
| Context API | 3 providers | 0.5% | Theme (x2), Sidebar |
| React Query | 0 | 0% | No instalado |
| SWR | 0 | 0% | No instalado |
| Server Actions | 0 | 0% | Usa API routes en su lugar |
| `revalidatePath` | 0 | 0% | No usado |
| `router.refresh()` | 1 lugar | — | Solo en OperatorSelectView |

### 2.2 Módulo POS (Ventas)

**Archivos clave:** `cart.store.ts`, `POSView.tsx`, `CartPanel.tsx`, `PaymentModal.tsx`

**Fortalezas:**
- Zustand store limpio con interfaz clara (addItem, removeItem, updateQuantity, etc.)
- Selectores granulares en consumidores (`useCartStore(s => s.addItem)`) — minimiza re-renders
- `adjustedItems` memoizado correctamente con `calculateProductPrice`
- Separación clara: store guarda precio base, la UI aplica price list al renderizar

**Debilidades:**
- **`PaymentModal.handleConfirm`**: 3 inserts secuenciales (`sales` → `sale_items` → `payments`) sin transacción DB. Si `sale_items` falla, queda una venta huérfana sin ítems.
- **No decrementa stock** al completar venta — el inventario queda desactualizado.
- `filteredHistory` y `historyTotal` en `CartPanel` no están memoizados (recalculan en cada render).
- `tryAddBySearch` en `POSView` no está envuelto en `useCallback` → el listener global de teclado se re-crea en cada render.
- `activePriceList` (línea 118 de POSView) no está memoizado — `.find()` en cada render.
- `customerId` en el store nunca se usa — estado muerto.
- Después de completar una venta, no hay invalidación de datos en Dashboard/Stats/Stock.

### 2.3 Módulo Inventario (Stock)

**Archivos clave:** `InventoryPanel.tsx`, `NewProductModal.tsx`, `EditProductModal.tsx`, `ImportProductsModal.tsx`

**Fortalezas:**
- Patrón callback consistente: modales retornan data al padre, padre actualiza lista local.
- Virtual scrolling con `@tanstack/react-virtual` para listas grandes de productos.
- Filtros y búsqueda memoizados correctamente.

**Debilidades:**
- **Sin refresh del servidor después de mutaciones**: usa `setProducts(prev => [...prev, newProduct])` pero nunca `router.refresh()` ni revalidación — otros tabs/usuarios ven data stale.
- **ImportProductsModal**: operaciones de import masivo son fire-and-forget para price overrides (línea 259) — fallos silenciosos posibles.
- **CategoryModal/BrandModal**: no sincronizan su estado con el padre si otro usuario modifica categorías/marcas en paralelo.
- 9+ variables de `useState` solo en `InventoryPanel` para manejar UI de modales.

### 2.4 Módulo Gastos (Expenses)

**Archivos clave:** `GastosView.tsx`, `NewExpensePanel.tsx`, `ExpensesTable.tsx`, `SuppliersPanel.tsx`

**Fortalezas:**
- Protección contra race conditions con `requestIdRef` — el mejor patrón de fetch de toda la app.
- Refetch explícito después de crear/eliminar gastos (`void loadExpensesView(period, from, to)`).
- Validación client-side antes de submit.

**Debilidades:**
- **Fetch client-side con `useEffect`** — este es el único módulo que no sigue el patrón Server Component → props. `GastosView` hace sus propios RPCs en el cliente, lo que elimina el beneficio de SSR.
- **Sin cache entre cambios de periodo**: cada cambio de fecha re-ejecuta ambos RPCs.
- **Delete silencioso**: `ExpensesTable.handleDelete` no muestra error si el RPC falla — el usuario cree que se eliminó.
- **Memory leak**: `ExpenseAttachmentUploader` crea `URL.createObjectURL()` sin `revokeObjectURL()` en cleanup.
- **Balance recalculado localmente** tras eliminar gasto, pero `fullBalance.income` viene del server y no se actualiza — posible inconsistencia numérica.

### 2.5 Módulo Dashboard

**Archivos clave:** `DashboardView.tsx`, `SalesHistoryTable.tsx`, `BalanceWidget.tsx`

**Fortalezas:**
- `BalanceWidget` es puramente presentacional — cero estado.
- Cadenas de `useMemo` bien estructuradas para KPIs.
- `SalesHistoryTable` implementa cache manual de detalles de venta (`saleDetails`).

**Debilidades:**
- **`SalesHistoryTable`**: cache manual con `saleDetails: Record<string, SaleDetail>` — sin invalidación, sin TTL, crece ilimitadamente en sesiones largas.
- **Optimistic updates sin rollback**: delete/update modifican `localRows` antes de confirmar server — si RPC falla, UI queda desincronizada y no revierte.
- **Balance estático**: `BalanceWidget` recibe props del server con `p_from: null, p_to: null` — no responde a cambios de periodo del usuario.
- **20+ useMemo chains**: `DashboardView` tiene la misma lógica de filtrado/date-range que `StatsView` — duplicación completa.

### 2.6 Módulo Estadísticas

**Archivos clave:** `StatsView.tsx` (623 líneas), `TopProductsDetailView.tsx`, detail views

**Fortalezas:**
- Sub-pages (OperatorSales, Breakdown, PaymentMethod) son limpias — sin estado local, solo `useMemo` sobre props del server.
- Navegación por URL params en detail pages — stateless y bookmarkeable.

**Debilidades:**
- **`StatsView.tsx` fetches TODO en el server** (3000 sales, 5000 products, 10000 items) y filtra client-side — no escala.
- **20+ useMemo chains con 8+ dependencias** para `evolutionData` — cualquier cambio recalcula toda la cadena.
- **Sorting parcial**: `TopProductsDetailView` ordena solo los 50 ítems de la página actual, no el dataset completo — resultados engañosos.
- **Sin paginación server-side** para el query principal de stats.

### 2.7 Módulo Settings / Operadores

**Archivos clave:** `SettingsForm.tsx`, `OperatorList.tsx`, `NewOperatorModal.tsx`, `OperatorSelectView.tsx`

**Fortalezas:**
- Flujo de cookies bien diseñado: `operator_session` (httpOnly) + `op_perms` (client-readable).
- `OperatorSelectView` usa `window.location.href` para full page transition tras switch — limpia todo el estado stale.

**Debilidades:**
- **`SettingsForm`**: usa `window.location.reload()` después de guardar settings — destruye todo el estado de la app.
- **`NewOperatorModal`**: fetch-after-create pattern — si el fetch falla después del RPC exitoso, el operador se creó pero no aparece en la lista.

### 2.8 Módulo Catálogo (Público)

**Archivos clave:** `CatalogView.tsx`, `CartPanel.tsx` (catálogo), `ProductGrid.tsx`

**Fortalezas:**
- Cart persistido en `localStorage` con key por negocio (`catalog-cart-${business.id}`).
- Completamente desacoplado del auth — usa anon client.
- Sin side effects al servidor (envío por WhatsApp).

**Debilidades:**
- **Sin sincronización entre tabs**: si el usuario abre el catálogo en dos pestañas, los carritos divergen.
- **Validación de stock solo local**: no verifica disponibilidad en el servidor antes de "enviar pedido".

### 2.9 Módulo Price Lists

**Archivos clave:** `PriceListsPanel.tsx`, modales de override

**Fortalezas:**
- Estado local bien organizado con `lists` y `overrides` como arrays independientes.
- Upsert de overrides con patrón filter-then-append correcto.
- IntersectionObserver para lazy loading de filas agrupadas.

**Debilidades:**
- 9 variables de `useState` + 7 `useMemo` derivados — componente complejo que podría beneficiarse de `useReducer`.
- Swap de default price list actualiza estado local pero no invalida otras páginas que muestran precios.

---

## 3. Problemas y Antipatrones Encontrados

### CRÍTICOS

| # | Problema | Ubicación | Impacto |
|---|---|---|---|
| C1 | **Escrituras no-atómicas en POS** | `PaymentModal.tsx` líneas 108-150 | 3 inserts secuenciales (sale → items → payment). Si falla el 2do, queda venta sin ítems. Data corruption. |
| C2 | **Zero invalidación cruzada entre módulos** | Global | Completar venta en POS no refresca: inventario (stock no decrementa en UI), dashboard (ventas del día stale), stats (totales incorrectos), gastos (balance no actualizado). Cada módulo vive en su isla. |
| C3 | **Optimistic updates sin rollback** | `SalesHistoryTable.tsx` líneas 181, 204 | Delete/update modifican UI inmediatamente pero si el RPC falla, el estado queda desincronizado sin revertir. |
| C4 | **Stats fetchea TODO sin paginación server-side** | `stats/page.tsx` líneas 12-29 | `.limit(3000)` para sales, `.limit(5000)` para products, `.limit(10000)` para items. Para negocios activos esto se queda corto o es excesivo. Todo el filtrado es client-side. |

### MAYORES

| # | Problema | Ubicación | Impacto |
|---|---|---|---|
| M1 | **Lógica de date-range duplicada 4+ veces** | `StatsView.tsx:99`, `DashboardView.tsx:88`, `top-products/page.tsx:39`, `GastosView.tsx` | Misma función de calcular rango copiada en cada módulo. Bug en uno ≠ fix en todos. |
| M2 | **Cache manual sin invalidación** | `SalesHistoryTable.tsx:55` (`saleDetails`) | Record que crece ilimitadamente, nunca se limpia, nunca se invalida. En sesión larga → memory bloat + data stale. |
| M3 | **GastosView fetches en el cliente** | `GastosView.tsx` useEffect | Único módulo que rompe el patrón SSR → props. Hace RPCs en Client Component con useEffect, perdiendo el beneficio de SSR. |
| M4 | **Errores silenciosos en deletes** | `ExpensesTable.tsx:38-49` | `handleDelete` no muestra error al usuario si RPC falla. También en `InventoryPanel` para algunos flows. |
| M5 | **`window.location.reload()` como estrategia de refresh** | `SettingsForm.tsx:116` | Destruye todo el estado de la app. Approach de "martillo" en lugar de invalidación quirúrgica. |

### MENORES

| # | Problema | Ubicación | Impacto |
|---|---|---|---|
| m1 | `filteredHistory` y `historyTotal` no memoizados | `CartPanel.tsx:149-160` | O(n) en cada render. |
| m2 | `tryAddBySearch` sin `useCallback` | `POSView.tsx:162` | Listener global de teclado se re-registra en cada render. |
| m3 | `customerId` en cart store nunca usado | `cart.store.ts:7` | Estado muerto. |
| m4 | Memory leak en `ExpenseAttachmentUploader` | `createObjectURL` sin `revokeObjectURL` | Fuga menor de memoria. |
| m5 | Quarters hardcodeados al año actual | `DateRangeFilter.tsx:22-26` | No se puede seleccionar Q de años anteriores. |
| m6 | `useToast` solo soporta 1 toast simultáneo | `useToast.ts` | Si se disparan 2, el primero se pierde. |

---

## 4. Sugerencias de Refactor Prioritarias

### R1. Transacción atómica para ventas en POS

**Impacto: CRÍTICO** · **Esfuerzo: Bajo**

Crear un RPC `create_sale_transaction` en PostgreSQL que haga los 3 inserts (sale + items + payment) y el decremento de stock en una sola transacción. Un solo `supabase.rpc()` en `PaymentModal`.

```sql
-- Pseudocódigo del RPC
CREATE FUNCTION create_sale_transaction(
  p_business_id uuid, p_items jsonb, p_payment_method text, ...
) RETURNS jsonb AS $$
BEGIN
  INSERT INTO sales ...;
  INSERT INTO sale_items ...;
  INSERT INTO payments ...;
  UPDATE products SET stock = stock - qty WHERE ...;
  RETURN jsonb_build_object('success', true, 'sale_id', new_sale_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

**Archivos afectados:** `PaymentModal.tsx`, nueva migración SQL.

---

### R2. Introducir React Query como capa de data-fetching client-side

**Impacto: ALTO** · **Esfuerzo: Medio-Alto**

Instalar `@tanstack/react-query` y migrar progresivamente los módulos que hacen fetch client-side o manejan cache manual.

**Orden de migración sugerido:**
1. `SalesHistoryTable` — reemplazar `saleDetails` manual con `useQuery` + `useMutation` con invalidación automática.
2. `GastosView` — reemplazar `useEffect` + `loadExpensesView()` con `useQuery({ queryKey: ['expenses', period, from, to] })`.
3. POS daily history en `CartPanel` — `useQuery` con `staleTime` de 30s.

**Beneficios inmediatos:**
- Cache automático con TTL configurable
- Invalidación cruzada vía `queryClient.invalidateQueries(['sales'])`
- Loading/error states built-in
- Optimistic updates con rollback automático
- Background refetch cuando el usuario vuelve al tab

**Config sugerida:**
```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000 },
  },
})
```

---

### R3. Extraer lógica de date-range a utilidad compartida

**Impacto: MEDIO** · **Esfuerzo: Bajo**

Crear `lib/date-utils.ts` con las funciones `getDateRange(period, from?, to?)` y `getPreviousRange(range)`. Reemplazar las 4+ copias en `StatsView`, `DashboardView`, `top-products/page.tsx`, `GastosView`.

```ts
// lib/date-utils.ts
export function getDateRange(period: DateRangePeriod, from?: string, to?: string): DateRange { ... }
export function getPreviousRange(range: DateRange): DateRange | null { ... }
```

**Archivos afectados:** `StatsView.tsx`, `DashboardView.tsx`, `GastosView.tsx`, `stats/top-products/page.tsx`, `DateRangeFilter.tsx`.

---

### R4. Migrar stats pesadas a server-side con paginación

**Impacto: ALTO** · **Esfuerzo: Medio**

El page.tsx de `/stats` fetches hasta 18,000 rows y las pasa al client para filtrar. Esto no escala. Migrar a RPCs que acepten `p_from`/`p_to` y devuelvan datos ya agregados (como ya hacen los detail pages: `get_top_products_detail`, `get_sales_by_operator_detail`, etc.).

**Plan:**
1. Crear RPCs: `get_stats_kpis(p_business_id, p_from, p_to)`, `get_stats_evolution(...)`, `get_stats_breakdown(...)`.
2. `StatsView` pasa de recibir arrays raw a recibir datos pre-agregados.
3. El cambio de periodo navega con URL params (como ya hacen los detail pages) → server re-fetches.

**Archivos afectados:** `stats/page.tsx`, `StatsView.tsx`, nuevas migraciones SQL.

---

### R5. Invalidación cruzada post-venta

**Impacto: ALTO** · **Esfuerzo: Bajo** (con React Query) / **Medio** (sin él)

Después de completar una venta en POS, invalidar los datos de:
- Stock (decrementar cantidades)
- Dashboard (ventas del día)
- Stats (si están cacheadas)
- Balance (ingresos)

**Con React Query (si se implementa R2):**
```ts
onSaleCompleted: () => {
  queryClient.invalidateQueries({ queryKey: ['sales'] })
  queryClient.invalidateQueries({ queryKey: ['products'] })
  queryClient.invalidateQueries({ queryKey: ['balance'] })
}
```

**Sin React Query (approach actual):**
Usar `router.refresh()` en el layout de `(app)` para forzar re-fetch del Server Component. Es menos granular pero funciona.

---

### R6. Rollback en optimistic updates

**Impacto: MEDIO** · **Esfuerzo: Bajo**

En `SalesHistoryTable`, guardar el estado previo antes del optimistic update y revertir si el RPC falla.

```ts
async function handleDeleteSale(saleId: string) {
  const prevHistory = history
  const prevDetails = saleDetails
  // Optimistic
  setHistory(prev => prev.filter(s => s.id !== saleId))
  
  const { error } = await supabase.rpc('delete_sale', { ... })
  if (error) {
    // Rollback
    setHistory(prevHistory)
    setSaleDetails(prevDetails)
    showToast({ message: error.message })
  }
}
```

Aplicar el mismo patrón en `handleUpdateSale`. Con React Query (R2), esto viene built-in con `useMutation({ onMutate, onError })`.

---

## Resumen de Prioridades

| # | Refactor | Impacto | Esfuerzo | Prioridad | Estado |
|---|---|---|---|---|---|
| R1 | Transacción atómica POS | Crítico | Bajo | **P0** | HECHO |
| R3 | Date-range utils | Medio | Bajo | **P1** | HECHO |
| R5 | Invalidación cruzada | Alto | Bajo-Medio | **P1** | HECHO |
| R6 | Feedback de errores en mutaciones | Medio | Bajo | **P2** | HECHO |
| R2 | React Query | Alto | Medio-Alto | **P1** | PENDIENTE |
| R4 | Stats server-side | Alto | Medio | **P2** | PENDIENTE |

---

## Detalle de lo implementado

### R1 — Transacción atómica POS (HECHO)
- Migración SQL: `supabase/migrations/20260408_create_sale_transaction.sql`
- RPC `create_sale_transaction` reemplaza los 3 inserts secuenciales
- `PaymentModal.tsx` actualizado para usar un solo `supabase.rpc()`
- Stock se decrementa vía trigger existente `on_sale_item_inserted`

### R3 — Date-range utils (HECHO)
- Creado `src/lib/date-utils.ts` como single source of truth
- Exporta: `DateRangePeriod`, `getDateRange`, `resolveDateRange`, `buildDateParams`, `periodNeedsCustomDates`, `getPreviousPeriodRange`, `startOfDay`, `endOfDay`, `startOfWeek`, `getDayLabel`, `isCompletedSale`
- Eliminadas 7 instancias de código duplicado en 10 archivos
- `DateRangeFilter.tsx` re-exporta el tipo desde `date-utils`
- `dashboard/utils.ts` convertido a re-export shim

### R5 — Invalidación cruzada post-venta (HECHO)
- `CartPanel.tsx`: agregado `router.refresh()` después de completar venta
- Re-ejecuta Server Components para refrescar stock y datos del servidor

### R6 — Feedback de errores en mutaciones (HECHO)
- `SalesHistoryTable.tsx`: agregado `mutationError` state + UI banner
- `handleDeleteSale` y `handleUpdateSale` ahora muestran errores reales al usuario
- Nota: las mutaciones NO eran optimistic (esperan respuesta del server), así que rollback no aplica — el problema real era la falta de feedback de error
