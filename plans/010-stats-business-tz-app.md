# Plan 010: App — "hoy" y rangos de stats calculados en la timezone del negocio

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- src/lib/date-utils.ts src/lib/constants/domain.ts src/lib/business.ts "src/app/(app)" src/components/stats src/components/dashboard/DashboardView.tsx src/components/expenses/ExpensesView.tsx src/components/operator/OperatorMeView.tsx src/components/activity`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/009-stats-business-tz-sql.md — **APLICADA a la DB remota por el dueño** (cambia el contrato de `get_owner_stats`/`get_operator_stats` a parámetros `date`)
- **Category**: bug
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

Aun con el SQL alineado (plan 009), las fechas que la app le MANDA a los RPCs se calculan mal en dos lugares: (1) las páginas server-side (edge runtime = reloj en UTC) computan "hoy" con `new Date()` local del proceso — entre las 21:00 y las 24:00 hora argentina el dashboard renderea "hoy" = mañana ($0 con ventas a la vista); (2) `operator/me` construye límites con un offset `-03:00` **hardcodeado** (duplicado en dos archivos), que rompe para cualquier negocio fuera de UTC-3 y para países con DST. Además, el cliente usa la timezone del *browser*, que solo coincide con la del negocio por casualidad (dueño de viaje = números corridos). Este plan hace que "hoy" y los rangos se computen en `businesses.timezone` en server y cliente, y elimina el offset hardcodeado.

## Current state

### `src/lib/date-utils.ts` — el resolutor de rangos (líneas 96-135):

```ts
function formatDateLocal(date: Date): string {
  const y = date.getFullYear()      // ← timezone del proceso: UTC en edge, browser en cliente
  ...
}

