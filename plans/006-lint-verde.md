# Plan 006: Dejar `npm run lint` en verde (regla set-state-in-effect a warn + 2 fixes reales + ignorar .claude/)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a549038..HEAD -- eslint.config.mjs src/hooks/use-changelog.ts src/components/onboarding/OnboardingTour.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (bloquea el merge de 002/003 con lint verde)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `a549038`, 2026-06-12

## Why this matters

`npm run lint` falla hoy en master con 21 errores. 19 son `react-hooks/set-state-in-effect` (regla nueva del plugin react-hooks v6) disparada por DOS patrones deliberados del repo: el *mounted pattern* que `CLAUDE.md` regla 25 **exige** para SSR-safety, y el patrón "resetear estado al abrir un modal". Refactorizarlos en masa tocaría POSView/CartPanel (camino del dinero) sin red de tests — decisión del operador (2026-06-12): degradar la regla a `warn` y refactor selectivo post-beta. Los otros 2 errores son reales y se arreglan acá. Además ESLint escanea `.claude/` (worktrees de agentes), duplicando errores — se ignora. Resultado: lint exit 0, gate utilizable en CI y en los planes 001/005.

## Current state

- `eslint.config.mjs` (18 líneas, flat config) — contenido completo actual:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

- `src/hooks/use-changelog.ts:65-73` — error `react-hooks/immutability` ("Cannot reassign variable after render completes"): `patchesShown` se reasigna dentro del callback de `.filter()` durante render:

```ts
  // Mostrar todos los features, pero limitar los parches a los más recientes.
  // releases viene newest-first, así que el filtro toma los primeros N parches.
  let patchesShown = 0
  const unreadReleases = rawUnread.filter(r => {
    if (r.kind !== 'patch') return true
    if (patchesShown < PATCH_VISIBLE_LIMIT) {
      patchesShown += 1
      return true
    }
    return false
  })
  const hiddenPatchCount = rawUnread.length - unreadReleases.length
```

- `src/components/onboarding/OnboardingTour.tsx:132-137` — error `react-hooks/refs` ("Cannot access refs during render") en la posición 136:83, que es `arrow({ element: arrowRef })`:

```ts
  const { refs, floatingStyles, middlewareData, placement, update } = useFloating({
    placement: currentStep?.placement ?? 'right',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(14), flip({ padding: 16 }), shift({ padding: 16 }), arrow({ element: arrowRef })],
  })
```

  Esto es un FALSO POSITIVO: `arrow({ element: ref })` es el API canónico de `@floating-ui/react` (la librería lee `.current` en su momento, no durante render). NO refactorizar: disable puntual.

- Los 19 errores restantes son todos `react-hooks/set-state-in-effect` en: sidebar.tsx, theme.tsx, CatalogThemeProvider.tsx, OffersCarousel.tsx, DashboardView.tsx, useInsights.ts, IconPickerPanel.tsx, InventoryPanel.tsx (×2), ProductStockModal.tsx, QuickEditCategoryModal.tsx, OnboardingChecklist.tsx, OrdersView.tsx (×2), CartPanel.tsx, CloseSessionModal.tsx, POSView.tsx, VariantPriceModal.tsx, PromotionModal.tsx. **No tocar ninguno de esos archivos.**

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `npm run lint` | exit 0 (warnings permitidos, 0 errores) |
| Lint puntual | `npx eslint src/hooks/use-changelog.ts src/components/onboarding/OnboardingTour.tsx` | 0 errores |
| Build | `npm run build` | exit 0 (requiere `.env.local`; en worktree fresco copiarlo del repo principal — NO commitearlo) |

## Scope

**In scope** (the only files you should modify):
- `eslint.config.mjs`
- `src/hooks/use-changelog.ts`
- `src/components/onboarding/OnboardingTour.tsx`

**Out of scope** (do NOT touch):
- Los 19 archivos con `set-state-in-effect` listados arriba — la regla pasa a warn, los archivos quedan intactos.
- `CLAUDE.md` / docs — la documentación de esta decisión la maneja el operador.
- Cualquier otro warning de lint (los 120 warnings existentes NO son objetivo de este plan).

## Git workflow

- Commit sugerido: `chore(lint): set-state-in-effect a warn + fix immutability/refs + ignorar .claude/`.
- Do NOT push.

## Steps

