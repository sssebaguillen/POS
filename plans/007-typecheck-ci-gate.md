# Plan 007: Typecheck en verde + gates de lint y typecheck en CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- package.json .github/workflows/test.yml src/components/pos/__tests__ src/lib/__tests__/operator.test.ts src/lib/__tests__/price-lists.test.ts src/lib/api/__tests__/sales.test.ts src/lib/printer/__tests__/escpos.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx + bug
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

`npx tsc --noEmit` **falla hoy con 8 errores**, todos en archivos de test. Nadie lo nota porque: (a) vitest no typecheckea (esbuild solo borra los tipos), (b) `next build` no surfacea errores de los archivos de test, y (c) el CI solo corre `npm test`. Resultado: los tests ya acumularon deriva de tipos real — un import que apunta a un módulo del que `CartItem` se mudó (2026-06-09), fixtures sin los campos de promo agregados al modelo (2026-06-10), y un mock de `PostgrestError` incompleto. Este plan arregla los 8 errores, agrega el script `typecheck` que el repo no tiene, y suma lint + typecheck al workflow de CI para que la deriva no vuelva a acumularse.

## Current state

Salida actual de `npx tsc --noEmit` (los 8 errores, verificados el 2026-06-12):

```
src/components/pos/__tests__/CartPanel.test.tsx(10,15): error TS2305: Module '"@/lib/types"' has no exported member 'CartItem'.
src/components/pos/__tests__/PaymentModal.test.tsx(27,3): error TS2739: ... missing the following properties from type 'SaleItemInput': promotion_id, promo_discount
src/components/pos/__tests__/PaymentModal.test.tsx(40,3): error TS2741: Property 'promo_label' is missing ... but required in type 'ReceiptItemInput'.
src/lib/__tests__/operator.test.ts(129,13): error TS2352: Conversion of type 'Permissions' to type 'Record<string, unknown>' may be a mistake ...
src/lib/__tests__/price-lists.test.ts(9,15): error TS2305: Module '"@/lib/types"' has no exported member 'CartItem'.
src/lib/api/__tests__/sales.test.ts(24,21): error TS2741: Property 'toJSON' is missing ... but required in type 'PostgrestError'.
src/lib/api/__tests__/sales.test.ts(74,11): error TS2739: ... missing the following properties from type 'CreateSaleItem': promotion_id, promo_discount
src/lib/printer/__tests__/escpos.test.ts(11,7): error TS2739: ... missing the following properties from type 'ReceiptItemInput': promo_label, promotion_id, promo_discount
```

Hechos que explican cada error:

- `CartItem` vive en `src/lib/types/cart.ts` desde 2026-06-09 (se movió desde `src/lib/types/index.ts`). Los imports rotos son mixtos — `CartPanel.test.tsx:10` es `import type { CartItem, Product } from '@/lib/types'` y `price-lists.test.ts:9` es `import type { CartItem, PriceList, PriceListOverride, Product } from '@/lib/types'`. Solo `CartItem` se mudó; el resto sigue en `@/lib/types`.
- `SaleItemInput` (`src/lib/printer/types.ts:5-16`) y `CreateSaleItem` (`src/lib/api/sales.ts:37-48`) hoy exigen `promotion_id: string | null` y `promo_discount: number`. `ReceiptItemInput` (`src/lib/printer/types.ts:18-23`) además exige `promo_label: string | null`.
- `operator.test.ts:129`: `(result as Record<string, unknown>).sales` — `Permissions` no tiene index signature, TS exige pasar por `unknown`.
- `sales.test.ts:24`: el mock inline de `PostgrestError` (`{ message, details, hint, code, name }`) no tiene el método `toJSON` que el tipo exige.

`package.json` (scripts actuales — no existe `typecheck`):

```json
"scripts": {
  "dev": "next dev --webpack",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  ...
}
```

`.github/workflows/test.yml` completo (hoy solo corre tests):

```yaml
name: Tests

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    name: Unit tests
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test
```

Convención del repo: `tsconfig.json` ya excluye `supabase/functions` (código Deno) — `tsc --noEmit` no lo toca. ESLint está en verde desde el plan 006 (los warnings de `set-state-in-effect` están en `warn` deliberadamente y NO deben volverse errores).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, sin output |
| Tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 (warnings permitidos) |

## Scope

**In scope** (únicos archivos a modificar):
- `src/components/pos/__tests__/CartPanel.test.tsx`
- `src/components/pos/__tests__/PaymentModal.test.tsx`
- `src/lib/__tests__/operator.test.ts`
- `src/lib/__tests__/price-lists.test.ts`
- `src/lib/api/__tests__/sales.test.ts`
- `src/lib/printer/__tests__/escpos.test.ts`
- `package.json` (solo agregar el script `typecheck`)
- `.github/workflows/test.yml`

**Out of scope** (NO tocar):
- Cualquier archivo de `src/` que no sea de tests — los tipos de producción están bien; la deriva es solo de los tests.
- `eslint.config.mjs` — no agregar `--max-warnings 0` ni cambiar reglas; los warnings actuales son deuda conocida y deliberada.
- NO agregar `npm run build` al CI — `next build` necesita los env vars de Supabase (secrets que el workflow no tiene); queda explícitamente fuera.
- `vitest.config.ts`.