export function resolveDateRange(
  period: DateRangePeriod | string,
  from?: string,
  to?: string
): DateRangeStrings {
  if (from && to) return { from, to }
  if (period === 'personalizado' || period === 'trimestre' || period === 'año') { ... }
  const now = new Date()
  const today = formatDateLocal(now)
  if (period === 'hoy') return { from: today, to: today }
  if (period === 'semana') { /* getDay()+setDate locales */ }
  if (period === 'mes') { /* getFullYear/getMonth locales */ }
  ...
}
```

### El offset hardcodeado (a eliminar):

- `src/lib/constants/domain.ts:29` — `export const BUSINESS_TIMEZONE_OFFSET = '-03:00'`
- `src/app/(app)/operator/me/page.tsx:64-69`:
  ```ts
  function toRangeTimestamps(from: string | null, to: string | null) {
    return {
      from: from ? `${from}T00:00:00${BUSINESS_TIMEZONE_OFFSET}` : null,
      to: to ? `${to}T23:59:59.999${BUSINESS_TIMEZONE_OFFSET}` : null,
    }
  }
  ```
  y sus usos en `supabase.rpc('get_owner_stats', { p_date_from: statsRange.from, ... })` (línea ~132) y `get_operator_stats` (línea ~186).
- `src/components/operator/OperatorMeView.tsx:22` — copia local `const BUSINESS_TIMEZONE_OFFSET = '-03:00'`, usada en las líneas 153-154 con el mismo patrón.

Tras el plan 009 aplicado, `get_owner_stats`/`get_operator_stats` aceptan `p_date_from date, p_date_to date` — los callers pasan `from`/`to` (strings `YYYY-MM-DD`) directo y `toRangeTimestamps` desaparece.

### Call sites de `resolveDateRange` (todos, verificados; los server pages corren en edge = UTC):

Server pages (11):
- `src/app/(app)/dashboard/page.tsx:26` — `resolveDateRange('hoy')` (seed del primer paint)
- `src/app/(app)/stats/page.tsx:27`
- `src/app/(app)/stats/top-products/page.tsx:29`
- `src/app/(app)/stats/operators/page.tsx:24`
- `src/app/(app)/stats/breakdown/page.tsx:25`
- `src/app/(app)/stats/trends/page.tsx:26`
- `src/app/(app)/stats/payment-methods/page.tsx:23`
- `src/app/(app)/stats/report/page.tsx:57`
- `src/app/(app)/stats/heatmap/page.tsx:26`
- `src/app/(app)/activity/page.tsx:77`
- `src/app/(app)/expenses/page.tsx:32`
- `src/app/(app)/operator/me/page.tsx:95`

Client components (7 — reciben props del page y refetchean al cambiar el período):
- `src/components/dashboard/DashboardView.tsx:165`
- `src/components/stats/StatsView.tsx:131`
- `src/components/stats/TrendsDetailView.tsx:84`
- `src/components/stats/SalesHeatmapView.tsx:69`
- `src/components/stats/ReportView.tsx:105` y `:156`
- `src/components/expenses/ExpensesView.tsx:75`
- `src/components/operator/OperatorMeView.tsx:151`

### Convenciones del repo que aplican

- Helpers de negocio en `src/lib/business.ts` (`getBusinessIdByUserId`, `requireAuthenticatedBusinessId` como exemplars de estilo).
- Tests de `date-utils` en `src/lib/__tests__/date-utils.test.ts`; `vitest.config.ts` pinnea `process.env.TZ = 'America/Argentina/Buenos_Aires'` (los tests nuevos deben pasar bajo esa TZ y ser deterministas con `vi.setSystemTime`).
- Consultas independientes en Server Components siempre via `Promise.all` (regla 14).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tests | `npm test` | all pass, incluidos los nuevos de date-utils |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Grep del offset | `grep -rn "BUSINESS_TIMEZONE_OFFSET" src/` | 0 matches al final |

## Scope

**In scope**:
- `src/lib/date-utils.ts` (+ su test)
- `src/lib/constants/domain.ts` (eliminar `BUSINESS_TIMEZONE_OFFSET`, agregar `DEFAULT_TIMEZONE`)
- `src/lib/business.ts` (helper `getBusinessTimezone`)
- Los 12 server pages y 7 client components listados arriba (threading del parámetro/prop `timezone`)

**Out of scope** (NO tocar):
- `getDateRange` / `getPreviousPeriodRange` (objetos `Date` para filtrado **in-memory** client-side, p. ej. `SalesHistoryTable`) — filtran timestamps que el viewer ve renderizados en su propia TZ; cambiarlos es otra discusión y no afecta a los RPCs.
- `DateRangeFilter.tsx` (UI del selector) — solo emite `period/from/to`; no calcula "hoy".
- El SQL — es el plan 009.
- Cualquier RPC call que no pase por `resolveDateRange`.

## Git workflow

- Commit sugerido: `fix(stats): rangos de fecha en TZ del negocio (server seed + vistas) y fuera el offset hardcodeado`.
- Do NOT push unless instructed.

## Steps

### Step 0: Gate de dependencia

Confirmar con el operador que la migración del plan 009 **fue aplicada** a la DB remota (las firmas nuevas de `get_owner_stats(date,date)` / `get_operator_stats(uuid,date,date)` existen). Si no → STOP (el Step 4 rompería `/operator/me`).

### Step 1: Helpers de timezone en `date-utils.ts`

Agregar a `src/lib/date-utils.ts`:

```ts
// "Hoy" (YYYY-MM-DD) en una timezone IANA. en-CA formatea como YYYY-MM-DD.
export function todayInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