### Step 1: eslint.config.mjs — ignorar `.claude/` y degradar la regla

Agregar `".claude/**"` a la lista de `globalIgnores`, y un bloque de rules al final del array de config:

```js
  {
    rules: {
      // Mounted pattern (CLAUDE.md regla 25) y reset-de-estado-al-abrir-modal son
      // patrones deliberados del repo; la regla queda en warn hasta el refactor
      // selectivo post-beta (decisión 2026-06-12).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
```

**Verify**: `npm run lint` → los 19 `set-state-in-effect` aparecen como `warning`, quedan exactamente 2 `error` (immutability + refs), y ningún path bajo `.claude/` aparece en el output.

### Step 2: use-changelog.ts — eliminar la reasignación durante render

Reemplazar el bloque del filtro por una versión sin mutación de variable capturada, preservando EXACTAMENTE la semántica (releases newest-first; se muestran todos los no-patch y solo los primeros `PATCH_VISIBLE_LIMIT` patches):

```ts
  // Mostrar todos los features, pero limitar los parches a los más recientes.
  // releases viene newest-first, así que se toman los primeros N parches.
  const visiblePatches = new Set(
    rawUnread.filter(r => r.kind === 'patch').slice(0, PATCH_VISIBLE_LIMIT)
  )
  const unreadReleases = rawUnread.filter(r => r.kind !== 'patch' || visiblePatches.has(r))
  const hiddenPatchCount = rawUnread.length - unreadReleases.length
```

(Set por identidad de objeto — los elementos provienen del mismo array, no hace falta key.)

**Verify**: `npx eslint src/hooks/use-changelog.ts` → 0 errores.

### Step 3: OnboardingTour.tsx — disable puntual del falso positivo

Inmediatamente arriba de la línea del `middleware: [...]`, agregar:

```ts
    // eslint-disable-next-line react-hooks/refs -- API canónico de floating-ui: arrow({ element: ref }) lee .current fuera del render
```

**Verify**: `npx eslint src/components/onboarding/OnboardingTour.tsx` → 0 errores y SIN warning de "unused eslint-disable" (si aparece unused, el comentario quedó en la línea equivocada).

### Step 4: Verificación integral

**Verify**: `npm run lint` → exit 0, `✖ N problems (0 errors, N warnings)`. `npm run build` → exit 0.

## Test plan

- Sin tests automatizados (no hay harness aún — plan 001). Verificación = lint exit 0 + build exit 0.
- Smoke manual recomendado al reviewer: abrir el changelog (campanita/badge de novedades) y confirmar que la lista de versiones no leídas muestra lo mismo que antes (features todos, patches limitados); recorrer un paso del onboarding tour y verificar que la flechita del tooltip sigue posicionándose.

## Done criteria

- [ ] `npm run lint` exit 0 con `0 errors`
- [ ] `grep -n '".claude/\*\*"' eslint.config.mjs` → 1 match
- [ ] `grep -n 'set-state-in-effect' eslint.config.mjs` → 1 match (en rules, valor "warn")
- [ ] `grep -c "patchesShown" src/hooks/use-changelog.ts` → 0
- [ ] `npm run build` exit 0
- [ ] `git status` sin archivos fuera del scope (`.env.local` copiado NO debe aparecer — está gitignored)

## STOP conditions

- Tras el Step 1 quedan errores que NO son los 2 esperados (immutability en use-changelog + refs en OnboardingTour) → el estado del repo difiere del plan; reportar la lista.
- El refactor del Step 2 cambia el resultado de `unreadReleases`/`hiddenPatchCount` para algún caso (p. ej. orden distinto) → no inventar otra estructura; reportar.
- `npm run build` falla por algo ajeno a `.env.local` faltante.

## Maintenance notes

- La degradación a warn es **deliberada y temporal**: cuando exista la red de tests (plan 001 + smoke UI), evaluar refactor selectivo de los 19 (sobre todo los que NO son mounted pattern). El operador puede documentarlo en `docs/backlog.md`.
- Si se adopta React Compiler en build (ya está habilitado en Next config según CLAUDE.md), estos warnings indican componentes que el compiler no optimiza — son el backlog natural de ese refactor.
- Reviewer: verificar que el bloque `rules` no pisó reglas de `eslint-config-next` (es un objeto separado al final del array — solo agrega una regla).
