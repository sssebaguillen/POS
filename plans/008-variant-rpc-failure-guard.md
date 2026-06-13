# Plan 008: Blindar a los 5 consumidores de `get_product_with_variants` contra `{success:false}`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- src/lib/mappers.ts src/lib/__tests__/mappers.test.ts src/components/inventory/ProductStockModal.tsx src/components/pos/ProductPanel.tsx src/components/pos/POSView.tsx src/components/price-lists/VariantPriceModal.tsx src/components/inventory/EditProductModal.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (ideal después de 007, que deja `npm run typecheck` disponible)
- **Category**: bug
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

El RPC `get_product_with_variants(p_product_id)` devuelve **dos shapes**: `{success: true, product, options, variants}` o `{success: false, error: 'Product not found'}` (cuando el producto no existe o pertenece a otro negocio — el RPC scopea por tenant internamente). Los 5 consumidores en el frontend castean el resultado directo a `ProductWithVariants` **sin chequear `success`**. Cuando llega el shape de error (producto borrado por otro operario mientras la lista estaba abierta, tab vieja), 4 de los 5 crashean en runtime: el selector de variantes del POS revienta el render, el modal de stock queda en spinner infinito con unhandled rejection, etc. El fix es un type guard único + chequeo en cada call site, con degradación elegante.

## Current state

Contrato del RPC (de `supabase/schema.sql`, función `get_product_with_variants`):

```sql
  IF NOT EXISTS (
    SELECT 1 FROM products
    WHERE id = p_product_id AND business_id = v_business_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Product not found');
  END IF;

  SELECT json_build_object(
    'success', true,
    'product', json_build_object(...),
    'options', (...),
    'variants', (...)
  ) ...
```

Tipo TS (`src/lib/types/index.ts:451-455`) — nótese que NO modela el discriminador `success`, por eso el cast "compila" y miente:

```ts
export interface ProductWithVariants {
  product: Product
  options: ProductOption[]
  variants: ProductVariant[]
}
```

Los 5 call sites y qué les pasa con `{success:false}`:

1. **`src/components/inventory/ProductStockModal.tsx:37-43`** — CRASH (spinner infinito + unhandled rejection):
   ```ts
   const result = rpc as ProductWithVariants | null
   if (result && result.product.business_id !== businessId) {   // ← result.product es undefined → TypeError
   ```
2. **`src/components/pos/ProductPanel.tsx:258-260`** — CRASH de render en el POS (setea el objeto de error como data):
   ```ts
   supabase.rpc('get_product_with_variants', { p_product_id: product.id }).then(({ data: rpc }) => {
     setLoading(false)
     if (rpc) setData(rpc as ProductWithVariants)   // ← luego data.options.every / data.variants.filter revientan
   })
   ```
   Importante: este componente YA tiene un branch elegante para `data === null` (línea ~346): `if (!data || data.options.length === 0) return <div ...>Sin variantes disponibles</div>` — con el guard devolviendo `null`, ese branch absorbe el caso de error sin UI nueva.
3. **`src/components/pos/POSView.tsx:216-220`** — TypeError en el flujo de escaneo de barcode de variante:
   ```ts
   const { data: variantFull } = await supabase.rpc('get_product_with_variants', { p_product_id: parentProduct.id })
   const result = variantFull as ProductWithVariants | null
   const variantDetail = result?.variants.find(v => v.id === (data as { id: string }).id)   // ← result no es null pero variants sí → TypeError
   ```
   Los fallbacks de más abajo (`?? []`, `?? barcode`) ya contemplan `variantDetail` undefined — con el guard, el flujo degrada solo.
4. **`src/components/price-lists/VariantPriceModal.tsx:51-58`** — CRASH (`data?.variants.filter` con `variants` undefined):
   ```ts
   supabase.rpc('get_product_with_variants', { p_product_id: product.id }).then(({ data: rpc }) => {
     setLoading(false)
     if (rpc) setData(rpc as ProductWithVariants)
   })
   ...
   const activeVariants = useMemo(() => data?.variants.filter(v => v.is_active) ?? [], [data])
   ```
5. **`src/components/inventory/EditProductModal.tsx:138-142`** — NO crashea (usa `result?.options` / `result?.variants` con if), pero degrada en silencio; se migra al guard por consistencia.

Convención del repo que aplica: los normalizadores/unwrappers compartidos viven en `src/lib/mappers.ts` (ej. `normalizePriceList`, `unwrapRelation`) y se testean en `src/lib/__tests__/mappers.test.ts`. El guard nuevo va ahí.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests | `npm test` | all pass (incluye los nuevos de mappers) |
| Typecheck | `npm run typecheck` (o `npx tsc --noEmit` si el plan 007 no aterrizó) | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/lib/mappers.ts` (agregar `unwrapProductWithVariants`)
- `src/lib/__tests__/mappers.test.ts` (casos nuevos)
- `src/components/inventory/ProductStockModal.tsx`
- `src/components/pos/ProductPanel.tsx`
- `src/components/pos/POSView.tsx`
- `src/components/price-lists/VariantPriceModal.tsx`
- `src/components/inventory/EditProductModal.tsx`

**Out of scope** (NO tocar):
- El RPC SQL y su contrato — el dual-shape `{success}` es la convención del repo (regla 5/15 de CLAUDE.md); acá se arregla el lado consumidor.
- `src/lib/types/index.ts` — NO agregar `success` a `ProductWithVariants` ni crear un union type; el guard resuelve el narrowing sin tocar el modelo.
- Cualquier otro consumer de RPCs con shape `{success}` (`create_operator`, etc.) — ya chequean `data.success` o son otro plan.
- UI nueva de error en `ProductPanel`/`VariantPriceModal` — la degradación a estado vacío existente es deliberadamente suficiente.

## Git workflow

- Commit sugerido: `fix(variants): guard de {success:false} en consumidores de get_product_with_variants`.
- Do NOT push unless instructed.

## Steps

### Step 1: El guard en `lib/mappers.ts`

Agregar al final de `src/lib/mappers.ts`:

```ts
import type { ProductWithVariants } from '@/lib/types'