// Suma días a un YYYY-MM-DD sin pasar por timezones (mediodía UTC evita bordes DST).
function shiftDateString(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d, 12))
  base.setUTCDate(base.getUTCDate() + deltaDays)
  return base.toISOString().slice(0, 10)
}
```

Extender la firma: `resolveDateRange(period, from?, to?, timeZone?: string)`. Cuando `timeZone` viene:
- `hoy`: `const today = todayInTimeZone(timeZone)` → `{ from: today, to: today }`.
- `semana`: derivar el weekday del propio string (`const [y, m, d] = today.split('-').map(Number); const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()` — el día de la semana de una fecha calendario no depende de TZ) y `from = shiftDateString(today, weekday === 0 ? -6 : 1 - weekday)`.
- `mes`: `from = today.slice(0, 7) + '-01'`.

Cuando `timeZone` es `undefined`, el comportamiento actual queda **byte a byte idéntico** (no romper a ningún caller no migrado).

**Verify**: `npm run typecheck` → exit 0; `npm test -- date-utils` → los tests existentes siguen verdes.

### Step 2: Tests del bug real

En `src/lib/__tests__/date-utils.test.ts` agregar un `describe('resolveDateRange con timezone')`:

```ts
it('a las 22:00 ART, "hoy" es el día local aunque UTC ya sea mañana', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-13T01:00:00Z'))   // = 2026-06-12 22:00 ART
  expect(todayInTimeZone('America/Argentina/Buenos_Aires')).toBe('2026-06-12')
  expect(todayInTimeZone('UTC')).toBe('2026-06-13')
  const r = resolveDateRange('hoy', undefined, undefined, 'America/Argentina/Buenos_Aires')
  expect(r).toEqual({ from: '2026-06-12', to: '2026-06-12' })
  vi.useRealTimers()
})
```

Más un caso de `semana` (lunes como inicio: con system time en un domingo ART verificar que `from` retrocede 6 días) y uno de `mes` (`from` = `YYYY-MM-01` del mes local).

**Verify**: `npm test -- date-utils` → all pass, incluidos los nuevos.

### Step 3: `DEFAULT_TIMEZONE` + `getBusinessTimezone`

- `src/lib/constants/domain.ts`: agregar `export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'`. NO borrar todavía `BUSINESS_TIMEZONE_OFFSET` (se borra en el Step 4 con sus usos).
- `src/lib/business.ts`: agregar, siguiendo el estilo de `getBusinessIdByUserId`:

```ts
export async function getBusinessTimezone(
  supabase: SupabaseClient,
  businessId: string
): Promise<string> {
  const { data } = await supabase
    .from('businesses')
    .select('timezone')
    .eq('id', businessId)
    .single()
  const tz = (data as { timezone?: string | null } | null)?.timezone
  return tz && tz.length > 0 ? tz : DEFAULT_TIMEZONE
}
```

(Usar el mismo tipo de cliente que ya tipan los helpers existentes del archivo.)

**Verify**: `npm run typecheck` → exit 0.

### Step 4: `operator/me` — fuera el offset

`src/app/(app)/operator/me/page.tsx`:
- Obtener `timezone` (sumar `getBusinessTimezone(supabase, businessId)` — puede ir secuencial tras `requireAuthenticatedBusinessId`, o sumarse al `Promise.all` existente respetando la regla 14).
- `resolveDateRange(period, params.from, params.to, timezone)`.
- Eliminar `toRangeTimestamps` y el import de `BUSINESS_TIMEZONE_OFFSET`; pasar `p_date_from: from, p_date_to: to` directo a `get_owner_stats`/`get_operator_stats` (post-009 aceptan `date`).
- Pasar `timezone` como prop a `OperatorMeView`.

`src/components/operator/OperatorMeView.tsx`:
- Eliminar la constante local de la línea 22 y el armado de límites de las líneas ~151-154; usar `resolveDateRange(period, from, to, timezone)` y pasar `from`/`to` directo al RPC que llame.
- Agregar `timezone: string` a sus props.

`src/lib/constants/domain.ts`: eliminar `BUSINESS_TIMEZONE_OFFSET`.

**Verify**: `grep -rn "BUSINESS_TIMEZONE_OFFSET" src/` → 0 matches; `npm run typecheck` → exit 0.

### Step 5: Server pages — threading de `timezone`

