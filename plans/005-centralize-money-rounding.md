# Plan 005: Centralizar el redondeo de dinero (`round2`) y redondear el subtotal del POS

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a549038..HEAD -- src/lib/format.ts src/lib/promotions.ts src/lib/store/cart.store.ts src/components/pos/CartPanel.tsx src/components/catalog/CartPanel.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: MED
- **Depends on**: plans/001-test-baseline-money-path.md (la red de tests DEBE existir antes de tocar esta aritmética)
- **Category**: tech-debt
- **Planned at**: commit `a549038`, 2026-06-12

## Why this matters

El patrón `Math.round(v * 100) / 100` (redondeo a 2 decimales de montos) está re-implementado en al menos 4 lugares del camino del dinero. Hoy todas las copias coinciden, pero son copias: un cambio futuro (p. ej. moneda sin decimales, o cambiar a redondeo bancario) exigiría encontrarlas todas, y una divergencia produce descuadres de centavos entre lo que muestra el POS y lo que persiste SQL. Además, el subtotal ajustado del POS (`adjustedSubtotal`) se suma sin redondear antes de calcular el descuento porcentual — defecto cosmético (SQL redondea al persistir) que se corrige gratis en la misma pasada.

## Current state

Sitios con el patrón duplicado:

1. `src/lib/promotions.ts:53` — `const round2 = (v: number) => Math.round(v * 100) / 100` (privado del módulo; usado en `applyUnitPromo`, `computeQuantityDiscount`, `resolvePromoLine`).
2. `src/lib/store/cart.store.ts:18` — dentro de `resolveDiscountAmount`: `return Math.round(clamped * 100) / 100`.
3. `src/components/pos/CartPanel.tsx:127` (aprox; dentro del `useMemo` de `adjustedItems`) — `total: Math.round((item.quantity * line.unitPrice - (promo?.kind === 'quantity' ? line.promoDiscount : 0)) * 100) / 100`.
4. `src/components/catalog/CartPanel.tsx:23-25` — `export function lineTotal(item) { return Math.round((item.product.salePrice * item.quantity - lineDiscount(item)) * 100) / 100 }`.
5. `src/lib/price-lists.ts:10` — `applyRounding` termina con `return Math.round(rounded * 100) / 100` (acá es el paso final del redondeo por step de lista — mismo patrón, mismo significado).

Defecto a corregir en la misma pasada — `src/components/pos/CartPanel.tsx:165-167`:

```ts
const adjustedSubtotal = adjustedItems.reduce((sum, i) => sum + i.total, 0)
const discountAmount = resolveDiscountAmount(adjustedSubtotal, discountMode, discountValue)
const adjustedTotal = Math.max(0, adjustedSubtotal - discountAmount)
```

`adjustedSubtotal` acumula flotantes sin redondear (0.1+0.2 = 0.30000000000000004) antes del cálculo de descuento y del display.

Convenciones del repo que aplican:
- `src/lib/format.ts` ya es el módulo de utilidades de dinero (`formatMoney`, `formatNumber`) — es el lugar natural para `round2`.
- `.toFixed(2)` solo se usa para FORMATO de strings (ej. export CSV en `SalesHistoryPanel.tsx:387`) — eso está bien y NO se toca.
- `src/lib/promotions.ts` es espejo de SQL (regla 11/36): su comportamiento numérico NO puede cambiar ni un centavo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests (red del plan 001) | `npm test` | all pass, ANTES y DESPUÉS de cada step |
| Build | `npm run build` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Buscar el patrón viejo | `grep -rn "Math.round(.*\* 100) / 100" src/` | ver Done criteria |

## Scope

**In scope**:
- `src/lib/format.ts` (agregar y exportar `round2`)
- `src/lib/promotions.ts` (reemplazar el `round2` local por el import)
- `src/lib/store/cart.store.ts` (usar `round2` en `resolveDiscountAmount`)
- `src/components/pos/CartPanel.tsx` (usar `round2` en `adjustedItems.total` y redondear `adjustedSubtotal`)
- `src/components/catalog/CartPanel.tsx` (usar `round2` en `lineTotal`)
- `src/lib/__tests__/` (un caso nuevo para el redondeo del subtotal)

