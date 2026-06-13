# Plan 012: Tests para los gates de ruta y permisos de `proxy.ts`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- src/proxy.ts src/lib/operator.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (solo riesgo de brittleness del test; no toca producción)
- **Depends on**: none (007 recomendado antes, por el gate de typecheck en CI)
- **Category**: tests
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

`src/proxy.ts` (236 líneas) es la primera línea de defensa de la app: redirige no-autenticados, limpia cookies de operador inválidas, y aplica 8 gates de permiso por ruta. La regla 16 de CLAUDE.md obliga a tocarlo en cada capability nueva — y un typo en una key de permiso ahí falla **en silencio** (el gate deja pasar o bloquea de más, sin error). Hoy tiene **cero tests** mientras la suite del repo ya cubre rutas API análogas. Una suite de ~14 casos congela el contrato.

## Current state

### Estructura de `src/proxy.ts` (la función exportada es `proxy(request: NextRequest)`):

1. Lee env `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (throw si faltan) y arma el CSP.
2. `createServerClient` de `@supabase/ssr` → `supabase.auth.getUser()`.
3. Routing de auth (líneas 93-119):
   - `!user && !isAuthRoute && !isCatalogRoute` → redirect `/login`.
   - `user && isAuthRoute && !isUpdatePasswordRoute` → redirect `/pos`.
   - `!user || isCatalogRoute` → pasa (catálogo público).
4. `getActiveOperator(request.cookies)` (verifica HMAC de la cookie `operator_session`):
   - `operator?.role === 'owner'` → pasa y setea cookie `op_perms` = `OWNER_PERMISSIONS` (línea 125).
   - `!operator` → limpia `operator_session`/`op_perms` y redirige a `/operator-select` (o pasa si ya está ahí) — líneas 134-147.
   - operador en `/operator-select` → redirect `/dashboard` (manager) o `/pos` (líneas 149-152).
5. Gates por ruta (operador no-owner) — **la tabla a congelar**:

| Ruta(s) | Condición de bloqueo | Línea |
|---|---|---|
| `/profile` | siempre (owner-only) | 154-157 |
| `/expenses` | `!hasPermission(operator, 'expenses')` | 159-162 |
| `/dashboard`, `/stats`, `/activity` | `!hasPermission(operator, 'reports')` | 164-174 |
| `/inventory` | `!hasPermission(operator, 'inventory_read')` | 176-182 |
| `/price-lists` | `!hasPermission(operator, 'inventory_read')` | 184-190 |
| `/promotions` | `!hasPermission(operator, 'inventory_read')` | 192-198 |
| `/settings` | `!hasPermission(operator, 'settings')` | 200-203 |
| `/orders` | `!hasPermission(operator, 'online_orders')` | 205-208 |

   El bloqueo es `flashRedirect(new URL('/pos', ...))`: redirect + cookie `flash_toast=no-access` (maxAge 5).
6. Si pasa: setea `op_perms` = `normalizePermissions(operator.permissions)` (línea 210-217) y propaga `flash_toast` si venía.

### Piezas de `src/lib/operator.ts` que el test usa SIN mockear (son el sistema real bajo prueba):

- `signOperatorSession(operator: ActiveOperator): Promise<string>` (línea 190) — firma HMAC con `process.env.OPERATOR_SESSION_SECRET`; produce el valor de la cookie `operator_session`.
- `getActiveOperator(cookieStore)` (línea 197) — verifica la firma; rechaza cookies manipuladas.
- `ActiveOperator` (línea 65): `{ profile_id, name, role, permissions }` (permissions = las 8 capacidades de `Permissions`, línea 7).
- `OWNER_PERMISSIONS`, `DEFAULT_PERMISSIONS` (todas en false).

### Exemplar de la suite a imitar — `src/app/api/operator/switch/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
...
beforeAll(() => {
  process.env.OPERATOR_SESSION_SECRET = 'switch-route-test-secret'
})
afterAll(() => {
  delete process.env.OPERATOR_SESSION_SECRET
})
```

Mismo manejo de env y de mocks configurables por caso. **Diferencia clave**: `proxy.ts` no usa `@/lib/supabase/server` sino `createServerClient` de `@supabase/ssr` — el mock es sobre ese paquete.

Convención de ubicación: tests junto al sujeto en `__tests__/` → este va en `src/__tests__/proxy.test.ts` (entorno node por defecto; NO necesita el pragma jsdom).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Solo esta suite | `npm test -- proxy` | all pass |
| Suite completa | `npm test` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**:
- `src/__tests__/proxy.test.ts` (crear — único archivo nuevo)

**Out of scope** (NO tocar):
- `src/proxy.ts` — si un test revela un comportamiento sorprendente, se REPORTA, no se "arregla" el proxy en este plan.
- `src/lib/operator.ts`.
- El `config.matcher` del proxy (es configuración del framework, no se testea unitariamente).
- El contenido exacto del CSP (asediarlo a string-equality lo vuelve frágil; solo presencia del header).

## Git workflow

- Commit sugerido: `test(proxy): suite de gates de ruta y permisos (14 casos)`.
- Do NOT push unless instructed.

## Steps

### Step 1: Esqueleto y helpers del test

Crear `src/__tests__/proxy.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUserMock = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: getUserMock } }),
}))

import { proxy } from '@/proxy'
import { signOperatorSession, OWNER_PERMISSIONS, DEFAULT_PERMISSIONS, type ActiveOperator } from '@/lib/operator'

