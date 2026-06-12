# Plan 002: Eliminar el paquete `xlsx` abandonado (CVEs sin fix) y usar `@e965/xlsx` en su lugar

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a549038..HEAD -- src/components/expenses/ExpenseScanCard.tsx package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a549038`, 2026-06-12

## Why this matters

`package.json` tiene DOS librerías xlsx: `"xlsx": "^0.18.5"` (SheetJS upstream, abandonada en npm, con CVEs HIGH sin fix: prototype pollution GHSA-4r6h-8v6p-xvw6 y ReDoS GHSA-5pgg-2g8v-p4x9) y `"@e965/xlsx": "^0.20.3"` (fork parcheado, mismo API). El código usa `@e965/xlsx` en la importación de productos, pero `ExpenseScanCard.tsx` — que parsea **archivos Excel subidos por el usuario** (el peor escenario para esas CVEs) — importa la versión vulnerable. Un solo import a cambiar + desinstalar el paquete muerto.

## Current state

- `src/components/expenses/ExpenseScanCard.tsx:38-47` — convierte la primera hoja de un Excel subido a CSV para el escaneo IA de gastos:

```ts
async function spreadsheetToText(file: File): Promise<string> {
  const isCsv = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
  if (isCsv) return await file.text()
  // Excel: convertir la primera hoja a CSV. xlsx se importa dinámico para no engordar el bundle.
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const firstSheet = wb.Sheets[wb.SheetNames[0]]
  return firstSheet ? XLSX.utils.sheet_to_csv(firstSheet) : ''
}
```

- `src/components/inventory/ImportProductsModal.tsx` — ya importa `@e965/xlsx` (el exemplar a imitar). Usa el mismo API (`read`, `utils`).
- `package.json` — deps: `"@e965/xlsx": "^0.20.3"` y `"xlsx": "^0.18.5"`.
- API: `@e965/xlsx` es un fork 1:1 de SheetJS; `read(buf, { type: 'array' })` y `utils.sheet_to_csv` existen con la misma firma.

## Commands you will need

| Purpose   | Command           | Expected on success |
|-----------|-------------------|---------------------|
| Uninstall | `npm uninstall xlsx` | exit 0           |
| Build     | `npm run build`   | exit 0              |
| Lint      | `npm run lint`    | exit 0              |
| Audit     | `npm audit`       | sin advisories de `xlsx` |
| Tests     | `npm test`        | all pass (solo si el plan 001 ya aterrizó) |

## Scope

**In scope**:
- `src/components/expenses/ExpenseScanCard.tsx` (una línea)
- `package.json` + `package-lock.json` (quitar `xlsx`)

**Out of scope**:
- `src/components/inventory/ImportProductsModal.tsx` — ya usa `@e965/xlsx`, no tocar.
- No actualizar la versión de `@e965/xlsx` ni ningún otro paquete en este plan.

## Git workflow

- Commit estilo del repo (conventional commits en español), sugerido: `fix(security): reemplazar xlsx abandonado por @e965/xlsx en escaneo de gastos`.
- Do NOT push unless instructed.

## Steps

### Step 1: Cambiar el import dinámico

En `src/components/expenses/ExpenseScanCard.tsx:43`, cambiar `await import('xlsx')` por `await import('@e965/xlsx')`. Mantener el import dinámico (el comentario de la línea 42 explica por qué: bundle).

**Verify**: `grep -rn "import('xlsx')\|from 'xlsx'\|from \"xlsx\"" src/` → sin resultados.

### Step 2: Desinstalar el paquete vulnerable

`npm uninstall xlsx`.

**Verify**: `grep '"xlsx"' package.json` → sin resultados (la entrada `"@e965/xlsx"` sí queda).

### Step 3: Verificación integral

**Verify**: `npm run build` → exit 0. `npm run lint` → exit 0. `npm audit 2>&1 | grep -i "xlsx"` → solo menciones de `@e965/xlsx` o nada (los advisories GHSA-4r6h / GHSA-5pgg desaparecen).

## Test plan

- Sin tests nuevos (cambio de un import con API idéntico). Verificación funcional manual recomendada al reviewer: en `/expenses`, adjuntar un `.xlsx` a un gasto y usar el escaneo IA — la sugerencia debe generarse igual que antes.

## Done criteria

- [ ] `grep -rn "from 'xlsx'\|import('xlsx')" src/` sin matches
- [ ] `package.json` sin la dependencia `xlsx`
- [ ] `npm run build` exit 0
- [ ] `npm audit` sin advisories HIGH de xlsx
- [ ] `git status` sin archivos fuera del scope
- [ ] Fila actualizada en `plans/README.md`

## STOP conditions

- `@e965/xlsx` no expone `read` o `utils.sheet_to_csv` con la misma firma (improbable — ImportProductsModal ya los usa) → reportar en vez de adaptar el código.
- El build falla por resolución de módulo del import dinámico.

## Maintenance notes

- Si en el futuro se agrega otro consumo de Excel, importar SIEMPRE `@e965/xlsx` — considerar agregar una regla de ESLint `no-restricted-imports` para `xlsx` (deferred, no parte de este plan).
