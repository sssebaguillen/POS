# Plan 009: Migración SQL — día contable en la timezone del negocio para todos los RPCs de stats

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- supabase/schema.sql supabase/migrations/`
> If `supabase/schema.sql` changed since this plan was written, re-verificar
> con los greps del Step 0 antes de seguir; si los conteos no coinciden,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (solo a nivel de revisión — la migración NO se aplica en este plan)
- **Depends on**: none (el plan 010 depende de ESTE)
- **Category**: bug / migration
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

Los RPCs de estadísticas agrupan/filtran ventas por día con `s.created_at::date`, que castea el timestamptz usando la TimeZone de la sesión de Postgres — **UTC en Supabase**. Pero el negocio vive en su propia timezone (`businesses.timezone`, IANA, default `America/Argentina/Buenos_Aires` = UTC-3), y los RPCs de heatmap y los snapshots diarios YA agrupan correctamente con `(s.created_at AT TIME ZONE b.timezone)::date` (fix de 2026-05-28). Resultado: **toda venta entre las 21:00 y las 24:00 hora argentina cae en el día siguiente** para los KPIs, desgloses, top products y márgenes, pero en el día correcto para heatmap/tendencias/snapshots. La página `/stats` se contradice a sí misma, y es el horario pico de un almacén/kiosco. Este plan crea UNA migración que alinea 14 funciones al patrón correcto, y migra 2 más (`get_owner_stats`/`get_operator_stats`) de límites timestamptz (que el cliente construye con un offset `-03:00` hardcodeado) a parámetros `date` con la misma semántica. La migración **no se aplica acá** — eso lo decide el dueño (convención del plan 004).

## Current state

### El patrón incorrecto (UTC) — ejemplo real, `get_stats_kpis` en `supabase/schema.sql` (buscar con `grep -n 'FUNCTION "public"."get_stats_kpis"' supabase/schema.sql`):

```sql
  v_to   := COALESCE(p_to,   CURRENT_DATE);
  v_from := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
  ...
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND s.created_at::date BETWEEN v_from AND v_to;
```

`CURRENT_DATE` también es el día UTC del servidor — ambos patrones se corrigen juntos.

### El patrón correcto (exemplar a imitar) — `get_operator_sales_sparkline`, ya en producción (en `supabase/schema.sql`):

```sql
DECLARE
  v_timezone           text;
  ...
BEGIN
  ...
  SELECT timezone INTO v_timezone
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_timezone IS NULL OR v_timezone = '' THEN
    v_timezone := 'America/Argentina/Buenos_Aires';
  END IF;

  v_to := (now() AT TIME ZONE v_timezone)::date;
  ...
  WHERE s.business_id = p_business_id
    AND s.status = 'completed'
    AND (s.created_at AT TIME ZONE v_timezone)::date BETWEEN v_from AND v_to
