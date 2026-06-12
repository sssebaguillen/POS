# Plan 001 (v2): Integrar la rama cloud de tests, actualizarla a la era promos y cubrir `promotions.ts`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git fetch origin 'refs/heads/claude/test-coverage-analysis-3BbFX:refs/remotes/origin/claude/test-coverage-analysis-3BbFX' && git log --oneline -1 origin/claude/test-coverage-analysis-3BbFX`
> → debe ser `64c8883 ci: add GitHub Actions workflow to run unit tests on every PR`.
> Si la punta cambió, o si `git diff --stat f749d6e..HEAD -- src/lib/ src/components/pos/` muestra
> cambios nuevos, comparar los extractos de "Current state" antes de seguir.

## Status

- **Priority**: P1
- **Effort**: M–L
- **Risk**: LOW-MED (no se toca código fuente; el riesgo es fijar tests con semántica equivocada)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `f749d6e`, 2026-06-12 (v2 — reemplaza el plan original del commit `a549038`)
- **Supersedes**: la versión v1 de este plan (escribir harness de cero) — quedó obsoleta al descubrir la rama cloud.

## Why this matters

Existe una rama remota **`origin/claude/test-coverage-analysis-3BbFX`** (sesión de Claude Code cloud, 2026-06-05) con la infraestructura de tests que este plan originalmente iba a crear de cero, y más: Vitest configurado, **325 tests** sobre `price-lists`, `cart.store`, `format`, `payments`, `operator`, `mappers`, `validation`, `inventory-products`, printer ESC/POS, `lib/api/sales`, las API routes (`/api/catalog/orders`, `/api/operator/switch`, `/api/operator/logout`), tests de componentes del checkout (PaymentModal, CartPanel, con jsdom por archivo), documentación (`docs/tests/11-tests-unitarios.md`) y un workflow de GitHub Actions que corre `npm test` en cada PR.

El problema: la rama se cortó de master el **2026-06-04** y master avanzó ~30 commits, incluyendo el **módulo completo de promociones** (2026-06-10), el rediseño de permisos a 8 capacidades (2026-06-09) y cambios en casi todos los módulos testeados. Hay que: (1) mergearla, (2) actualizar los tests que quedaron afirmando semántica vieja — **el código fuente actual es la verdad; los tests se adaptan, nunca al revés**, y (3) agregar la pieza que la rama no pudo tener: tests de `src/lib/promotions.ts`, el espejo TS de los helpers SQL de promos (regla 11/36 de CLAUDE.md). Esto desbloquea el plan 005.

## Current state