/**
 * get_product_with_variants devuelve {success:true, product, options, variants}
 * o {success:false, error}. Este guard es el ÚNICO punto de narrowing — castear
 * el resultado directo a ProductWithVariants crashea en el shape de error.
 */
export function unwrapProductWithVariants(rpc: unknown): ProductWithVariants | null {
  if (!rpc || typeof rpc !== 'object') return null
  if ((rpc as { success?: boolean }).success !== true) return null
  return rpc as unknown as ProductWithVariants
}
```

(Si `mappers.ts` ya importa de `@/lib/types`, sumar `ProductWithVariants` al import existente.)

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Tests del guard

En `src/lib/__tests__/mappers.test.ts`, agregar un `describe('unwrapProductWithVariants')` con 4 casos:

```ts
it('devuelve el objeto cuando success es true', () => {
  const ok = { success: true, product: { id: 'p1' }, options: [], variants: [] }
  expect(unwrapProductWithVariants(ok)).toBe(ok)
})
it('devuelve null para el shape de error {success:false}', () => {
  expect(unwrapProductWithVariants({ success: false, error: 'Product not found' })).toBeNull()
})
it('devuelve null para null/undefined', () => {
  expect(unwrapProductWithVariants(null)).toBeNull()
  expect(unwrapProductWithVariants(undefined)).toBeNull()
})
it('devuelve null para basura sin success', () => {
  expect(unwrapProductWithVariants({ product: {} })).toBeNull()
  expect(unwrapProductWithVariants('texto')).toBeNull()
})
```

**Verify**: `npm test -- mappers` → los 4 casos nuevos pasan.

### Step 3: Migrar los 5 call sites

En cada archivo, importar `unwrapProductWithVariants` desde `@/lib/mappers` y reemplazar el cast:

- **ProductStockModal.tsx** (líneas 37-43): reemplazar `const result = rpc as ProductWithVariants | null` por `const result = unwrapProductWithVariants(rpc)`, y ANTES del chequeo de `business_id` agregar:
  ```ts
  if (!result) {
    setError('Producto no encontrado')
    setLoading(false)
    return
  }
  if (result.product.business_id !== businessId) { ... }  // el chequeo defensivo existente, ahora sin optional
  ```
- **ProductPanel.tsx** (línea 260): `if (rpc) setData(rpc as ProductWithVariants)` → `setData(unwrapProductWithVariants(rpc))`. Nada más: el branch `if (!data || ...)` existente renderiza "Sin variantes disponibles".
- **POSView.tsx** (línea ~218): `const result = variantFull as ProductWithVariants | null` → `const result = unwrapProductWithVariants(variantFull)`. El resto del flujo ya tolera `result === null`.
- **VariantPriceModal.tsx** (línea 53): `if (rpc) setData(rpc as ProductWithVariants)` → `setData(unwrapProductWithVariants(rpc))`.
- **EditProductModal.tsx** (línea ~140): `const result = data as ProductWithVariants | null` → `const result = unwrapProductWithVariants(data)`. Los `if (result?.options)` existentes quedan igual.

Si algún archivo deja de usar el tipo `ProductWithVariants` en imports tras el cambio, limpiar el import muerto.

**Verify**: `grep -rn "as ProductWithVariants" src/components/` → 0 matches. `npm run typecheck` → exit 0. `npm run lint` → exit 0.

### Step 4: Suite completa

**Verify**: `npm test` → all pass. `npm run build` → exit 0.

## Test plan

- Los 4 casos unitarios del guard (Step 2), siguiendo el patrón de los tests existentes en `src/lib/__tests__/mappers.test.ts`.
- Smoke manual recomendado al reviewer (solo negocio dev 'tienda de seba'): abrir el POS, hover sobre un producto con variantes (selector carga normal); en otra tab borrar ese producto desde /inventory; volver al POS y re-hover → debe mostrar "Sin variantes disponibles", no una pantalla rota.

## Done criteria

- [ ] `grep -rn "as ProductWithVariants" src/components/` → 0 matches
- [ ] `grep -c "unwrapProductWithVariants" src/lib/mappers.ts` → ≥1
- [ ] `npm test` exit 0, incluidos 4 casos nuevos de mappers
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` exit 0
- [ ] `git status` sin archivos fuera del scope
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- Los extractos de "Current state" no coinciden con el código vivo (estos componentes se tocan seguido).
- `ProductPanel` ya no tiene el branch `if (!data || data.options.length === 0)` — la degradación elegante asumida desapareció; reportar en vez de inventar UI.
- Aparece un sexto call site de `get_product_with_variants` no listado (`grep -rn "get_product_with_variants" src/`) — migrarlo con el mismo patrón SOLO si es idéntico a los casos 2/4; si tiene lógica distinta, reportar.

## Maintenance notes

- Regla para reviewers: ningún resultado de `get_product_with_variants` se castea directo — siempre `unwrapProductWithVariants`. Mismo espíritu que la regla 15 de CLAUDE.md (RPCs con wrapper `{data}`).
- Si a futuro el RPC suma campos al shape de éxito, solo cambia `ProductWithVariants` — el guard no se toca.
- Deuda consciente que este plan NO cubre: los call sites no distinguen "no encontrado" de "error de red" (ambos degradan igual). Si algún día importa, el guard puede devolver un Result en vez de null — hoy sería sobre-ingeniería.
