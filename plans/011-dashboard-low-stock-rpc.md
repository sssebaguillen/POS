# Plan 011: RPC agregado de stock crítico — el dashboard deja de traer 5000 productos

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- src/app/\(app\)/dashboard/page.tsx src/components/dashboard/DashboardView.tsx supabase/schema.sql`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (función nueva aditiva; swap de UI con gate de aplicación)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

Cada carga del dashboard trae hasta **5000 productos** (`id, name, category_id, stock, min_stock, is_active`) cuyo único consumidor es la KPI card "Stock crítico": un conteo partido (sin stock / stock bajo) y un preview de 2 nombres. Con catálogos chicos es invisible; con un negocio real de miles de SKUs son cientos de KB y trabajo de serialización en CADA visita a la página más vista de la app. Un RPC agregado devuelve los 3 números y los 2 nombres en una fila.

## Current state

### `src/app/(app)/dashboard/page.tsx:41-45` — el fetch a reemplazar (dentro del `Promise.all`):

```ts
supabase
  .from('products')
  .select('id, name, category_id, stock, min_stock, is_active')
  .eq('business_id', businessId)
  .limit(5000),
```

y su mapeo en las líneas 124-131:

```ts
products={(products ?? []).map(product => ({
  id: product.id,
  name: product.name,
  category_id: product.category_id,
  stock: Number(product.stock),
  min_stock: Number(product.min_stock),
  is_active: Boolean(product.is_active),
}))}
```

### `src/components/dashboard/DashboardView.tsx` — el único consumidor del prop `products`:

```ts
// líneas 223-246
const lowStockProducts = useMemo(
  () => products.filter(p => p.is_active && p.stock <= p.min_stock),
  [products]
)
const outOfStockCount = useMemo(() => lowStockProducts.filter(p => p.stock <= 0).length, [lowStockProducts])
const lowStockCount = useMemo(() => lowStockProducts.filter(p => p.stock > 0).length, [lowStockProducts])
const outOfStock = useMemo(() => lowStockProducts.filter(p => p.stock <= 0).sort((a, b) => a.stock - b.stock), [lowStockProducts])
const lowStock = useMemo(() => lowStockProducts.filter(p => p.stock > 0).sort((a, b) => a.stock - b.stock), [lowStockProducts])
const alertPreview = useMemo(() => {
  const rows = [
    ...outOfStock.map(p => ({ id: p.id, name: p.name, tone: 'out' as const })),
    ...lowStock.map(p => ({ id: p.id, name: p.name, tone: 'low' as const })),
  ]
  return { rows: rows.slice(0, 2), remaining: Math.max(0, rows.length - 2) }
}, [outOfStock, lowStock])
```

Render (líneas 389-414): KPI card con `value={String(lowStockProducts.length)}`, `subtitle={`${outOfStockCount} sin stock · ${lowStockCount} stock bajo`}` y el preview de `alertPreview.rows` + `+{alertPreview.remaining} más`. **Verificado**: `products` no se usa en ningún otro lugar del componente (solo el type en la línea ~85 y la destructuración en ~123). El prop es estático por carga (no se refetchea al cambiar período) — el RPC hereda esa semántica.

### Exemplar SQL del repo (estilo a imitar): `supabase/migrations/20260612_02_get_promo_impact.sql`

```sql
CREATE OR REPLACE FUNCTION public.get_promo_impact(
  p_business_id uuid, ...
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
BEGIN
  PERFORM public.assert_tenant(p_business_id);
  ...
  RETURN jsonb_build_object(...);
END;
$$;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_promo_impact(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_promo_impact(uuid, date, date) TO authenticated, service_role;
```

Convenciones que aplican: regla 34 (assert_tenant primera sentencia + REVOKE/GRANT en la misma migración), `supabase/schema.sql` se sincroniza a mano, migración `YYYYMMDD_NN_descripcion.sql`, y **el stock negativo es válido** en este dominio (decisión de producto) — `stock <= 0` cuenta como "sin stock", jamás sugerir constraints.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**:
- `supabase/migrations/<fecha>_NN_get_low_stock_summary.sql` (crear)
- `supabase/schema.sql` (agregar la función + grants, en sync)
- `src/app/(app)/dashboard/page.tsx`
- `src/components/dashboard/DashboardView.tsx`

**Out of scope** (NO tocar):
- La lógica de onboarding/wizard del dashboard (categorías/marcas/listas — fetch condicional aparte).
- `/inventory` y sus listados (siguen trayendo productos completos, es su trabajo).
- Variantes: el conteo usa `products.stock` igual que el código actual — si el negocio usa variantes, `products.stock` ya es lo que la card mostraba; NO "mejorar" sumando `product_variants` (cambiaría los números mostrados — fuera de alcance).
- Aplicar la migración (decisión del dueño; ver gate del Step 3).

## Git workflow

- Commit sugerido: `perf(dashboard): get_low_stock_summary reemplaza el fetch de 5000 productos`.
- Do NOT push unless instructed.

## Steps

### Step 1: La migración

Crear `supabase/migrations/<fecha>_NN_get_low_stock_summary.sql`:

```sql
-- ============================================================
-- get_low_stock_summary — KPI "Stock crítico" del dashboard
-- ============================================================
-- Reemplaza el fetch de hasta 5000 productos por carga del dashboard:
-- la card solo necesita conteos + 2 nombres de preview. Mismos criterios
-- que el filtro client-side que reemplaza (is_active AND stock <= min_stock;
-- stock <= 0 cuenta como "sin stock" — el stock negativo es válido acá).

CREATE OR REPLACE FUNCTION public.get_low_stock_summary(p_business_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_out_count int;
  v_low_count int;
  v_preview   jsonb;
BEGIN
  PERFORM public.assert_tenant(p_business_id);

  SELECT
    COUNT(*) FILTER (WHERE stock <= 0),
    COUNT(*) FILTER (WHERE stock > 0)
  INTO v_out_count, v_low_count
  FROM products
  WHERE business_id = p_business_id
    AND is_active = true
    AND stock <= min_stock;

  SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) INTO v_preview
  FROM (
    SELECT id, name, stock
    FROM products
    WHERE business_id = p_business_id
      AND is_active = true
      AND stock <= min_stock
    ORDER BY (stock <= 0) DESC, stock ASC, name ASC
    LIMIT 2
  ) row;

  RETURN jsonb_build_object(
    'out_count', v_out_count,
    'low_count', v_low_count,
    'preview',   v_preview
  );
END;
$$;

-- Regla 34: Supabase otorga EXECUTE a PUBLIC por defecto
REVOKE ALL ON FUNCTION public.get_low_stock_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_low_stock_summary(uuid) TO authenticated, service_role;
```

El `ORDER BY (stock <= 0) DESC, stock ASC` replica la prioridad del preview actual (sin stock primero, después stock bajo, ambos ascendente).

**Verify**: el archivo existe y contiene `assert_tenant`, `REVOKE` y `GRANT` (`grep -c "assert_tenant\|REVOKE\|GRANT" <archivo>` → 3).

### Step 2: Sincronizar `supabase/schema.sql`

Agregar la función al schema (estilo quoted del dump: `"public"."get_low_stock_summary"`), su `ALTER FUNCTION ... OWNER TO "postgres";` y las líneas de REVOKE/GRANT en la sección de grants, espejando cómo aparece `get_promo_impact` en ese archivo.

**Verify**: `grep -c "get_low_stock_summary" supabase/schema.sql` → ≥ 4 (definición + owner + revoke + grants).

### Step 3: GATE — aplicar la migración

**Detenerse y pedirle al operador** que aplique la migración a la DB remota (`npm run supabase:db:push` o el flujo que prefiera). Es aditiva (función nueva, nada se rompe si se aplica sola). **No continuar al Step 4 hasta confirmación** — el swap de UI llamaría a una función inexistente.

### Step 4: Swap en `dashboard/page.tsx`

- Reemplazar la entrada del `Promise.all` (líneas 41-45) por:
  ```ts
  supabase.rpc('get_low_stock_summary', { p_business_id: businessId }),
  ```
  (renombrar la variable destructurada de `products` a `lowStockRaw`).
- Unwrap bajo la convención del repo (regla 15 — cast del jsonb):
  ```ts
  const lowStockSummary = (lowStockRaw as unknown as {
    out_count: number
    low_count: number
    preview: { id: string; name: string; stock: number }[]
  } | null) ?? { out_count: 0, low_count: 0, preview: [] }
  ```
- Reemplazar el prop `products={...}` (líneas 124-131) por `lowStock={lowStockSummary}`.

**Verify**: `grep -n "limit(5000)" "src/app/(app)/dashboard/page.tsx"` → 0 matches.

### Step 5: Swap en `DashboardView.tsx`

- Cambiar el prop: eliminar `products: ProductRecord[]` (y el tipo `ProductRecord` si queda sin uso) por:
  ```ts
  lowStock: { out_count: number; low_count: number; preview: { id: string; name: string; stock: number }[] }
  ```
- Eliminar los 5 `useMemo` de las líneas 223-246 y derivar:
  ```ts
  const lowStockTotal = lowStock.out_count + lowStock.low_count
  const alertPreview = {
    rows: lowStock.preview.map(p => ({ id: p.id, name: p.name, tone: p.stock <= 0 ? ('out' as const) : ('low' as const) })),
    remaining: Math.max(0, lowStockTotal - lowStock.preview.length),
  }
  ```
- KPI card (líneas ~389-392): `value={String(lowStockTotal)}`, `subtitle={`${lowStock.out_count} sin stock · ${lowStock.low_count} stock bajo`}`. El render del preview queda idéntico.

**Verify**: `npm run typecheck` → exit 0; `npm run lint` → exit 0; `npm test` → all pass; `npm run build` → exit 0.

## Test plan

- No hay test unitario razonable (server page + RPC); la paridad se valida con el smoke.
- Smoke manual (SOLO negocios dev 'tienda de seba' / 'Q tal lokis'): anotar los 3 números de la card "Stock crítico" ANTES del swap; tras el swap deben ser idénticos, mismo orden del preview. Probar también el caso 0 alertas (card con valor 0, sin preview).

## Done criteria

- [ ] Migración creada con assert_tenant + REVOKE/GRANT; `schema.sql` en sync
- [ ] Migración aplicada por el operador (gate del Step 3 confirmado)
- [ ] `grep -rn "limit(5000)" src/app` → 0 matches
- [ ] Card "Stock crítico" muestra los mismos números que antes (smoke en negocio dev)
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` exit 0
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- `products` resulta tener OTRO consumidor en `DashboardView` además de los useMemos listados (`grep -n "products" src/components/dashboard/DashboardView.tsx` muestra usos fuera de las líneas 85/123/224) — inventario incompleto, reportar.
- El operador no aplica la migración (Step 3) — dejar la migración commiteada, status BLOCKED con motivo, NO hacer el swap de UI.
- Los números del smoke difieren — la query SQL no replica el filtro client-side; revertir el swap y reportar la diferencia exacta.

## Maintenance notes

- Si algún día la card necesita "ver todas las alertas" (lista completa), NO volver al fetch masivo: extender el RPC con `p_limit` o crear `get_low_stock_products` paginado.
- Si el conteo debe pasar a considerar stock por variante, ese cambio va en el RPC (un solo lugar) — hoy replica deliberadamente la semántica `products.stock` del código que reemplaza.
- El RPC es candidato natural a reuso por el detector P12 de stock (misma definición de "crítico").