## Git workflow

- Commit sugerido: `fix(test): typecheck en verde (deriva post-promos/CartItem) + gates lint/typecheck en CI`.
- Do NOT push unless instructed.

## Steps

### Step 0: Confirmar la línea de base

Correr `npx tsc --noEmit` y comparar contra la lista de 8 errores de "Current state".

**Verify**: la salida contiene exactamente esos 8 errores (mismos archivos y códigos TS). Si aparecen errores en OTROS archivos → STOP.

### Step 1: Arreglar los dos imports de `CartItem`

- `src/components/pos/__tests__/CartPanel.test.tsx:10` — partir el import:
  ```ts
  import type { Product } from '@/lib/types'
  import type { CartItem } from '@/lib/types/cart'
  ```
- `src/lib/__tests__/price-lists.test.ts:9` — ídem:
  ```ts
  import type { PriceList, PriceListOverride, Product } from '@/lib/types'
  import type { CartItem } from '@/lib/types/cart'
  ```

**Verify**: `npx tsc --noEmit 2>&1 | grep -c "TS2305"` → `0`.

### Step 2: Completar los fixtures con los campos de promo

Agregar `promotion_id: null,` y `promo_discount: 0,` a cada item literal que falla:

- `src/components/pos/__tests__/PaymentModal.test.tsx` — el objeto dentro de `const saleItems: SaleItemInput[]` (línea ~27). El array `receiptItems` (línea ~40) hace spread de `saleItems[0]`, así que hereda esos dos campos; solo hay que sumarle `promo_label: null` al literal del spread.
- `src/lib/api/__tests__/sales.test.ts` — el item literal de la línea ~74.
- `src/lib/printer/__tests__/escpos.test.ts` — el item dentro de `makeReceipt` (línea ~11): agregar `promotion_id: null`, `promo_discount: 0` y `promo_label: null`.

Estos campos son inertes en runtime (los tests no los assertan), pero correr `npm test` igual para confirmar.

**Verify**: `npx tsc --noEmit 2>&1 | grep -c "promo"` → `0`; `npm test` → all pass.

### Step 3: Los dos errores restantes

- `src/lib/__tests__/operator.test.ts:129`: cambiar `(result as Record<string, unknown>).sales` por `(result as unknown as Record<string, unknown>).sales`.
- `src/lib/api/__tests__/sales.test.ts:24`: al objeto error del mock agregarle `toJSON: () => ({})`. Queda: `{ data: null, error: { message: 'duplicate key value', details: '', hint: '', code: '23505', name: 'e', toJSON: () => ({}) } }`.

**Verify**: `npx tsc --noEmit` → exit 0, sin output. `npm test` → all pass.

### Step 4: Script `typecheck`

En `package.json`, agregar a `"scripts"`: `"typecheck": "tsc --noEmit",` (después de `"lint"`).

**Verify**: `npm run typecheck` → exit 0.

### Step 5: Gates en CI

En `.github/workflows/test.yml`, entre el step "Install dependencies" y "Run tests", insertar:

```yaml
      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck
```

**Verify**: `grep -c "npm run typecheck" .github/workflows/test.yml` → `1`; el YAML parsea (`npx yaml-lint` no está instalado — basta revisar indentación de 6 espacios igual que los steps existentes).

## Test plan

No hay tests nuevos: este plan REPARA tests existentes a nivel de tipos sin cambiar su comportamiento. La verificación de no-regresión es que `npm test` pase con el mismo set de tests verdes antes y después de cada step.

## Done criteria

- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm test` exit 0 (mismos tests verdes que antes del plan)
- [ ] `npm run lint` exit 0
- [ ] `package.json` contiene el script `typecheck`
- [ ] `.github/workflows/test.yml` contiene los steps Lint y Typecheck antes de Run tests
- [ ] `git status` sin archivos fuera del scope
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- El Step 0 muestra errores de tsc en archivos NO listados (el codebase derivó — reportar la lista nueva en vez de arreglar a ciegas).
- Algún test cambia de verde a rojo tras un step (los cambios deben ser type-only; si un test rompe, el fixture afecta una asserción — revertir el step y reportar).
- La tentación de arreglar warnings de ESLint o tipos de `src/` de producción — fuera de scope.

## Maintenance notes

- A partir de esto, cualquier PR con error de tipos (incluso en tests) falla en CI — ese es el punto. Si en el futuro un cambio de modelo (p. ej. un campo nuevo en `SaleItemInput`) rompe fixtures de tests, lo correcto es actualizar los fixtures en el mismo PR, no excluir tests del typecheck.
- `next build` en CI sigue pendiente deliberadamente (necesita secrets de Supabase en GitHub Actions). Si algún día se agrega, considerar dummies de `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- El plan 005 (round2) y cualquier plan que toque `src/lib` se beneficia de este gate — conviene aterrizar este primero.