```

`get_sales_heatmap` usa el mismo patrón. **Imitar este exemplar al pie de la letra.**

### Inventario de funciones a corregir (verificado el 2026-06-12; conteo = ocurrencias de `created_at::date` en cada una dentro de `supabase/schema.sql`):

| Función | Ocurrencias | Notas especiales |
|---|---|---|
| `get_stats_kpis` | 6 | También `CURRENT_DATE` en defaults de `v_to`/`v_from` |
| `get_stats_evolution` | 6 | ídem patrón |
| `get_business_balance` | 1 | La parte de expenses puede usar otra columna de fecha — tocar SOLO los casts de `created_at` de ventas; si `expenses` filtra por una columna `date` (sin hora), esa queda como está |
| `get_stats_breakdown` | 4 | |
| `get_top_products_detail` | 4 | |
| `get_sales_by_payment_detail` | 4 | |
| `get_sales_by_category_detail` | 4 | |
| `get_sales_by_brand_detail` | 4 | |
| `get_sales_by_operator_detail` | 2 | |
| `get_promo_impact` | 4 | Fuente original: `supabase/migrations/20260612_02_get_promo_impact.sql` (su comentario dice "mismo manejo de fechas que get_top_products_detail" — esa herencia es exactamente lo que este plan corta) |
| `get_margin_analysis` | 6 | **Guard dual-use** (`IF auth.uid() IS NOT NULL THEN assert_tenant…` — la llama también el cron como service_role). NO tocar el guard |
| `get_channel_signals` | 8 | Guard dual-use. Detector P12 — ventanas comparativas; reemplazar también su ancla de "hoy" si usa `CURRENT_DATE` |
| `get_product_demand_shifts` | 2 | Guard dual-use, ídem |
| `get_payment_mix_shift` | 2 | Guard dual-use, ídem |

Total: 57 ocurrencias. Tras la migración + sync de `schema.sql` deben quedar **exactamente 2** ocurrencias de `created_at::date` en `supabase/schema.sql`: las de `get_dead_stock` y `get_overstock` (`(CURRENT_DATE - p.created_at::date) AS age_days` — antigüedad de producto en días, un corrimiento de 3 h es inmaterial; **deliberadamente fuera de scope**).

### Las 2 funciones con cambio de firma (timestamptz → date):

`get_owner_stats(p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL)` y
`get_operator_stats(p_operator_id uuid, p_date_from timestamptz DEFAULT NULL, p_date_to timestamptz DEFAULT NULL)`.

Hoy el caller (`src/app/(app)/operator/me/page.tsx:64-69`) construye los límites con un offset hardcodeado:

```ts
const BUSINESS_TIMEZONE_OFFSET = '-03:00'   // lib/constants/domain.ts:29
from: from ? `${from}T00:00:00${BUSINESS_TIMEZONE_OFFSET}` : null,
```

Cambio: nuevas versiones con `p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL` que internamente filtran `(s.created_at AT TIME ZONE v_timezone)::date BETWEEN ...`. Como cambia el TIPO de los parámetros, `CREATE OR REPLACE` crearía un **overload** (ambigüedad en PostgREST) — hay que `DROP FUNCTION` la firma vieja primero. Nota de compatibilidad: durante la ventana entre aplicar la migración y deployar el plan 010, el cliente viejo seguirá mandando strings ISO (`'2026-06-12T00:00:00-03:00'`); Postgres los castea a `date` tomando la parte de fecha — compatible.

### Convenciones del repo que aplican

- **Regla 34 (CLAUDE.md)**: toda función reemplazada o creada lleva en la MISMA migración `REVOKE ALL ... FROM PUBLIC, anon;` + el GRANT que corresponda. **Copiar los grants EXACTOS que cada función tiene hoy en `supabase/schema.sql`** (sección de REVOKE/GRANT, líneas ~13400-13700) — las dual-use llevan `TO authenticated, service_role` (el cron las necesita); no inventar.
- Nombre de migración: `supabase/migrations/YYYYMMDD_NN_stats_business_local_day.sql` con la fecha real de ejecución y `NN` siguiente disponible para ese día.
- `supabase/schema.sql` se mantiene **en sync a mano** (editar las definiciones en el mismo cambio; NO regenerar con `supabase db dump`).
- La **fuente de verdad** de cada definición actual es `supabase/schema.sql` (las migraciones viejas pueden estar superseded).
- Estilo de migración: ver `supabase/migrations/20260612_02_get_promo_impact.sql` (header con propósito, función completa, bloque REVOKE/GRANT al final con comentario "Regla 34").

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Conteo baseline | `grep -c "created_at::date" supabase/schema.sql` | `59` (antes) |
| Conteo final | `grep -c "created_at::date" supabase/schema.sql` | `2` (después) |
| Tests (TS intacto) | `npm test` | all pass |
| Localizar una función | `grep -n 'FUNCTION "public"."<nombre>"' supabase/schema.sql` | línea de la definición |

## Scope

**In scope**:
- `supabase/migrations/<fecha>_NN_stats_business_local_day.sql` (crear)
- `supabase/schema.sql` (sincronizar las 16 definiciones)

**Out of scope** (NO tocar):
- **Aplicar la migración a la DB remota** — la aplica el dueño (`npm run supabase:db:push`) cuando decida; este plan solo deja el archivo listo.
- Todo el código TS (`src/`) — es el plan 010.
- `get_dead_stock` / `get_overstock` — su `created_at::date` es edad de producto, inmaterial.
- `get_sales_heatmap`, `get_operator_sales_sparkline`, `daily_snapshots` y familia (`upsert_daily_snapshot`, `refresh_*`), `get_period_comparison` — ya correctos.
- `get_audit_log` y cualquier RPC que no esté en la tabla del inventario.

## Git workflow

- Commit sugerido: `fix(stats): migración día contable en TZ del negocio (16 RPCs) — NO aplicada`.
- Do NOT push unless instructed.

## Steps

### Step 0: Baseline

**Verify**: `grep -c "created_at::date" supabase/schema.sql` → `59`. Si da otro número, el schema derivó → STOP y reportar el conteo.

### Step 1: Crear la migración con las 14 funciones de patrón simple

Crear `supabase/migrations/<fecha>_NN_stats_business_local_day.sql`. Header sugerido:

```sql
-- ============================================================
-- Día contable en la timezone del negocio (plan 009)
-- ============================================================
-- Los RPCs de stats filtraban por día UTC (created_at::date) mientras
-- heatmap/snapshots ya usaban AT TIME ZONE b.timezone — las ventas de
-- 21:00-24:00 ART caían en el día siguiente y las vistas se contradecían.
-- Patrón espejo de get_operator_sales_sparkline / get_sales_heatmap.
```

Para CADA una de las 14 funciones del inventario:
1. Copiar su definición completa y vigente desde `supabase/schema.sql`.
2. Agregar `v_timezone text;` al DECLARE (si no existe).
3. Inmediatamente después del guard de tenant existente (no antes), insertar el fetch con fallback del exemplar:
   ```sql
   SELECT timezone INTO v_timezone FROM public.businesses WHERE id = p_business_id;
   IF v_timezone IS NULL OR v_timezone = '' THEN
     v_timezone := 'America/Argentina/Buenos_Aires';
   END IF;
   ```
   (En las dual-use, el `p_business_id` ya viene validado por su guard `IF auth.uid() IS NOT NULL THEN assert_tenant…` — **no modificar el guard**.)
4. Reemplazar TODA ocurrencia de `s.created_at::date` (o el alias que use) por `(s.created_at AT TIME ZONE v_timezone)::date`, y `created_at::date` sin alias por `(created_at AT TIME ZONE v_timezone)::date`. Solo sobre la tabla `sales` (alias `s` o subqueries de sales).
5. Reemplazar `CURRENT_DATE` por `(now() AT TIME ZONE v_timezone)::date` **solo** donde signifique "hoy" para defaults/ventanas de fechas de ventas.
6. Cerrar cada función con su bloque de grants copiado verbatim de `schema.sql` (REVOKE + GRANTs actuales), precedido del comentario `-- Regla 34`.

**Verify**: `grep -c "AT TIME ZONE v_timezone" supabase/migrations/<archivo>.sql` → ≥ 57 (las 57 ocurrencias migradas; puede ser mayor por los `now()`).

### Step 2: `get_owner_stats` y `get_operator_stats` (DROP + CREATE con firma `date`)

En la MISMA migración, después de las 14:

```sql
DROP FUNCTION IF EXISTS public.get_owner_stats(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_operator_stats(uuid, timestamptz, timestamptz);
```

Recrearlas copiando el cuerpo vigente de `schema.sql` con estos cambios:
- Firma: `p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL` (mismos nombres de parámetro — el caller usa named args).
- El filtro actual `s.created_at BETWEEN p_date_from AND p_date_to` (o equivalente con `>=`/`<=`) pasa a:
  ```sql
  AND (p_date_from IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date >= p_date_from)
  AND (p_date_to   IS NULL OR (s.created_at AT TIME ZONE v_timezone)::date <= p_date_to)
  ```
- `v_timezone` se obtiene del negocio que la función ya resuelve internamente (ambas derivan el negocio del caller/operador — usar ese mismo id en el `SELECT timezone`).
- Re-asentar grants: las firmas NUEVAS no heredan nada — copiar el patrón actual (`REVOKE ALL ... FROM PUBLIC; GRANT ALL ... TO authenticated; GRANT ALL ... TO service_role;` ajustado a `(date, date)` / `(uuid, date, date)`).

**Verify**: `grep -c "DROP FUNCTION IF EXISTS" supabase/migrations/<archivo>.sql` → `2`; `grep -c "REVOKE" supabase/migrations/<archivo>.sql` → ≥ 16.

### Step 3: Sincronizar `supabase/schema.sql`

Editar en el schema cada una de las 16 definiciones para que queden idénticas a la migración (mismo cuerpo; en el schema el estilo de quoting es `"public"."fn"` — respetarlo). Para las 2 de firma nueva, actualizar también sus líneas `ALTER FUNCTION ... OWNER`, `REVOKE`/`GRANT` (firmas `("p_date_from" "date", ...)`).

**Verify**: `grep -c "created_at::date" supabase/schema.sql` → `2`. `grep -c "AT TIME ZONE" supabase/schema.sql` → ≥ 68 (11 previas + ~57 nuevas).

### Step 4: Suite y verificación final

**Verify**: `npm test` → all pass (no se tocó TS). `git status` → solo la migración nueva y `schema.sql`.

## Test plan

No hay tests TS para SQL. La verificación post-aplicación es del DUEÑO (incluirla en el reporte final del executor):

```sql
-- 1. ¿Hay ventas cuyo día UTC difiere del día local? (las que este fix re-bucketea)
SELECT s.id, s.created_at,
       s.created_at::date                              AS utc_day,
       (s.created_at AT TIME ZONE b.timezone)::date    AS local_day
FROM sales s JOIN businesses b ON b.id = s.business_id
WHERE s.created_at::date <> (s.created_at AT TIME ZONE b.timezone)::date
ORDER BY s.created_at DESC LIMIT 10;

-- 2. Tras aplicar: get_stats_kpis de un día con venta nocturna debe coincidir
--    con get_period_comparison / daily_snapshots para ese mismo día local.
```

## Done criteria

- [ ] La migración existe, con 14 `CREATE OR REPLACE FUNCTION` + 2 `DROP` + 2 `CREATE FUNCTION` y bloques REVOKE/GRANT por función
- [ ] `grep -c "created_at::date" supabase/schema.sql` → `2`
- [ ] `npm test` exit 0
- [ ] La migración NO fue aplicada (sin llamadas a `supabase db push` ni MCP)
- [ ] `git status` sin archivos fuera del scope
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- El baseline del Step 0 no da 59, o alguna función del inventario no contiene el patrón esperado (ya la arreglaron / cambió).
- Alguna función del inventario no aparece en `supabase/schema.sql`.
- El guard de una dual-use no coincide con el patrón `IF auth.uid() IS NOT NULL THEN ... assert_tenant` descrito — no adivinar; reportar.
- `get_owner_stats`/`get_operator_stats` resultan tener más callers que `operator/me` (verificar con `grep -rn "get_owner_stats\|get_operator_stats" src/`) — si hay otros, listarlos en el reporte antes de seguir.
- Cualquier impulso de "ya que estoy" tocar heatmap/snapshots/dead-stock — fuera de scope.

## Maintenance notes

- Regla de facto nueva para reviewers: en RPCs de stats **nunca** `created_at::date` pelado — siempre `(created_at AT TIME ZONE v_timezone)::date` con el fetch+fallback del exemplar. Vale la pena agregarla a CLAUDE.md cuando el dueño aplique la migración (fuera de scope de este plan).
- El plan 010 (lado TS) depende de que el dueño APLIQUE esta migración: cambia el contrato de `get_owner_stats`/`get_operator_stats` a `date`.
- Se solapa en intención con el plan 004 (re-asentar grants): este plan ya re-asienta los grants de las 16 que toca; al ejecutar 004, excluir las cubiertas acá para no duplicar.
- `get_promo_impact` heredó el patrón UTC por copia de `get_top_products_detail` — la migración corta esa herencia; cualquier RPC de stats futuro debe copiar de los exemplars correctos.