**Out of scope**:
- `src/lib/price-lists.ts` — `applyRounding` es espejo del redondeo SQL de listas (`compute_effective_price`); cambiarlo dispara la regla "cambiar ambos juntos". Dejar su línea final intacta (puede importar `round2` SOLO si el resultado es bit-a-bit idéntico, pero no es necesario).
- Cualquier `.toFixed(...)` — son formato de display/CSV, no cálculo.
- El SQL. Este plan no cambia ningún resultado numérico, solo de dónde sale la función.
- NO extraer un helper `computeLineTotal(item, promo)` — se evaluó y se descartó como abstracción prematura: las dos fórmulas de línea (POS y catálogo) operan sobre tipos distintos.

## Git workflow

- Commit sugerido: `refactor(money): round2 centralizado en lib/format + subtotal POS redondeado`.
- Do NOT push unless instructed.

## Steps

### Step 0: Confirmar la red

**Verify**: `npm test` → all pass (si no existe el script `test`, el plan 001 no aterrizó → STOP).

### Step 1: Exportar `round2` desde `lib/format.ts`

En `src/lib/format.ts` agregar:

```ts
// Redondeo a 2 decimales para CÁLCULO de montos (no formato). Único punto de
// verdad del patrón Math.round(v*100)/100 en el camino del dinero.
export const round2 = (v: number): number => Math.round(v * 100) / 100
```

**Verify**: `npm run build` → exit 0.

### Step 2: Migrar `promotions.ts`

Borrar la línea 53 (`const round2 = ...`) e importar: `import { round2 } from '@/lib/format'`. Ningún otro cambio en el archivo.

**Verify**: `npm test` → all pass (los tests del plan 001 sobre promos siguen verdes — comportamiento idéntico).

### Step 3: Migrar `cart.store.ts`

En `resolveDiscountAmount` (línea 18), reemplazar `Math.round(clamped * 100) / 100` por `round2(clamped)` con su import.

**Verify**: `npm test` → all pass.

### Step 4: Migrar ambos CartPanel y redondear el subtotal

- `src/components/pos/CartPanel.tsx`: en el `useMemo` de `adjustedItems`, reemplazar el `Math.round((...) * 100) / 100` del campo `total` por `round2(...)`. En la línea del subtotal, envolver: `const adjustedSubtotal = round2(adjustedItems.reduce((sum, i) => sum + i.total, 0))`.
- `src/components/catalog/CartPanel.tsx`: en `lineTotal`, reemplazar por `round2(item.product.salePrice * item.quantity - lineDiscount(item))`.

**Verify**: `npm run build` → exit 0; `npm run lint` → exit 0.

### Step 5: Test del subtotal redondeado

Agregar a `src/lib/__tests__/cart-discount.test.ts` un caso que documente el porqué: `round2(0.1 + 0.2)` → `0.3`, y `resolveDiscountAmount(round2(0.1 + 0.2), 'percent', 10)` → `0.03`.

**Verify**: `npm test` → all pass, incluido el caso nuevo.

## Test plan

- Los tests del plan 001 son la verificación de no-regresión (mismos números antes y después).
- Caso nuevo del Step 5.
- Smoke manual recomendado al reviewer: en `/pos` (negocio dev 'tienda de seba' ÚNICAMENTE), armar un carrito con 2 productos + una promo 2x1 + descuento 10%, cobrar, y verificar que el total del ticket coincide con el de `/dashboard`.

## Done criteria

- [ ] `grep -rn "Math.round(.*\* 100) / 100" src/` devuelve SOLO `src/lib/format.ts` y `src/lib/price-lists.ts` (out of scope deliberado)
- [ ] `npm test` exit 0 — ningún valor de test del plan 001 cambió
- [ ] `npm run build` y `npm run lint` exit 0
- [ ] `git status` sin archivos fuera del scope
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- El plan 001 no está aterrizado (`npm test` no existe o falla en el Step 0).
- Algún test cambia de valor tras un step — significa que el reemplazo NO fue equivalente; revertir el step y reportar.
- Los extractos de "Current state" no coinciden (los CartPanel cambian seguido).
- La tentación de tocar `applyRounding` en `price-lists.ts` — es espejo SQL, fuera de scope.

## Maintenance notes

- A futuro, cualquier cálculo nuevo de montos debe importar `round2` de `lib/format.ts` — el reviewer debe rechazar nuevos `Math.round(v*100)/100` inline en `src/components/`.
- Si algún día cambia la estrategia de redondeo (p. ej. moneda sin centavos), el cambio es en `round2` + su espejo SQL (las funciones de promos/ventas redondean en Postgres con `round(numeric, 2)`) — cambiar ambos juntos, regla 11.
