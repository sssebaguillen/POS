# Plan 013: Higiene de dependencias — pin de @posthog/cli, shadcn fuera de dependencies, radix phantom declarado

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat aa3b439..HEAD -- package.json package-lock.json`
> If `package.json` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt / deps
- **Planned at**: commit `aa3b439`, 2026-06-12

## Why this matters

Tres olores chicos en `package.json` con arreglo barato: (1) `"@posthog/cli": "latest"` — versión flotante; cualquier regeneración del lockfile (como ya pasó en el merge de la rama cloud) puede traer silenciosamente una major nueva; (2) `"shadcn": "^4.0.5"` vive en `dependencies` con **cero imports** en `src/` — es un generador CLI, no código de runtime; (3) 10 archivos importan `@radix-ui/react-visually-hidden`, que **no está declarado** — resuelve como dependencia fantasma a través del paquete paraguas `radix-ui`; si el paraguas reorganiza sus deps internas, el build rompe sin que nadie haya tocado nada.

## Current state

`package.json` (extractos verificados):

```json
"dependencies": {
  ...
  "radix-ui": "^1.4.3",          // línea 33 — paraguas; importado con `from "radix-ui"` en ~9 sitios
  "shadcn": "^4.0.5",            // línea 37 — CLI generador, 0 imports en src/
  ...
},
"devDependencies": {
  "@posthog/cli": "latest",      // línea 43 — flotante
  ...
}
```

Hechos verificados (2026-06-12):
- `grep -rn "from 'shadcn'" src/` y variantes con comillas dobles → **0 matches**. Ningún script de `package.json` invoca `shadcn`. Existe `components.json` (config del CLI) — el CLI se puede seguir usando vía `npx shadcn@latest add <componente>` sin dependencia local.
- Imports de Radix en `src/` (conteo por especificador): `'@radix-ui/react-visually-hidden'` ×10, `"radix-ui"` ×9. Solo `radix-ui` está en `package.json`.
- Versiones resueltas en `package-lock.json`: `@posthog/cli` → `0.7.11`; `@radix-ui/react-visually-hidden` → `1.2.3` (ya instalado como transitiva del paraguas).

Decisión de diseño (tomada en la auditoría, no re-litigar): para el phantom se **declara la dependencia explícita** en vez de migrar los 10 imports al paraguas — 1 línea en el manifest vs. 10 ediciones de código; ambas rutas son válidas, esta es la de menor riesgo.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Reinstalar/lockear | `npm install` | exit 0, lockfile actualizado |
| Dep declarada | `npm ls @radix-ui/react-visually-hidden` | muestra `1.2.3` deduped, sin "UNMET" |
| Tests | `npm test` | all pass |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `package.json`
- `package-lock.json` (regenerado por `npm install`)

**Out of scope** (NO tocar):
- Cualquier archivo de `src/` — cero cambios de código en este plan.
- NO correr `npm update` ni `npm audit fix` (el `npm audit fix` acá NO es quirúrgico — antecedente documentado en `docs/todo/backlog.md` sobre protobufjs).
- NO migrar los imports `"radix-ui"` ↔ `@radix-ui/*` en ninguna dirección.
- Las advisories conocidas (protobufjs vía Sentry, axios vía @posthog/cli) — analizadas y diferidas, no son de este plan.

## Git workflow

- Commit sugerido: `chore(deps): pin @posthog/cli, shadcn fuera de dependencies, declarar @radix-ui/react-visually-hidden`.
- Do NOT push unless instructed.

## Steps

### Step 1: Editar `package.json`

1. En `devDependencies`: `"@posthog/cli": "latest"` → `"@posthog/cli": "^0.7.11"`.
2. En `dependencies`: eliminar la línea `"shadcn": "^4.0.5",`.
3. En `dependencies`: agregar (orden alfabético, junto a los `@radix-ui` si los hubiera / antes de `@supabase`): `"@radix-ui/react-visually-hidden": "^1.2.3",`.

**Verify**: `git diff package.json` muestra exactamente 3 líneas cambiadas (1 modificada, 1 eliminada, 1 agregada).

### Step 2: Regenerar el lockfile

```
npm install
```

**Verify**: `npm ls @radix-ui/react-visually-hidden` → `@radix-ui/react-visually-hidden@1.2.3` sin errores; `npm ls shadcn` → `(empty)` o "not found"; `grep -c '"shadcn"' package.json` → 0.

### Step 3: La app no se enteró

**Verify**: `npm test` → all pass; `npm run build` → exit 0; `npm run lint` → exit 0.

## Test plan

Sin tests nuevos — el riesgo es de resolución de módulos, no de lógica. La verificación es que build + suite completa pasen con el lockfile nuevo.

## Done criteria

- [ ] `package.json`: sin `"latest"`, sin `shadcn`, con `@radix-ui/react-visually-hidden`
- [ ] `npm install` exit 0 y `package-lock.json` consistente (`npm ci` en limpio también pasaría)
- [ ] `npm test`, `npm run build`, `npm run lint` exit 0
- [ ] `git status`: solo `package.json` y `package-lock.json`
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- `npm install` modifica MÁS paquetes que los 3 esperados en el lockfile de forma masiva (señal de que `latest` ya había flotado a una versión distinta de la del lock — reportar qué versión trajo antes de commitear).
- Aparece algún import de `shadcn` en `src/` que el grep de recon no vio (`grep -rn "shadcn" src/ --include="*.ts*"`) — restaurar la dependencia y reportar.
- `npm run build` falla por resolución de Radix — reportar el error exacto; NO migrar imports como workaround.

## Maintenance notes

- Para actualizar el CLI de PostHog a futuro: bump explícito del rango en `package.json`, nunca volver a `latest`.
- Si alguien agrega componentes con `npx shadcn add`, el CLI escribe en `src/components/ui/` usando `components.json` — sigue funcionando sin la dependencia local.
- Regla para reviewers: todo import nuevo `@radix-ui/react-*` debe venir acompañado de su entrada en `package.json` (o usar el paraguas `radix-ui` ya declarado) — no confiar en resolución transitiva.