Para cada uno de los 11 pages restantes de la lista: obtener `timezone` vía `getBusinessTimezone` (si el page ya selecciona de `businesses`, sumar `timezone` a ese select en lugar de una query extra — caso `dashboard/page.tsx:46-50` que ya trae `name, settings`), pasar el 4º argumento a `resolveDateRange`, y agregar la prop `timezone` al componente de vista que renderiza.

Dashboard (`page.tsx:26`): `const hoy = resolveDateRange('hoy', undefined, undefined, timezone)` — nota: la query de `businesses` está en el mismo `Promise.all` que usa `hoy`, así que el fetch de timezone debe ocurrir ANTES (una query liviana previa con `getBusinessTimezone` es aceptable y más simple; dejar el select de `name, settings` como está).

**Verify**: `npm run typecheck` → exit 0 (los pages que pasan la prop nueva fallarán en typecheck hasta completar el Step 6 — hacer 5 y 6 por pares página↔vista si se prefiere verde continuo).

### Step 6: Client views — usar la prop

En los 7 componentes listados: agregar `timezone: string` a las props y pasarla como 4º argumento en cada `resolveDateRange(...)` de la lista de call sites. En `DashboardView`/`StatsView`/`TrendsDetailView`/`SalesHeatmapView`/`ReportView`, si el `queryKey` de React Query incluye `from/to` resueltos, no hay que tocar nada más (la key ya cambia con el rango); verificar que ninguna key dependa del período sin las fechas.

**Verify**: `npm run typecheck` → exit 0; `npm run lint` → exit 0; `npm test` → all pass; `npm run build` → exit 0.

## Test plan

- Los casos nuevos del Step 2 (regresión directa del bug: 22:00 ART ≠ día UTC).
- Tests existentes de `date-utils` intactos (la rama sin `timeZone` no cambió).
- Smoke manual (solo negocio dev 'tienda de seba'): con la migración 009 aplicada, abrir `/stats` y `/dashboard` y verificar que "Hoy" coincide con el widget de tendencias para el mismo día; en `/operator/me` verificar que los KPIs del período "mes" muestran lo mismo que antes para días sin ventas nocturnas.

## Done criteria

- [ ] `grep -rn "BUSINESS_TIMEZONE_OFFSET" src/` → 0 matches
- [ ] `grep -rn "toRangeTimestamps" src/` → 0 matches
- [ ] Los 12 pages y 7 views pasan `timezone` (spot-check: `grep -rn "resolveDateRange(" src/ | grep -v "timezone\|timeZone\|date-utils\|__tests__"` → 0 matches)
- [ ] `npm test` exit 0 con los casos nuevos
- [ ] `npm run typecheck`, `npm run lint`, `npm run build` exit 0
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- El gate del Step 0 falla (migración 009 sin aplicar) — reportar y no tocar `operator/me`.
- `get_owner_stats`/`get_operator_stats` tienen más callers que `operator/me` (`grep -rn "get_owner_stats\|get_operator_stats" src/`) — listar y reportar.
- Algún client component resuelve fechas con OTRA función no listada (señal de un patrón no inventariado).
- Un `queryKey` de React Query no incluye `from/to` (el refetch por período dependería de otra cosa) — reportar antes de tocar.

## Maintenance notes

- Regla para reviewers: cualquier llamada nueva a `resolveDateRange` que termine en un RPC debe pasar `timezone` — un caller sin el 4º argumento reintroduce el bug silenciosamente (sugerencia post-merge: deprecar la rama sin tz cuando no queden callers legacy).
- `getDateRange` (filtrado in-memory) quedó browser-local a propósito; si algún día se unifica, revisar `SalesHistoryTable` y los widgets que comparan `Date` objects.
- Si se agrega un negocio en una TZ con DST (México), `todayInTimeZone` ya lo maneja (Intl); el SQL del plan 009 también (`AT TIME ZONE` con nombre IANA).