beforeAll(() => {
  process.env.OPERATOR_SESSION_SECRET = 'proxy-test-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key'
})
afterAll(() => {
  delete process.env.OPERATOR_SESSION_SECRET
})
beforeEach(() => {
  getUserMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
})

function makeRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(`http://localhost${path}`))
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value)
  }
  return req
}

async function operatorCookie(overrides: Partial<ActiveOperator> = {}): Promise<string> {
  const operator: ActiveOperator = {
    profile_id: 'op-1',
    name: 'Cajero Test',
    role: 'cashier',
    permissions: { ...DEFAULT_PERMISSIONS },
    ...overrides,
  }
  return signOperatorSession(operator)
}

function locationOf(res: Response): string {
  return new URL(res.headers.get('location') ?? 'http://localhost/__none__').pathname
}
```

Notas: la firma exacta de `ActiveOperator` está en `src/lib/operator.ts:65` — si tiene campos extra a los 4 listados, completarlos en el helper. `NextRequest` funciona en el entorno node de vitest (la suite del switch route ya importa de `next/server` sin pragma).

**Verify**: `npm test -- proxy` → la suite carga (aunque aún sin casos, no debe explotar el import).

### Step 2: Casos de autenticación y sesión (6)

1. **Sin user → /login**: `getUserMock` devuelve `user: null`; `proxy(makeRequest('/pos'))` → status 307 y `locationOf` = `/login`.
2. **Sin user en catálogo → pasa**: `user: null`, path `/catalogo/tienda` → NO es redirect (status 200) y tiene header `Content-Security-Policy`.
3. **User en ruta de auth → /pos**: user válido, path `/login` → redirect `/pos`.
4. **User sin cookie de operador → /operator-select + limpieza**: user válido, path `/pos` sin cookies → redirect `/operator-select`; las cookies `operator_session` y `op_perms` del response tienen valor vacío.
5. **Cookie manipulada → /operator-select**: construir `await operatorCookie()` y corromper la firma (`cookie.slice(0, -2) + 'xx'`) → mismo resultado que el caso 4.
6. **Owner → pasa y setea OWNER_PERMISSIONS**: cookie de `operatorCookie({ role: 'owner', permissions: { ...OWNER_PERMISSIONS } })`, path `/settings` → NO redirect; la cookie `op_perms` del response parsea a un objeto que `toEqual(OWNER_PERMISSIONS)`.

**Verify**: `npm test -- proxy` → 6 pass.

### Step 3: Casos de gates de permiso (7)

Con un operador `cashier` y `DEFAULT_PERMISSIONS` (todo false):

7. `/profile` → redirect `/pos` (owner-only) y cookie `flash_toast` = `no-access`.
8. `/expenses` → redirect `/pos`.
9. `/stats` → redirect `/pos` (gate `reports`; mismo gate cubre `/dashboard` y `/activity` — basta un path).
10. `/inventory` → redirect `/pos` (gate `inventory_read`; cubre también `/price-lists` y `/promotions`).
11. `/orders` → redirect `/pos` (gate `online_orders`).

Con permisos otorgados:

12. `/expenses` con `permissions: { ...DEFAULT_PERMISSIONS, expenses: true }` → NO redirect; la cookie `op_perms` del response contiene `"expenses":true`.
13. `/operator-select` con operador activo `role: 'manager'` → redirect `/dashboard`; con `role: 'cashier'` → redirect `/pos` (un caso con dos asserts o dos casos).

**Verify**: `npm test -- proxy` → 13-14 pass según cómo se cuente el 13.

### Step 4: Suite completa y cierre

**Verify**: `npm test` → all pass; `npm run typecheck` → exit 0; `npm run lint` → exit 0.

## Test plan

(Este plan ES el test plan.) Cobertura resultante: routing de auth, limpieza de cookies inválidas, verificación HMAC end-to-end (firma real, no mockeada), los 8 gates (5 directos + 3 cubiertos por gate compartido), el caso permitido, y el redirect de `/operator-select`. Modelar asserts de cookies con `res.cookies.get('op_perms')?.value` (API de `NextResponse`).

## Done criteria

- [ ] `src/__tests__/proxy.test.ts` existe con ≥ 13 casos
- [ ] `npm test` exit 0 (toda la suite, no solo proxy)
- [ ] `npm run typecheck` y `npm run lint` exit 0
- [ ] `git status`: solo el archivo nuevo
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- `NextRequest`/`NextResponse` no funcionan en el entorno node de vitest tras un intento razonable de configuración (p. ej. error de `Request is not defined`) — reportar el error exacto en vez de meter polyfills creativos.
- `proxy()` exige más mocks de `@supabase/ssr` que `auth.getUser` (p. ej. el manejo de cookies del client) — extender el mock mínimamente; si crece más de ~15 líneas, reportar.
- Un caso revela comportamiento distinto al de la tabla de gates (¿bug real?) — STOP: ese hallazgo vale más que la suite; reportarlo sin "arreglar" el proxy.
- La firma de `ActiveOperator` difiere de los 4 campos asumidos — completar desde `lib/operator.ts:65` y seguir; si difiere estructuralmente, STOP.

## Maintenance notes

- Cada capability nueva (regla 16 de CLAUDE.md) debe agregar acá su caso de gate — el reviewer debe pedirlo en el mismo PR que toque `proxy.ts`.
- Si el CSP pasa a usar nonces per-request, el assert de presencia del header sigue válido; no acoplar los tests al contenido.
- Esta suite usa la firma HMAC REAL (`signOperatorSession`) — si la firma cambia de formato, estos tests son la red que detecta cookies viejas rechazadas.