- La rama remota: 5 commits sobre el merge-base `7e78cc6` (2026-06-04). **Solo AGREGA archivos** — no modifica ningún archivo de `src/` existente. Únicas zonas de conflicto con master: `package.json` (la rama agrega scripts `test`/`test:watch` y devDeps `vitest@^4.1.8`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/{react,jest-dom,user-event}`; master desde entonces ELIMINÓ `xlsx`, `hono`, `@hono/node-server` — conservar ambos efectos) y `package-lock.json` (regenerar con `npm install`, no resolver a mano).
- `vitest.config.ts` de la rama: pinnea `TZ=America/Argentina/Buenos_Aires`, alias `@` → `./src`, environment `node`, coverage v8 sobre `src/lib/**` y `src/app/api/**`. **Conservarlo tal cual** (es superset de lo que pedía el plan v1).
- Tests de componentes: usan `// @vitest-environment jsdom` por archivo + `src/test/dom.ts` compartido.
- Módulos testeados por la rama que **cambiaron en master desde el merge-base** (los tests de estos pueden fallar y necesitan actualización): `src/lib/price-lists.ts`, `src/lib/store/cart.store.ts`, `src/lib/operator.ts` (rediseño de permisos 06-09 — pero `normalizePermissions` es bi-shape: acepta el shape viejo de 11 flags y el nuevo de 8, así que parte de los tests viejos puede seguir pasando legítimamente), `src/lib/printer/{escpos,receipt,types}.ts`, `src/lib/api/sales.ts`, `src/lib/types/{cart,index}.ts`, y los componentes `PaymentModal.tsx`/`CartPanel.tsx` (integración de promos: `resolvePromoLine` en el flujo, líneas netas, `promo_discount`).
- `src/lib/promotions.ts` (184 líneas, master actual) — SIN tests. Funciones puras: `isPromotionLive`, `findApplicablePromo`, `applyUnitPromo`, `computeQuantityDiscount`, `resolvePromoLine`, `promoBadgeLabel`, `promoCountdownLabel`; todas aceptan `at?: Date` donde importa la fecha. Extracto clave (`promotions.ts:110-115`, modelo N/K/P):

```ts
export function computeQuantityDiscount(promo: QuantityPromoFields, unitPrice: number, quantity: number): number {
  const { group_size: n, affected_units: k, pay_percent: p } = promo
  if (promo.kind !== 'quantity' || n === null || n < 2 || k === null || k < 1) return 0
  if (quantity < n || unitPrice <= 0) return 0
  return Math.max(round2(Math.floor(quantity / n) * k * unitPrice * (1 - (p ?? 0) / 100)), 0)
}
```

- Semántica de promos que los tests DEBEN afirmar (de los comentarios del módulo y CLAUDE.md regla 36): una línea matchea UNA promo (producto > categoría > marca; a igual especificidad, la más reciente por `created_at`); `applyUnitPromo` con `offer_price` nunca SUBE el precio (`Math.min`); promo unitaria baja el unitario, promo de cantidad descuenta a nivel línea dejando el unitario intacto; `quantity <= 0` o `unitPrice <= 0` → sin promo.
- Convención del repo: TS strict; lint debe quedar en 0 errores (la regla `react-hooks/set-state-in-effect` ya está en warn).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Traer la rama | `git fetch origin claude/test-coverage-analysis-3BbFX` | exit 0 |
| Merge | `git merge origin/claude/test-coverage-analysis-3BbFX` | conflicto SOLO en package.json / package-lock.json |
| Install | `npm install` | exit 0 (regenera el lockfile tras resolver package.json) |
| Tests | `npm test` | all pass (al final; en el medio, fallos esperados) |
| Un solo archivo | `npx vitest run <path>` | — |
| Build | `npm run build` | exit 0 (requiere `.env.local` copiado del repo principal; NO commitearlo) |
| Lint | `npm run lint` | exit 0, 0 errores |

## Scope

**In scope** (the only files you should modify/create):
- El merge de la rama (todo lo que ella agrega: `src/**/__tests__/**`, `src/test/dom.ts`, `vitest.config.ts`, `.github/workflows/test.yml`, `docs/tests/11-tests-unitarios.md`, `docs/tests/README.md`)
- `package.json` + `package-lock.json` (resolución del conflicto de merge)
- Archivos de test existentes de la rama que requieran actualización a la semántica actual
- `src/lib/__tests__/promotions.test.ts` (create)

**Out of scope** (do NOT touch):
- **CUALQUIER archivo de `src/` que no sea de tests** (`__tests__/`, `src/test/`). Si un test revela un bug real en el código actual de master → STOP y reportar; jamás "arreglar" el código fuente.
- `eslint.config.mjs`, `CLAUDE.md`, migraciones SQL.
- No actualizar versiones de dependencias más allá de lo que la rama ya trae.

## Git workflow

- El merge genera su propio commit; los arreglos de tests en commits separados por módulo, estilo conventional commits en español, ej.: `test(promos): suite de promotions.ts — espejo TS de los helpers SQL`.
- Do NOT push.

## Steps

### Step 1: Merge de la rama

`git fetch origin claude/test-coverage-analysis-3BbFX` y `git merge origin/claude/test-coverage-analysis-3BbFX`. Resolver `package.json` conservando AMBOS efectos: los scripts/devDeps nuevos de la rama Y las eliminaciones de master (`xlsx`, `hono`, `@hono/node-server` NO deben volver). Para `package-lock.json`: no resolver a mano — tomar cualquier lado, luego `npm install` lo regenera; verificar que el lockfile final no contenga `"hono"` ni `"node_modules/xlsx"`.

**Verify**: `git diff --name-only HEAD~1..HEAD | grep -cv "test\|vitest\|workflows\|docs\|package"` → 0 (el merge no modificó código fuente). `grep -c '"hono"\|"xlsx":' package.json` → 0. `npm install` → exit 0.

### Step 2: Catalogar los fallos, no arreglar todavía

`npm test 2>&1 | tee /tmp/test-baseline.txt`. Registrar QUÉ suites fallan y por qué (lista archivo → error resumido). Esperable: fallos en `price-lists.test.ts`, `cart.store.test.ts`, `PaymentModal.test.tsx`, `CartPanel.test.tsx`, posiblemente `operator.test.ts`, `sales.test.ts`, printer. Si fallan suites de módulos que NO cambiaron desde el merge-base (`format`, `payments`, `mappers`, `validation`) → sospechar de entorno, no de drift.

**Verify**: existe el catálogo de fallos (en tu reporte final, no como archivo commiteado).

### Step 3: Actualizar tests desactualizados, módulo por módulo

Para cada suite que falla: leer el módulo fuente ACTUAL, entender la semántica nueva, y actualizar el test para afirmarla. Reglas:

- **El código fuente manda.** El test se adapta a lo que el código hace HOY — salvo que lo que haga sea evidentemente un bug (ver STOP conditions).
- No borrar casos: si un caso ya no aplica (API eliminada), reemplazarlo por el equivalente actual; si no existe equivalente, eliminarlo documentándolo en el mensaje de commit.
- `operator.test.ts`: el modelo de permisos actual es 8 capacidades en 4 áreas; `normalizePermissions`/`parsePermissions` son **bi-shape** (aceptan el shape viejo de 11 flags) — los tests del shape viejo son VÁLIDOS y deben quedar (prueban la bi-shape), pero agregar al menos un caso del shape nuevo si no existe.
- Componentes (`PaymentModal.test.tsx`, `CartPanel.test.tsx`): el flujo ahora pasa por `resolvePromoLine` (líneas netas, `promo_discount`, `promotion_id`). Si la actualización de una suite de componente requiere reescritura profunda (>50% del archivo), convertir los casos rotos a `test.todo('<descripción>')` con un comentario y reportarlo — NO borrar la suite ni hundirse en un rabbit hole.

Commit por módulo arreglado.

**Verify** (por módulo): `npx vitest run <archivo>` → pass. Al final del step: `npm test` → 0 fallos (los `test.todo` no cuentan como fallo).

### Step 4: Suite nueva de `promotions.ts`

Crear `src/lib/__tests__/promotions.test.ts` (imports explícitos de `'vitest'`, fechas fijas vía el parámetro `at`). Helper local para construir `Promotion` con defaults. Casos mínimos:

- `isPromotionLive`: inactiva → false; archivada → false; `starts_at` futuro → false; `ends_at` pasado → false; vigente sin fechas → true.
- `findApplicablePromo`: producto > categoría > marca (3 promos que matchean, gana `product_id`); empate de especificidad → `created_at` más reciente; no vigentes ignoradas; sin match → null.
- `applyUnitPromo`: percent 20% de 150 → 120; offer_price 80 sobre 100 → 80; **offer_price 120 sobre 100 → 100** (nunca sube); kind quantity → intacto; redondeo (percent 33% de 10 → 6.7).
- `computeQuantityDiscount` (N/K/P): 2x1 qty=1→0, qty=2→unit, qty=3→unit, qty=4→2×unit; 3x2 qty=3→unit; 2da al 50% (N=2,K=1,P=50) qty=2→unit×0.5; N<2→0; K<1→0; unitPrice=0→0; kind≠quantity→0.
- `resolvePromoLine`: unitaria baja unitario y `promoDiscount = qty×(orig−nuevo)`; promo que no abarata → none (`promotionId: null`); cantidad deja unitario intacto y descuenta a nivel línea; qty≤0 / unitPrice≤0 → none.
- `promoBadgeLabel`: `-20%`, `Oferta`, `2x1`, `3x2`, `2da un. -50%`.

**Verify**: `npx vitest run promotions` → todos pasan (≥25 casos).

### Step 5: Verificación integral

**Verify**: `npm test` → exit 0. `npm run build` → exit 0. `npm run lint` → exit 0 con 0 errores. `git status` limpio (sin `.env.local` ni archivos fuera de scope).

## Test plan

(Este plan ES el test plan: ~325 tests heredados actualizados + ≥25 nuevos de promos. Los `test.todo` permitidos en Step 3 quedan listados en el reporte final.)

## Done criteria

- [ ] `npm test` exit 0
- [ ] `src/lib/__tests__/promotions.test.ts` existe con ≥25 casos y pasa
- [ ] `git log master..HEAD --name-only -- src/ | grep -v "__tests__\|src/test/"` → vacío (cero cambios a código fuente)
- [ ] `grep -c '"hono"\|"xlsx":' package.json` → 0 (el merge no resucitó deps eliminadas)
- [ ] `npm run build` y `npm run lint` exit 0
- [ ] Cantidad de `test.todo` reportada (idealmente 0; cada uno justificado)
- [ ] Fila actualizada en `plans/README.md` (la mantiene el reviewer si fuiste despachado)

## STOP conditions

- El merge conflictúa en archivos que NO son `package.json`/`package-lock.json` → la premisa "la rama solo agrega" es falsa; reportar la lista.
- Un test actualizado contra la semántica ACTUAL falla y al leer el código la semántica parece un **bug real** (p. ej. una divergencia TS↔SQL en promos/precios, un total que no cierra) → no adaptar el test al bug: reportar el caso con inputs/esperado/obtenido.
- Más de 3 suites necesitan la vía `test.todo` del Step 3 → la rama está más podrida de lo estimado; reportar antes de seguir.
- `npm run build` falla por algo ajeno a `.env.local`.

## Maintenance notes

- A partir de esto, la regla 11/36 (espejos TS↔SQL) tiene enforcement: cambios de semántica en precios/promos deben venir con su actualización de tests. El reviewer debe exigirlo.
- El workflow `.github/workflows/test.yml` empieza a correr en cada PR cuando esto llegue al remoto — primer PR después del merge: verificar que el check aparece y pasa.
- Los `test.todo` que queden son el backlog de tests de componentes post-promos.
- El plan 005 (centralizar `round2`) queda desbloqueado al cerrar este.
