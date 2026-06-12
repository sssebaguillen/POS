# Plan 003: Remover dependencias `hono` y `@hono/node-server` sin uso

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a549038..HEAD -- package.json`
> If package.json changed since this plan was written, re-run the Step 1
> verification grep before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `a549038`, 2026-06-12

## Why this matters

`package.json` declara `"hono": "^4.12.18"` y `"@hono/node-server": "^2.0.2"` como dependencies, pero **ningún archivo del repo los importa** (verificado por grep repo-wide en `.ts/.tsx/.mjs/.js` excluyendo `node_modules`/`.next`, incluyendo `supabase/functions/`). Los endpoints API del proyecto son route handlers de Next.js (`src/app/api/**/route.ts`), no Hono. Además, `npm audit` reporta 4 vulnerabilidades moderadas en hono ≤4.12.20 — ruido de auditoría por un paquete que ni se usa. Dependencias muertas = bundle/install más lento y falsos positivos de seguridad.

## Current state

- `package.json` deps: `"@hono/node-server": "^2.0.2"` y `"hono": "^4.12.18"`.
- Cero imports en el repo: `grep -rn "from 'hono\|from \"hono\|@hono" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" . --exclude-dir=node_modules --exclude-dir=.next` no devuelve nada (verificado 2026-06-12 en `a549038`).
- Las edge functions de Supabase (`supabase/functions/`) corren en Deno con sus propios imports por URL/jsr — no consumen `package.json`.

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Uninstall | `npm uninstall hono @hono/node-server`   | exit 0              |
| Build     | `npm run build`                          | exit 0              |
| Lint      | `npm run lint`                           | exit 0              |

## Scope

**In scope**:
- `package.json` + `package-lock.json`

**Out of scope**:
- Cualquier archivo de código fuente. Este plan NO debe tocar ningún `.ts/.tsx`.
- `supabase/functions/` — runtime Deno, no relacionado.

## Git workflow

- Commit sugerido: `chore(deps): remover hono y @hono/node-server sin uso`.
- Do NOT push unless instructed.

## Steps

### Step 1: Re-verificar que no hay uso

`grep -rn "from 'hono\|from \"hono\|@hono\|require('hono\|require(\"hono" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" --include="*.json" . --exclude-dir=node_modules --exclude-dir=.next --exclude=package.json --exclude=package-lock.json`

**Verify**: sin resultados. Si aparece CUALQUIER match → STOP.

### Step 2: Desinstalar

`npm uninstall hono @hono/node-server`

**Verify**: `grep hono package.json` → sin resultados.

### Step 3: Verificación integral

**Verify**: `npm run build` → exit 0. `npm run lint` → exit 0.

## Test plan

- No aplica (sin cambios de código). El build verde es la verificación.

## Done criteria

- [ ] `package.json` sin `hono` ni `@hono/node-server`
- [ ] `npm run build` exit 0
- [ ] `git status` solo muestra `package.json` y `package-lock.json` modificados
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- El grep del Step 1 encuentra algún import de hono (el repo cambió desde que se escribió el plan).
- `npm run build` falla después de desinstalar — implica una dependencia transitiva inesperada; reportar, no reinstalar a ciegas.

## Maintenance notes

- Si en el futuro se quiere un framework HTTP para edge functions, evaluar en ese momento — no conservar deps "por si acaso".
- Contexto histórico para el reviewer: un subagente de auditoría alegó que `/api/catalog/orders` "corre sobre Hono"; es falso (es un route handler de Next). La dep probablemente quedó de un experimento.
